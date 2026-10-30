// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AirnodeV2Attestation} from "../src/AirnodeV2Attestation.sol";
import {FlightDelayCover} from "../src/FlightDelayCover.sol";
import {AirnodeV2Test} from "./AirnodeV2Test.sol";
import {Vm} from "forge-std/Vm.sol";

contract MockUSD is ERC20("AirnodeHub USD", "aUSD") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// @notice Includes the four API3 tamper tests (edited value, too old, other request, wrong signer) plus replay,
/// future timestamp, observation-before-landing, solvency and payout tiers, and the same set on the private path.
contract FlightDelayCoverTest is AirnodeV2Test {
    uint256 constant AIRNODE_PK = 0xA11CE;
    uint256 constant ATTACKER_PK = 0xBAD;
    address airnode;
    MockUSD usd;
    FlightDelayCover cover;
    address holder = address(0xBEEF);
    address agent = address(0xA6E7);

    string constant FLIGHT = "LH1234";
    string constant DATE = "2026-10-30";
    // 2026-10-30 14:05Z
    uint256 constant SCHEDULED = 1793369100;

    function setUp() public {
        airnode = vm.addr(AIRNODE_PK);
        usd = new MockUSD();
        cover = new FlightDelayCover(usd, airnode, 800, 1 hours, 1_000e6);
        usd.mint(address(this), 10_000e6);
        usd.approve(address(cover), type(uint256).max);
        cover.fundPool(5_000e6);
        usd.mint(agent, 1_000e6);
        vm.prank(agent);
        usd.approve(address(cover), type(uint256).max);
        vm.warp(SCHEDULED - 6 hours);
    }

    string constant SCHED_STR = "2026-10-30 14:05Z";

    function _statusData(string memory sched, string memory status) internal pure returns (bytes memory) {
        return abi.encodePacked('{"scheduled":"', sched, '","status":"', status, '"}');
    }

    /// @dev Buys with a purchase proof: a status response signed by `pk` for (flight, date) at `ts`.
    function _buyWith(string memory flight, string memory date, uint256 pk, uint256 ts, bytes memory data)
        internal
        returns (uint256 id)
    {
        bytes memory sig = signResponse(pk, cover.requestHashFor(flight, date, false), ts, data);
        vm.prank(agent);
        id = cover.buyPolicy(flight, date, 100e6, holder, keccak256("masumi-job-1"), ts, data, sig);
    }

    function _buy() internal returns (uint256 id) {
        id = _buyWith(FLIGHT, DATE, AIRNODE_PK, block.timestamp - 60, _statusData(SCHED_STR, "Expected"));
    }

    function _arrivalData(string memory actual) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '{"actual":"', actual, '","scheduled":"2026-10-30 14:05Z","status":"Arrived"}'
        );
    }

    function _settle(uint256 id, uint256 pk, bytes32 rh, uint256 ts, bytes memory data) internal {
        bytes memory sig = signResponse(pk, rh, ts, data);
        cover.settle(id, rh, ts, data, sig);
    }

    // ------------------------------------------------------------- happy paths

    function test_RequestHashMatchesAirnodeHubScheme() public view {
        // keccak256(utf8(JSON.stringify(["flightStatusOnDate",[["dateLocal",..],["searchBy","number"],["searchParam",..]],[projection]])))
        bytes32 expected = keccak256(
            bytes(
                '["flightStatusOnDate",[["dateLocal","2026-10-30"],["searchBy","number"],["searchParam","LH1234"]],[["actual","/0/arrival/revisedTime/utc"],["scheduled","/0/arrival/scheduledTime/utc"],["status","/0/status"]]]'
            )
        );
        assertEq(cover.requestHashFor(FLIGHT, DATE, true), expected);
    }

    function test_FullPayoutAfter3hDelay() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        _settle(id, AIRNODE_PK, rh, block.timestamp - 60, _arrivalData("2026-10-30 17:20Z"));
        assertEq(usd.balanceOf(holder), 100e6);
        assertEq(uint8(cover.policy(id).status), uint8(FlightDelayCover.Status.PaidFull));
        assertEq(cover.reserved(), 0);
    }

    function test_HalfPayoutAfter2hDelay() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 3 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        _settle(id, AIRNODE_PK, rh, block.timestamp, _arrivalData("2026-10-30 16:15Z"));
        assertEq(usd.balanceOf(holder), 50e6);
    }

    function test_NoPayoutWhenOnTime() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 1 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        _settle(id, AIRNODE_PK, rh, block.timestamp, _arrivalData("2026-10-30 14:10Z"));
        assertEq(usd.balanceOf(holder), 0);
        assertEq(uint8(cover.policy(id).status), uint8(FlightDelayCover.Status.ClosedNoPayout));
    }

    function test_FullPayoutWhenCancelled() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED - 2 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, false);
        _settle(id, AIRNODE_PK, rh, block.timestamp, bytes('{"scheduled":"2026-10-30 14:05Z","status":"Canceled"}'));
        assertEq(usd.balanceOf(holder), 100e6);
    }

    // ------------------------------------------------------------- the four API3 tamper tests

    function test_Tamper1_RejectEditedValue() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory real = _arrivalData("2026-10-30 14:10Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, real);
        bytes memory forged = _arrivalData("2026-10-30 18:10Z");
        vm.expectPartialRevert(AirnodeV2Attestation.NotSignedByAirnode.selector);
        cover.settle(id, rh, block.timestamp, forged, sig);
    }

    function test_Tamper2_RejectTooOld() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        uint256 ts = block.timestamp - 1 hours - 1;
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, ts, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, ts));
        cover.settle(id, rh, ts, data, sig);
    }

    function test_Tamper3_RejectOtherRequest() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        // genuinely signed by the Airnode, but for another flight
        bytes32 other = cover.requestHashFor("LH9999", DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, other, block.timestamp, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.WrongRequest.selector, other));
        cover.settle(id, other, block.timestamp, data, sig);
    }

    function test_Tamper4_RejectUnexpectedSigner() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(ATTACKER_PK, rh, block.timestamp, data);
        vm.expectRevert(abi.encodeWithSelector(AirnodeV2Attestation.NotSignedByAirnode.selector, vm.addr(ATTACKER_PK)));
        cover.settle(id, rh, block.timestamp, data, sig);
    }

    // ------------------------------------------------------------- extra hardening

    function test_SameEvidenceSettlesEveryPolicyOnThatFlightOnce() public {
        // duplicate execution is prevented PER POLICY: one flight outcome settles all its policies, each exactly once
        uint256 a = _buy();
        uint256 b = _buy(); // same flight, second traveller
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        cover.settle(a, rh, block.timestamp, data, sig);
        cover.settle(b, rh, block.timestamp, data, sig);
        assertEq(usd.balanceOf(holder), 200e6);
        assertEq(cover.reserved(), 0);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotActive.selector, a));
        cover.settle(a, rh, block.timestamp, data, sig);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotActive.selector, b));
        cover.settle(b, rh, block.timestamp, data, sig);
    }

    function test_RejectSettlingTwice() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        _settle(id, AIRNODE_PK, rh, block.timestamp, _arrivalData("2026-10-30 17:20Z"));
        bytes memory data = _arrivalData("2026-10-30 17:21Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotActive.selector, id));
        cover.settle(id, rh, block.timestamp, data, sig);
    }

    function test_RejectFutureTimestamp() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        uint256 ts = block.timestamp + 10 minutes;
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, ts, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.FromTheFuture.selector, ts));
        cover.settle(id, rh, ts, data, sig);
    }

    function test_RejectNotYetLanded() public {
        uint256 id = _buy();
        vm.warp(SCHEDULED + 1 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = bytes('{"actual":"2026-10-30 17:20Z","scheduled":"2026-10-30 14:05Z","status":"Delayed"}');
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotFinal.selector, "Delayed"));
        cover.settle(id, rh, block.timestamp, data, sig);
    }

    function test_RejectObservationBeforeLanding() public {
        // signed at 15:00Z claiming the plane "Arrived" at 17:20Z: impossible observation
        uint256 id = _buy();
        vm.warp(SCHEDULED + 1 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        vm.expectPartialRevert(FlightDelayCover.ObservedTooEarly.selector);
        cover.settle(id, rh, block.timestamp, data, sig);
    }

    function test_InsolventPoolBlocksPurchase() public {
        FlightDelayCover empty = new FlightDelayCover(usd, airnode, 800, 1 hours, 1_000e6);
        vm.startPrank(agent);
        usd.approve(address(empty), type(uint256).max);
        bytes memory data = _statusData(SCHED_STR, "Expected");
        bytes memory sig = signResponse(AIRNODE_PK, cover.requestHashFor(FLIGHT, DATE, false), block.timestamp, data);
        vm.expectPartialRevert(FlightDelayCover.Insolvent.selector);
        empty.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), block.timestamp, data, sig);
        vm.stopPrank();
    }

    function test_RejectFlightNeedingJsonEscape() public {
        vm.prank(agent);
        vm.expectRevert(FlightDelayCover.BadFlight.selector);
        cover.buyPolicy('LH"1', DATE, 100e6, holder, bytes32(0), block.timestamp, "", "");
    }

    function test_ExpireAfterWindow() public {
        uint256 id = _buy();
        vm.expectPartialRevert(FlightDelayCover.WindowOpen.selector);
        cover.expire(id);
        vm.warp(SCHEDULED + 3 days + 1);
        cover.expire(id);
        assertEq(cover.reserved(), 0);
    }

    function test_OwnerCannotWithdrawReservedCapital() public {
        _buy();
        uint256 free = cover.freeCapital();
        vm.expectPartialRevert(FlightDelayCover.Insolvent.selector);
        cover.withdrawFree(free + 1, address(this));
        cover.withdrawFree(free, address(this));
    }

    // ------------------------------------------------------------- purchase proof (signed data at purchase)

    function test_Buy_StoresSignedScheduledArrival() public {
        uint256 id = _buy();
        FlightDelayCover.Policy memory p = cover.policy(id);
        assertEq(p.scheduledArrival, SCHEDULED); // read from the signed proof, not a caller input
        assertEq(p.statusRequestHash, cover.requestHashFor(FLIGHT, DATE, false));
        assertEq(cover.reserved(), 100e6);
    }

    function test_Buy_AcceptsEveryPreDepartureStatus() public {
        string[4] memory ok = ["Expected", "Unknown", "CheckIn", "Boarding"];
        for (uint256 i; i < ok.length; ++i) {
            _buyWith(FLIGHT, DATE, AIRNODE_PK, block.timestamp, _statusData(SCHED_STR, ok[i]));
        }
        assertEq(cover.reserved(), 400e6);
    }

    function test_Buy_RejectOutcomeAlreadyKnown() public {
        string[8] memory bad =
            ["Delayed", "Arrived", "Canceled", "CanceledUncertain", "Diverted", "Departed", "EnRoute", "GateClosed"];
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, false);
        for (uint256 i; i < bad.length; ++i) {
            bytes memory data = _statusData(SCHED_STR, bad[i]);
            bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
            vm.prank(agent);
            vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotBuyable.selector, bad[i]));
            cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), block.timestamp, data, sig);
        }
    }

    function test_Buy_RejectStaleProof() public {
        uint256 ts = block.timestamp - 15 minutes - 1;
        bytes memory data = _statusData(SCHED_STR, "Expected");
        bytes memory sig = signResponse(AIRNODE_PK, cover.requestHashFor(FLIGHT, DATE, false), ts, data);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, ts));
        cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), ts, data, sig);
    }

    function test_Buy_RejectFutureProof() public {
        uint256 ts = block.timestamp + 10 minutes;
        bytes memory data = _statusData(SCHED_STR, "Expected");
        bytes memory sig = signResponse(AIRNODE_PK, cover.requestHashFor(FLIGHT, DATE, false), ts, data);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.FromTheFuture.selector, ts));
        cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), ts, data, sig);
    }

    function test_Buy_RejectProofForOtherFlightOrProjection() public {
        bytes memory data = _statusData(SCHED_STR, "Expected");
        // genuine "Expected" proof for LH9999, used to buy LH1234 (which may be visibly delayed)
        bytes memory sig = signResponse(AIRNODE_PK, cover.requestHashFor("LH9999", DATE, false), block.timestamp, data);
        vm.prank(agent);
        vm.expectPartialRevert(AirnodeV2Attestation.NotSignedByAirnode.selector);
        cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), block.timestamp, data, sig);
        // same flight, but the arrival projection hash instead of the status one
        sig = signResponse(AIRNODE_PK, cover.requestHashFor(FLIGHT, DATE, true), block.timestamp, data);
        vm.prank(agent);
        vm.expectPartialRevert(AirnodeV2Attestation.NotSignedByAirnode.selector);
        cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), block.timestamp, data, sig);
    }

    function test_Buy_RejectEditedProof() public {
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, false);
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, _statusData(SCHED_STR, "Delayed"));
        vm.prank(agent);
        vm.expectPartialRevert(AirnodeV2Attestation.NotSignedByAirnode.selector);
        cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), block.timestamp, _statusData(SCHED_STR, "Expected"), sig);
    }

    function test_Buy_RejectWrongSignerProof() public {
        bytes memory data = _statusData(SCHED_STR, "Expected");
        bytes memory sig = signResponse(ATTACKER_PK, cover.requestHashFor(FLIGHT, DATE, false), block.timestamp, data);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AirnodeV2Attestation.NotSignedByAirnode.selector, vm.addr(ATTACKER_PK)));
        cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), block.timestamp, data, sig);
    }

    function test_Buy_RejectTooCloseToArrival() public {
        vm.warp(SCHEDULED - 2 hours + 1);
        bytes memory data = _statusData(SCHED_STR, "Boarding");
        bytes memory sig = signResponse(AIRNODE_PK, cover.requestHashFor(FLIGHT, DATE, false), block.timestamp, data);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(FlightDelayCover.TooCloseToArrival.selector, SCHEDULED, block.timestamp + 2 hours)
        );
        cover.buyPolicy(FLIGHT, DATE, 100e6, holder, bytes32(0), block.timestamp, data, sig);
        // exactly at the boundary is fine
        vm.warp(SCHEDULED - 2 hours);
        _buyWith(FLIGHT, DATE, AIRNODE_PK, block.timestamp, data);
    }

    function test_Buy_MinLeadTimeIsOwnerSetting() public {
        vm.expectRevert();
        vm.prank(agent);
        cover.setMinLeadTime(0);
        vm.expectEmit(false, false, false, true);
        emit FlightDelayCover.MinLeadTimeUpdated(0);
        cover.setMinLeadTime(0); // demo only
        vm.warp(SCHEDULED - 1 minutes);
        _buyWith(FLIGHT, DATE, AIRNODE_PK, block.timestamp, _statusData(SCHED_STR, "Boarding"));
    }

    function test_RejectSettleEvidenceWithOtherSchedule() public {
        // public: stored scheduledArrival is the signed purchase value, so settlement must match it exactly
        uint256 id = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = bytes('{"actual":"2026-10-30 17:20Z","scheduled":"2026-10-30 14:06Z","status":"Arrived"}');
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.ScheduleMismatch.selector, SCHEDULED + 60, SCHEDULED));
        cover.settle(id, rh, block.timestamp, data, sig);
    }

    // ------------------------------------------------------------- private policies

    bytes32 constant SALT = keccak256("traveller secret salt");

    function _buyPrivate() internal returns (uint256 id) {
        bytes32 c = cover.commitmentFor(FLIGHT, DATE, SALT);
        assertEq(c, keccak256(abi.encode(FLIGHT, DATE, SALT)));
        vm.prank(agent);
        // agent rounds the scheduled arrival to the hour (14:05Z -> 14:00Z)
        id = cover.buyPrivatePolicy(c, 100e6, holder, keccak256("masumi-job-p"), uint64(SCHEDULED - 5 minutes));
    }

    function _settlePrivate(uint256 id, uint256 pk, bytes32 rh, uint256 ts, bytes memory data) internal {
        bytes memory sig = signResponse(pk, rh, ts, data);
        cover.settlePrivate(id, FLIGHT, DATE, SALT, rh, ts, data, sig);
    }

    function test_Private_StoresNoFlightInfo() public {
        bytes32 c = cover.commitmentFor(FLIGHT, DATE, SALT);
        vm.recordLogs();
        uint256 id = _buyPrivate();
        FlightDelayCover.Policy memory p = cover.policy(id);
        assertEq(bytes(p.flight).length, 0);
        assertEq(bytes(p.date).length, 0);
        assertEq(p.arrivalRequestHash, bytes32(0));
        assertEq(p.statusRequestHash, bytes32(0));
        assertEq(cover.commitmentOf(id), c);
        assertEq(cover.reserved(), 100e6);
        // the only purchase event carries no flight, date or request hash
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 rhA = cover.requestHashFor(FLIGHT, DATE, true);
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != FlightDelayCover.PolicyBought.selector);
            assertEq(_contains(logs[i].data, bytes(FLIGHT)), false);
            assertEq(_contains(logs[i].data, abi.encodePacked(rhA)), false);
        }
    }

    function test_Private_HappyPathFullPayout() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        vm.expectEmit(true, false, false, true);
        emit FlightDelayCover.PrivatePolicyRevealed(id, FLIGHT, DATE);
        _settlePrivate(id, AIRNODE_PK, rh, block.timestamp - 60, _arrivalData("2026-10-30 17:20Z"));
        assertEq(usd.balanceOf(holder), 100e6);
        FlightDelayCover.Policy memory p = cover.policy(id);
        assertEq(uint8(p.status), uint8(FlightDelayCover.Status.PaidFull));
        assertEq(p.arrivalRequestHash, rh); // recorded on reveal
        assertEq(cover.reserved(), 0);
    }

    function test_Private_CancelledPaysFull() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED - 2 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, false);
        _settlePrivate(id, AIRNODE_PK, rh, block.timestamp, bytes('{"scheduled":"2026-10-30 14:05Z","status":"Canceled"}'));
        assertEq(usd.balanceOf(holder), 100e6);
    }

    function test_Private_RejectWrongSalt() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        vm.expectRevert(FlightDelayCover.BadCommitment.selector);
        cover.settlePrivate(id, FLIGHT, DATE, keccak256("guess"), rh, block.timestamp, data, sig);
    }

    function test_Private_RejectOtherFlightReveal() public {
        // insured LH1234; a genuinely signed delayed LH9999 cannot be passed off by revealing LH9999
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 other = cover.requestHashFor("LH9999", DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, other, block.timestamp, data);
        vm.expectRevert(FlightDelayCover.BadCommitment.selector);
        cover.settlePrivate(id, "LH9999", DATE, SALT, other, block.timestamp, data, sig);
        vm.expectRevert(FlightDelayCover.BadCommitment.selector);
        cover.settlePrivate(id, FLIGHT, "2026-10-31", SALT, other, block.timestamp, data, sig);
    }

    function test_Private_RejectPublicSettleAndViceVersa() public {
        uint256 priv = _buyPrivate();
        uint256 pub = _buy();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.PrivatePolicy.selector, priv));
        cover.settle(priv, rh, block.timestamp, data, sig);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotPrivate.selector, pub));
        cover.settlePrivate(pub, FLIGHT, DATE, SALT, rh, block.timestamp, data, sig);
    }

    function test_Private_RejectZeroCommitment() public {
        vm.prank(agent);
        vm.expectRevert(FlightDelayCover.BadCommitment.selector);
        cover.buyPrivatePolicy(bytes32(0), 100e6, holder, bytes32(0), uint64(SCHEDULED));
    }

    function test_Private_RejectBadFlightCharsEvenIfCommitted() public {
        // a commitment to a string that needs JSON escaping must not open (its hash would not be AirnodeHub's)
        bytes32 c = cover.commitmentFor('LH"1', DATE, SALT);
        vm.prank(agent);
        uint256 id = cover.buyPrivatePolicy(c, 100e6, holder, bytes32(0), uint64(SCHEDULED));
        vm.expectRevert(FlightDelayCover.BadFlight.selector);
        cover.settlePrivate(id, 'LH"1', DATE, SALT, bytes32(0), block.timestamp, "", "");
    }

    function test_Private_Tamper1_RejectEditedValue() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, _arrivalData("2026-10-30 14:10Z"));
        vm.expectPartialRevert(AirnodeV2Attestation.NotSignedByAirnode.selector);
        cover.settlePrivate(id, FLIGHT, DATE, SALT, rh, block.timestamp, _arrivalData("2026-10-30 18:10Z"), sig);
    }

    function test_Private_Tamper2_RejectTooOld() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        uint256 ts = block.timestamp - 1 hours - 1;
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, ts));
        _settlePrivate(id, AIRNODE_PK, rh, ts, _arrivalData("2026-10-30 17:20Z"));
    }

    function test_Private_Tamper3_RejectOtherRequest() public {
        // correct reveal, but the signed response is for another flight
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 other = cover.requestHashFor("LH9999", DATE, true);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.WrongRequest.selector, other));
        _settlePrivate(id, AIRNODE_PK, other, block.timestamp, _arrivalData("2026-10-30 17:20Z"));
    }

    function test_Private_Tamper4_RejectUnexpectedSigner() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        vm.expectRevert(abi.encodeWithSelector(AirnodeV2Attestation.NotSignedByAirnode.selector, vm.addr(ATTACKER_PK)));
        _settlePrivate(id, ATTACKER_PK, rh, block.timestamp, _arrivalData("2026-10-30 17:20Z"));
    }

    function test_Private_RejectSettlingTwice() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        _settlePrivate(id, AIRNODE_PK, rh, block.timestamp, _arrivalData("2026-10-30 17:20Z"));
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotActive.selector, id));
        _settlePrivate(id, AIRNODE_PK, rh, block.timestamp, _arrivalData("2026-10-30 17:21Z"));
    }

    function test_Private_RejectBeyondHorizon() public {
        vm.prank(agent);
        vm.expectRevert(FlightDelayCover.BadSchedule.selector);
        cover.buyPrivatePolicy(keccak256("c"), 100e6, holder, bytes32(0), uint64(block.timestamp + 401 days));
    }

    function test_Private_RejectTooCloseToArrival() public {
        bytes32 c = cover.commitmentFor(FLIGHT, DATE, SALT);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                FlightDelayCover.TooCloseToArrival.selector, block.timestamp + 1 hours, block.timestamp + 2 hours
            )
        );
        cover.buyPrivatePolicy(c, 100e6, holder, bytes32(0), uint64(block.timestamp + 1 hours));
    }

    function _privateWithStored(uint64 stored) internal returns (uint256 id, bytes32 rh, bytes memory data, bytes memory sig) {
        vm.prank(agent);
        id = cover.buyPrivatePolicy(cover.commitmentFor(FLIGHT, DATE, SALT), 100e6, holder, bytes32(0), stored);
        vm.warp(SCHEDULED + 4 hours);
        rh = cover.requestHashFor(FLIGHT, DATE, true);
        data = _arrivalData("2026-10-30 17:20Z");
        sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
    }

    function test_Private_AcceptScheduleWithin1h() public {
        (uint256 id, bytes32 rh, bytes memory data, bytes memory sig) = _privateWithStored(uint64(SCHEDULED + 1 hours));
        cover.settlePrivate(id, FLIGHT, DATE, SALT, rh, block.timestamp, data, sig);
        assertEq(usd.balanceOf(holder), 100e6);
    }

    function test_Private_RejectScheduleBeyond1h() public {
        // a buyer who fudges scheduledArrival by more than 1h (e.g. to dodge expiry) cannot be paid
        (uint256 id, bytes32 rh, bytes memory data, bytes memory sig) =
            _privateWithStored(uint64(SCHEDULED + 1 hours + 1));
        vm.expectRevert(
            abi.encodeWithSelector(FlightDelayCover.ScheduleMismatch.selector, SCHEDULED, SCHEDULED + 1 hours + 1)
        );
        cover.settlePrivate(id, FLIGHT, DATE, SALT, rh, block.timestamp, data, sig);
    }

    function test_Private_ExpiresLikePublic() public {
        uint256 id = _buyPrivate();
        vm.warp(SCHEDULED + 3 days);
        cover.expire(id);
        assertEq(uint8(cover.policy(id).status), uint8(FlightDelayCover.Status.Expired));
        assertEq(cover.reserved(), 0);
    }

    function _contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || hay.length < needle.length) return false;
        for (uint256 i; i <= hay.length - needle.length; ++i) {
            bool ok = true;
            for (uint256 j; j < needle.length; ++j) {
                if (hay[i + j] != needle[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function testFuzz_PayoutTiers(uint32 delayMin) public {
        delayMin = uint32(bound(delayMin, 0, 600));
        uint256 id = _buy();
        uint256 actual = SCHEDULED + uint256(delayMin) * 60;
        vm.warp(actual + 10 minutes);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        _settle(id, AIRNODE_PK, rh, block.timestamp, _arrivalData(_fmt(actual)));
        uint256 expected = delayMin >= 180 ? 100e6 : delayMin >= 120 ? 50e6 : 0;
        assertEq(usd.balanceOf(holder), expected);
    }

    function _fmt(uint256 t) internal pure returns (string memory) {
        uint256 s = t - 1793318400; // 2026-10-30 00:00Z; tests stay within +2 days
        uint256 d = 30 + s / 1 days;
        uint256 h = (s % 1 days) / 1 hours;
        uint256 m = (s % 1 hours) / 1 minutes;
        string memory day = d <= 31 ? string(abi.encodePacked("2026-10-", _two(d))) : string(abi.encodePacked("2026-11-", _two(d - 31)));
        return string(abi.encodePacked(day, " ", _two(h), ":", _two(m), "Z"));
    }

    function _two(uint256 v) internal pure returns (string memory) {
        return string(abi.encodePacked(bytes1(uint8(48 + v / 10)), bytes1(uint8(48 + v % 10))));
    }
}
