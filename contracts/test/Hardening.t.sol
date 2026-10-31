// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AirnodeV2Attestation} from "../src/AirnodeV2Attestation.sol";
import {FlightDelayCover} from "../src/FlightDelayCover.sol";
import {AirnodeV2Test} from "./AirnodeV2Test.sol";

/// @dev aUSD stand-in that can misbehave on a payout: revert, return false, or re-enter the cover
contract HostileUSD is ERC20("Hostile USD", "hUSD") {
    enum Mode {
        Normal,
        Revert,
        ReturnFalse,
        Reenter
    }

    Mode public mode;
    address public victim; // the address whose incoming transfer misbehaves
    FlightDelayCover public cover;
    bytes internal reentryCall;

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(Mode mode_, address victim_, FlightDelayCover cover_, bytes calldata reentryCall_) external {
        (mode, victim, cover, reentryCall) = (mode_, victim_, cover_, reentryCall_);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (to == victim && mode == Mode.ReturnFalse) return false;
        return super.transfer(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (to == victim && mode == Mode.Revert) revert("payout blocked");
        if (to == victim && mode == Mode.Reenter) {
            // Re-enter the cover in the middle of its payout. Bubble the cover's revert up.
            (bool ok, bytes memory reason) = address(cover).call(reentryCall);
            if (!ok) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
        super._update(from, to, amount);
    }
}

/// @notice Security cases from the FlightShield spec that the main suite does not name explicitly: malformed and
/// malleable signatures, zero-address recovery, payout recipient and amount, failed and re-entrant payouts, and exact
/// timing and payout-tier boundaries. None of them needs a contract change: they pin the deployed behaviour.
contract HardeningTest is AirnodeV2Test {
    uint256 constant AIRNODE_PK = 0xA11CE;
    uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    address airnode;
    HostileUSD usd;
    FlightDelayCover cover;
    address holder = address(0xBEEF);
    address agent = address(0xA6E7);
    address stranger = address(0x5757);

    string constant FLIGHT = "LH1234";
    string constant DATE = "2026-10-30";
    string constant SCHED_STR = "2026-10-30 14:05Z";
    uint256 constant SCHEDULED = 1793369100; // 2026-10-30 14:05Z
    uint128 constant COVERAGE = 100e6;

    uint256 id;
    bytes32 arrivalHash;

    function setUp() public {
        airnode = vm.addr(AIRNODE_PK);
        usd = new HostileUSD();
        cover = new FlightDelayCover(usd, airnode, 800, 1 hours, 1_000e6);
        usd.mint(address(this), 10_000e6);
        usd.approve(address(cover), type(uint256).max);
        cover.fundPool(5_000e6);
        usd.mint(agent, 1_000e6);
        vm.prank(agent);
        usd.approve(address(cover), type(uint256).max);
        vm.warp(SCHEDULED - 6 hours);

        id = _buy();
        arrivalHash = cover.requestHashFor(FLIGHT, DATE, true);
    }

    // ---------------------------------------------------------------------------------------------------- helpers

    function _statusData(string memory status) internal pure returns (bytes memory) {
        return abi.encodePacked('{"scheduled":"', SCHED_STR, '","status":"', status, '"}');
    }

    function _arrivalData(string memory actual) internal pure returns (bytes memory) {
        return abi.encodePacked('{"actual":"', actual, '","scheduled":"', SCHED_STR, '","status":"Arrived"}');
    }

    function _buy() internal returns (uint256 policyId) {
        bytes memory data = _statusData("Expected");
        uint256 ts = block.timestamp - 60;
        bytes memory sig = signResponse(AIRNODE_PK, cover.requestHashFor(FLIGHT, DATE, false), ts, data);
        vm.prank(agent);
        policyId = cover.buyPolicy(FLIGHT, DATE, COVERAGE, holder, bytes32(0), ts, data, sig);
    }

    /// @dev A valid, fresh, final arrival 195 minutes late, signed now
    function _lateArrival() internal returns (uint256 ts, bytes memory data, bytes memory sig) {
        vm.warp(SCHEDULED + 4 hours);
        ts = block.timestamp;
        data = _arrivalData("2026-10-30 17:20Z");
        sig = signResponse(AIRNODE_PK, arrivalHash, ts, data);
    }

    function _status(uint256 policyId) internal view returns (FlightDelayCover.Status) {
        return cover.policy(policyId).status;
    }

    function _assertStillActive() internal view {
        assertEq(uint8(_status(id)), uint8(FlightDelayCover.Status.Active), "policy must stay Active");
        assertEq(cover.reserved(), COVERAGE, "coverage must stay reserved");
        assertEq(usd.balanceOf(holder), 0, "nothing paid");
    }

    // ------------------------------------------------------------------------- malformed and malleable signatures

    function test_RevertWhen_SignatureIsEmpty() public {
        (uint256 ts, bytes memory data,) = _lateArrival();
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 0));
        cover.settle(id, arrivalHash, ts, data, "");
        _assertStillActive();
    }

    function test_RevertWhen_SignatureIsTruncated() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        bytes memory truncated = new bytes(64);
        for (uint256 i; i < 64; ++i) {
            truncated[i] = sig[i];
        }
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 64));
        cover.settle(id, arrivalHash, ts, data, truncated);
        _assertStillActive();
    }

    /// @dev Raw ecrecover returns address(0) for these. The library reverts instead, so a zero signer is never
    /// compared with anything, and a contract deployed with airnode = address(0) still could not be fooled.
    function test_RevertWhen_SignatureRecoversToZero() public {
        (uint256 ts, bytes memory data,) = _lateArrival();
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        cover.settle(id, arrivalHash, ts, data, new bytes(65));

        bytes memory badV = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(1)), uint8(29));
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        cover.settle(id, arrivalHash, ts, data, badV);
        _assertStillActive();
    }

    function test_RevertWhen_SignatureIsTheMalleableTwin() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
        }
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        bytes memory twin = abi.encodePacked(r, highS, uint8(sig[64]) == 27 ? uint8(28) : uint8(27));

        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, highS));
        cover.settle(id, arrivalHash, ts, data, twin);
        _assertStillActive();
    }

    function test_RevertWhen_OneSignatureBitIsFlipped() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        sig[7] ^= 0x01; // a bit of r

        // Another r recovers another address, or none if it is no longer a point on the curve.
        try cover.settle(id, arrivalHash, ts, data, sig) {
            fail("a flipped signature bit must revert");
        } catch (bytes memory reason) {
            bytes4 selector = bytes4(reason);
            assertTrue(
                selector == AirnodeV2Attestation.NotSignedByAirnode.selector
                    || selector == ECDSA.ECDSAInvalidSignature.selector
            );
        }
        _assertStillActive();
    }

    /// @dev The constructor does not reject airnode = address(0). This pins that such a deployment fails closed: no
    /// signature, valid or malformed, can ever match a zero signer, so nobody can even buy cover.
    function test_ZeroAirnodeDeploymentFailsClosed() public {
        FlightDelayCover broken = new FlightDelayCover(usd, address(0), 800, 1 hours, 1_000e6);
        usd.approve(address(broken), type(uint256).max);
        broken.fundPool(1_000e6);
        bytes32 statusHash = broken.requestHashFor(FLIGHT, DATE, false);
        bytes memory data = _statusData("Expected");
        uint256 ts = block.timestamp;

        bytes memory sig = signResponse(AIRNODE_PK, statusHash, ts, data);
        vm.expectRevert(abi.encodeWithSelector(AirnodeV2Attestation.NotSignedByAirnode.selector, airnode));
        broken.buyPolicy(FLIGHT, DATE, COVERAGE, holder, bytes32(0), ts, data, sig);

        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        broken.buyPolicy(FLIGHT, DATE, COVERAGE, holder, bytes32(0), ts, data, new bytes(65));
    }

    // ------------------------------------------------------------------------------ payout recipient and amount

    /// @dev A stranger copies the keeper's valid settlement from the mempool: the money still goes to the holder.
    function test_StrangerSettling_PaysTheStoredHolderTheStoredCoverage() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        vm.prank(stranger);
        cover.settle(id, arrivalHash, ts, data, sig);

        assertEq(usd.balanceOf(holder), COVERAGE, "holder gets exactly the stored coverage");
        assertEq(usd.balanceOf(stranger), 0, "the caller gets nothing");
        assertEq(uint8(_status(id)), uint8(FlightDelayCover.Status.PaidFull));
        assertEq(cover.reserved(), 0);
    }

    function test_RevertWhen_SettledTwiceWithTheSameEvidence() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        cover.settle(id, arrivalHash, ts, data, sig);

        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotActive.selector, id));
        vm.prank(stranger);
        cover.settle(id, arrivalHash, ts, data, sig);
        assertEq(usd.balanceOf(holder), COVERAGE, "no second payout");
    }

    // ---------------------------------------------------------------------------- failed and re-entrant payouts

    function test_RevertWhen_PayoutTransferReverts_PolicyStaysActive() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        usd.arm(HostileUSD.Mode.Revert, holder, cover, "");

        vm.expectRevert("payout blocked");
        cover.settle(id, arrivalHash, ts, data, sig);
        _assertStillActive();

        // Once the transfer works again, the same evidence settles normally: no state was left half-written.
        usd.arm(HostileUSD.Mode.Normal, address(0), cover, "");
        cover.settle(id, arrivalHash, ts, data, sig);
        assertEq(usd.balanceOf(holder), COVERAGE);
    }

    /// @dev Tokens that return false instead of reverting are why the contract uses SafeERC20
    function test_RevertWhen_PayoutTransferReturnsFalse_PolicyStaysActive() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        usd.arm(HostileUSD.Mode.ReturnFalse, holder, cover, "");

        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(usd)));
        cover.settle(id, arrivalHash, ts, data, sig);
        _assertStillActive();
    }

    function test_RevertWhen_PayoutReentersSettle() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        bytes memory reentry = abi.encodeCall(FlightDelayCover.settle, (id, arrivalHash, ts, data, sig));
        usd.arm(HostileUSD.Mode.Reenter, holder, cover, reentry);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        cover.settle(id, arrivalHash, ts, data, sig);
        _assertStillActive();
    }

    function test_RevertWhen_PayoutReentersBuyPolicy() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        bytes memory reentry =
            abi.encodeCall(FlightDelayCover.buyPolicy, (FLIGHT, DATE, COVERAGE, holder, bytes32(0), ts, data, sig));
        usd.arm(HostileUSD.Mode.Reenter, holder, cover, reentry);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        cover.settle(id, arrivalHash, ts, data, sig);
        _assertStillActive();
    }

    // ------------------------------------------------------------------------------------- timing boundaries

    function test_AcceptsSettlementExactlyAtMaxAge() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        vm.warp(ts + cover.policy(id).maxAge);
        cover.settle(id, arrivalHash, ts, data, sig);
        assertEq(usd.balanceOf(holder), COVERAGE);
    }

    function test_RevertWhen_SettlementIsOneSecondPastMaxAge() public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        vm.warp(ts + cover.policy(id).maxAge + 1);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, ts));
        cover.settle(id, arrivalHash, ts, data, sig);
        _assertStillActive();
    }

    function test_FutureSkewBoundary() public {
        vm.warp(SCHEDULED + 4 hours);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");

        uint256 tooFar = block.timestamp + cover.MAX_FUTURE_SKEW() + 1;
        bytes memory sig = signResponse(AIRNODE_PK, arrivalHash, tooFar, data);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.FromTheFuture.selector, tooFar));
        cover.settle(id, arrivalHash, tooFar, data, sig);

        uint256 edge = block.timestamp + cover.MAX_FUTURE_SKEW();
        sig = signResponse(AIRNODE_PK, arrivalHash, edge, data);
        cover.settle(id, arrivalHash, edge, data, sig);
        assertEq(usd.balanceOf(holder), COVERAGE);
    }

    function test_PurchaseProofAgeBoundary() public {
        bytes32 statusHash = cover.requestHashFor(FLIGHT, DATE, false);
        bytes memory data = _statusData("Expected");
        uint256 ts = block.timestamp;
        bytes memory sig = signResponse(AIRNODE_PK, statusHash, ts, data);

        vm.warp(ts + cover.PURCHASE_MAX_AGE() + 1);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, ts));
        vm.prank(agent);
        cover.buyPolicy(FLIGHT, DATE, COVERAGE, holder, bytes32(0), ts, data, sig);

        vm.warp(ts + cover.PURCHASE_MAX_AGE());
        vm.prank(agent);
        cover.buyPolicy(FLIGHT, DATE, COVERAGE, holder, bytes32(0), ts, data, sig);
    }

    function test_RevertWhen_SettlingAnExpiredPolicy() public {
        vm.warp(SCHEDULED + cover.SETTLEMENT_WINDOW() + 1);
        cover.expire(id);
        bytes memory data = _arrivalData("2026-10-30 17:20Z");
        bytes memory sig = signResponse(AIRNODE_PK, arrivalHash, block.timestamp, data);

        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotActive.selector, id));
        cover.settle(id, arrivalHash, block.timestamp, data, sig);
    }

    // ---------------------------------------------------------------------------------- payout-tier boundaries

    function _settleArrivingAt(string memory actual) internal returns (FlightDelayCover.Status) {
        vm.warp(SCHEDULED + 4 hours);
        bytes memory data = _arrivalData(actual);
        cover.settle(
            id, arrivalHash, block.timestamp, data, signResponse(AIRNODE_PK, arrivalHash, block.timestamp, data)
        );
        return _status(id);
    }

    function test_Tier_119MinutesPaysNothing() public {
        assertEq(uint8(_settleArrivingAt("2026-10-30 16:04Z")), uint8(FlightDelayCover.Status.ClosedNoPayout));
        assertEq(usd.balanceOf(holder), 0);
    }

    function test_Tier_Exactly120MinutesPaysHalf() public {
        assertEq(uint8(_settleArrivingAt("2026-10-30 16:05Z")), uint8(FlightDelayCover.Status.PaidHalf));
        assertEq(usd.balanceOf(holder), COVERAGE / 2);
    }

    function test_Tier_179MinutesPaysHalf() public {
        assertEq(uint8(_settleArrivingAt("2026-10-30 17:04Z")), uint8(FlightDelayCover.Status.PaidHalf));
        assertEq(usd.balanceOf(holder), COVERAGE / 2);
    }

    function test_Tier_Exactly180MinutesPaysFull() public {
        assertEq(uint8(_settleArrivingAt("2026-10-30 17:05Z")), uint8(FlightDelayCover.Status.PaidFull));
        assertEq(usd.balanceOf(holder), COVERAGE);
    }

    // ------------------------------------------------------------------------------------------------- fuzz

    function testFuzz_RevertWhen_DataIsNotWhatWasSigned(bytes calldata forged) public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        vm.assume(keccak256(forged) != keccak256(data));

        vm.expectPartialRevert(AirnodeV2Attestation.NotSignedByAirnode.selector);
        cover.settle(id, arrivalHash, ts, forged, sig);
    }

    function testFuzz_RevertWhen_SignedByAnyOtherKey(uint256 key) public {
        key = bound(key, 1, SECP256K1_N - 1);
        vm.assume(key != AIRNODE_PK);
        (uint256 ts, bytes memory data,) = _lateArrival();
        bytes memory sig = signResponse(key, arrivalHash, ts, data);

        vm.expectRevert(abi.encodeWithSelector(AirnodeV2Attestation.NotSignedByAirnode.selector, vm.addr(key)));
        cover.settle(id, arrivalHash, ts, data, sig);
    }

    /// @dev Even with a valid Airnode signature over that hash: the request must be one of the policy's own two
    function testFuzz_RevertWhen_RequestIsNotThePolicys(bytes32 otherRequest) public {
        vm.assume(otherRequest != arrivalHash && otherRequest != cover.requestHashFor(FLIGHT, DATE, false));
        (uint256 ts, bytes memory data,) = _lateArrival();
        bytes memory sig = signResponse(AIRNODE_PK, otherRequest, ts, data);

        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.WrongRequest.selector, otherRequest));
        cover.settle(id, otherRequest, ts, data, sig);
    }

    function testFuzz_RevertWhen_SignatureHasWrongLength(bytes calldata sig) public {
        vm.assume(sig.length != 65);
        (uint256 ts, bytes memory data,) = _lateArrival();

        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, sig.length));
        cover.settle(id, arrivalHash, ts, data, sig);
    }

    function testFuzz_RevertWhen_PolicyIdIsUnknown(uint256 unknown) public {
        vm.assume(unknown != id);
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();

        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotActive.selector, unknown));
        cover.settle(unknown, arrivalHash, ts, data, sig);
    }

    function testFuzz_Freshness(uint256 age) public {
        (uint256 ts, bytes memory data, bytes memory sig) = _lateArrival();
        uint256 maxAge = cover.policy(id).maxAge;
        age = bound(age, 0, 2 * maxAge);
        vm.warp(ts + age);

        if (age > maxAge) vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, ts));
        cover.settle(id, arrivalHash, ts, data, sig);
    }
}
