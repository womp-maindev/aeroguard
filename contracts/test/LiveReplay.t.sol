// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FlightDelayCover} from "../src/FlightDelayCover.sol";
import {ProjectedJson} from "../src/ProjectedJson.sol";
import {MockUSD} from "./FlightDelayCover.t.sol";
import {FixtureLoader} from "./Fixtures.t.sol";

/// @notice The four policies of the live deployment (30 Oct 2026, from Munich), replayed on the exact AeroDataBox
/// Airnode signatures that bought and settled them on Base Sepolia. Real buyPolicy and settle paths, deploy-script
/// parameters, no harness and no test signer: if AirnodeHub's signing or hashing differed from the contract's, these
/// would fail.
/// Purchase proofs: test/fixtures/<FLIGHT>-purchase-proof.json, read back from each buyPolicy calldata
/// (keeper `cli proof <tx>`). Settlements: test/fixtures/<FLIGHT>-settlement.json, written by the keeper when it settled
/// the policy, with the on-chain outcome and payout; until then the settlement replay is skipped.
contract LiveReplayTest is FixtureLoader {
    address constant AERODATABOX_AIRNODE = 0x83FE2E8F24E66520B1902C3507De4F471248f2Ec;
    uint128 constant COVERAGE = 0.5e6; // as bought on-chain
    address constant HOLDER = address(0xB0B);

    MockUSD usd;
    FlightDelayCover cover;

    function setUp() public {
        usd = new MockUSD();
        cover = new FlightDelayCover(usd, AERODATABOX_AIRNODE, 800, 1 hours, 5e6); // script/Deploy.s.sol
        usd.mint(address(this), 10e6);
        usd.approve(address(cover), type(uint256).max);
        cover.fundPool(4e6);
    }

    function _path(string memory flight, string memory what) internal pure returns (string memory) {
        return string.concat("test/fixtures/", flight, "-", what, ".json");
    }

    function _buy(string memory flight) internal returns (uint256 id, Fixture memory proof) {
        string memory path = _path(flight, "purchase-proof");
        if (!vm.exists(path)) {
            vm.skip(true, string.concat(path, " not extracted yet"));
            return (0, proof);
        }
        proof = _load(path);
        assertEq(proof.flight, flight);
        vm.warp(proof.timestamp + 60); // the proof must be at most 15 min old
        id = cover.buyPolicy(
            proof.flight, proof.date, COVERAGE, HOLDER, bytes32(0), proof.timestamp, proof.data, proof.signature
        );
    }

    function _bought(string memory flight) internal {
        (uint256 id, Fixture memory proof) = _buy(flight);
        if (id == 0) return;
        FlightDelayCover.Policy memory p = cover.policy(id);
        assertEq(uint8(p.status), uint8(FlightDelayCover.Status.Active));
        assertEq(
            p.scheduledArrival, ProjectedJson.readTimestamp(proof.data, "scheduled"), "scheduled from the signature"
        );
        assertEq(p.statusRequestHash, proof.requestHash, "request hash derived on-chain = AirnodeHub's");
        assertEq(cover.reserved(), COVERAGE);
    }

    function _settles(string memory flight) internal {
        string memory path = _path(flight, "settlement");
        if (!vm.exists(path)) {
            vm.skip(true, string.concat(path, " is added once the keeper has settled this policy"));
            return;
        }
        (uint256 id,) = _buy(flight);
        if (id == 0) return;
        Fixture memory s = _load(path);
        string memory j = vm.readFile(path);
        vm.warp(s.timestamp + 30);
        cover.settle(id, s.requestHash, s.timestamp, s.data, s.signature);
        assertEq(usd.balanceOf(HOLDER), vm.parseJsonUint(j, ".payout"), "payout as on Base Sepolia");
        string[6] memory names = ["None", "Active", "PaidHalf", "PaidFull", "ClosedNoPayout", "Expired"];
        assertEq(names[uint8(cover.policy(id).status)], vm.parseJsonString(j, ".outcome"), "outcome as on Base Sepolia");
        assertEq(cover.reserved(), 0);
    }

    // ------------------------------------------------------------------ policy #1, IB1314 MUC→MAD

    function test_Live_IB1314_BoughtWithRealSignedProof() public {
        _bought("IB1314");
        assertEq(cover.policy(1).scheduledArrival, 1793395500, "2026-10-30 21:25Z");
    }

    function test_Live_IB1314_PurchaseProofCannotSettle() public {
        (uint256 id, Fixture memory proof) = _buy("IB1314");
        // genuine and fresh, but pre-departure
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.NotFinal.selector, "Expected"));
        cover.settle(id, proof.requestHash, proof.timestamp, proof.data, proof.signature);
        // older than maxAge: the answer the live contract gave on 30 Oct (README tamper table)
        vm.warp(proof.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(FlightDelayCover.Stale.selector, proof.timestamp));
        cover.settle(id, proof.requestHash, proof.timestamp, proof.data, proof.signature);
    }

    function test_Live_IB1314_SettlesLikeOnChain() public {
        _settles("IB1314");
    }

    // ------------------------------------------------------------------ policies #2–#4

    function test_Live_LH1816_BoughtWithRealSignedProof() public {
        _bought("LH1816");
    }

    function test_Live_LH1816_SettlesLikeOnChain() public {
        _settles("LH1816");
    }

    function test_Live_EI357_BoughtWithRealSignedProof() public {
        _bought("EI357");
    }

    function test_Live_EI357_SettlesLikeOnChain() public {
        _settles("EI357");
    }

    function test_Live_BA955_BoughtWithRealSignedProof() public {
        _bought("BA955");
    }

    function test_Live_BA955_SettlesLikeOnChain() public {
        _settles("BA955");
    }
}
