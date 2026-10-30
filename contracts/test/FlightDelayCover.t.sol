// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AirnodeV2Attestation} from "../src/AirnodeV2Attestation.sol";
import {FlightDelayCover} from "../src/FlightDelayCover.sol";
import {AirnodeV2Test} from "./AirnodeV2Test.sol";

contract MockUSD is ERC20("AirnodeHub USD", "aUSD") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// @notice Includes the four API3 tamper tests (edited value, too old, other request, wrong signer) plus replay,
/// future timestamp, observation-before-landing, solvency and payout tiers.
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

    function _buy() internal returns (uint256 id) {
        vm.prank(agent);
        id = cover.buyPolicy(FLIGHT, DATE, uint64(SCHEDULED), 100e6, holder, keccak256("masumi-job-1"));
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

    function test_RejectReplayOnAnotherPolicy() public {
        uint256 a = _buy();
        uint256 b = _buy(); // same flight, second buyer
        vm.warp(SCHEDULED + 4 hours);
        bytes32 rh = cover.requestHashFor(FLIGHT, DATE, true);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, rh, block.timestamp, data);
        cover.settle(a, rh, block.timestamp, data, sig);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.ResponseReused.selector, keccak256(sig)));
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
        vm.expectPartialRevert(FlightDelayCover.Insolvent.selector);
        empty.buyPolicy(FLIGHT, DATE, uint64(SCHEDULED), 100e6, holder, bytes32(0));
        vm.stopPrank();
    }

    function test_RejectFlightNeedingJsonEscape() public {
        vm.prank(agent);
        vm.expectRevert(FlightDelayCover.BadFlight.selector);
        cover.buyPolicy('LH"1', DATE, uint64(SCHEDULED), 100e6, holder, bytes32(0));
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
