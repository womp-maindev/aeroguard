// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FlightDelayCover} from "../src/FlightDelayCover.sol";
import {MockUSD} from "./FlightDelayCover.t.sol";
import {FixtureLoader} from "./Fixtures.t.sol";

/// @notice Policy #1 of the live deployment (IB1314 MUC→MAD, 30 Oct 2026), replayed on the exact AeroDataBox Airnode
/// signatures that bought and settled it on Base Sepolia. Real buyPolicy and settle paths, deploy-script parameters,
/// no harness and no test signer: if AirnodeHub's signing or hashing differed from the contract's, these would fail.
contract LiveReplayTest is FixtureLoader {
    address constant AERODATABOX_AIRNODE = 0x83FE2E8F24E66520B1902C3507De4F471248f2Ec;
    string constant PROOF = "test/fixtures/IB1314-purchase-proof.json";
    /// written by the keeper when it settled policy #1 (keeper/.cache/evidence), with the on-chain outcome and payout
    string constant SETTLEMENT = "test/fixtures/IB1314-settlement.json";
    uint128 constant COVERAGE = 0.5e6; // as bought on-chain
    address constant HOLDER = address(0xB0B);
    uint64 constant SCHEDULED = 1793395500; // 2026-10-30 21:25Z, as signed by the Airnode

    MockUSD usd;
    FlightDelayCover cover;

    function setUp() public {
        usd = new MockUSD();
        cover = new FlightDelayCover(usd, AERODATABOX_AIRNODE, 800, 1 hours, 5e6); // script/Deploy.s.sol
        usd.mint(address(this), 10e6);
        usd.approve(address(cover), type(uint256).max);
        cover.fundPool(4e6);
    }

    function _buy() internal returns (uint256 id, Fixture memory proof) {
        proof = _load(PROOF);
        vm.warp(proof.timestamp + 60); // the proof must be ≤ 15 min old
        id = cover.buyPolicy(
            proof.flight, proof.date, COVERAGE, HOLDER, bytes32(0), proof.timestamp, proof.data, proof.signature
        );
    }

    function test_Live_IB1314_BoughtWithRealSignedProof() public {
        (uint256 id, Fixture memory proof) = _buy();
        FlightDelayCover.Policy memory p = cover.policy(id);
        assertEq(uint8(p.status), uint8(FlightDelayCover.Status.Active));
        assertEq(p.scheduledArrival, SCHEDULED, "scheduled arrival is read from the signature");
        assertEq(p.statusRequestHash, proof.requestHash, "request hash derived on-chain = AirnodeHub's");
        assertEq(cover.reserved(), COVERAGE);
    }

    function test_Live_IB1314_PurchaseProofCannotSettle() public {
        (uint256 id, Fixture memory proof) = _buy();
        // genuine and fresh, but pre-departure
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotFinal.selector, "Expected"));
        cover.settle(id, proof.requestHash, proof.timestamp, proof.data, proof.signature);
        // older than maxAge: the answer the live contract gave on 30 Oct (README tamper table)
        vm.warp(proof.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, proof.timestamp));
        cover.settle(id, proof.requestHash, proof.timestamp, proof.data, proof.signature);
    }

    function test_Live_IB1314_SettlesLikeOnChain() public {
        if (!vm.exists(SETTLEMENT)) {
            vm.skip(true, "test/fixtures/IB1314-settlement.json is added once the keeper has settled policy #1");
            return;
        }
        (uint256 id,) = _buy();
        Fixture memory s = _load(SETTLEMENT);
        string memory j = vm.readFile(SETTLEMENT);
        vm.warp(s.timestamp + 30);
        cover.settle(id, s.requestHash, s.timestamp, s.data, s.signature);
        assertEq(usd.balanceOf(HOLDER), vm.parseJsonUint(j, ".payout"), "payout as on Base Sepolia");
        string[6] memory names = ["None", "Active", "PaidHalf", "PaidFull", "ClosedNoPayout", "Expired"];
        assertEq(names[uint8(cover.policy(id).status)], vm.parseJsonString(j, ".outcome"), "outcome as on Base Sepolia");
        assertEq(cover.reserved(), 0);
    }
}
