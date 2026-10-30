// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AirnodeV2Attestation} from "../src/AirnodeV2Attestation.sol";
import {FlightDelayCover} from "../src/FlightDelayCover.sol";
import {ProjectedJson} from "../src/ProjectedJson.sol";
import {MockUSD} from "./FlightDelayCover.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Test-only: opens a public policy without a purchase proof, so a captured SETTLEMENT response can be replayed
/// even when no matching purchase-time status response was captured.
contract CoverHarness is FlightDelayCover {
    constructor(IERC20 t, address a) FlightDelayCover(t, a, 800, 1 hours, 1_000e6) {}

    function openForTest(string calldata flight, string calldata date, uint64 scheduled, uint128 coverage, address holder)
        external
        returns (uint256 id)
    {
        Policy storage p;
        (id, p) = _open(scheduled, coverage, holder, bytes32(0));
        p.arrivalRequestHash = requestHashFor(flight, date, true);
        p.statusRequestHash = requestHashFor(flight, date, false);
        p.flight = flight;
        p.date = date;
    }
}

/// @notice Replays captured signed responses from test/fixtures/*.json against the contract.
/// Fixture format (what the agent gets back from AirnodeHub, plus the request it asked for):
/// { "flight": "LH1234", "date": "2026-10-30", "kind": "arrival" | "status",
///   "airnode": "0x…", "requestHash": "0x…", "timestamp": 1793381400,
///   "data": "<exact signed JSON string>", "signature": "0x…" }
/// test/fixtures/aerodatabox-arrival.json (a REAL capture) is optional: the test skips while it is missing.
contract FixturesTest is Test {
    address constant AERODATABOX_AIRNODE = 0x83FE2E8F24E66520B1902C3507De4F471248f2Ec;
    string constant REAL = "test/fixtures/aerodatabox-arrival.json";
    string constant SAMPLE = "test/fixtures/sample-signed-arrival.json";

    struct Fixture {
        string flight;
        string date;
        bool arrival;
        address airnode;
        bytes32 requestHash;
        uint256 timestamp;
        bytes data;
        bytes signature;
    }

    function _load(string memory path) internal view returns (Fixture memory f) {
        string memory j = vm.readFile(path);
        f.flight = vm.parseJsonString(j, ".flight");
        f.date = vm.parseJsonString(j, ".date");
        f.arrival = keccak256(bytes(vm.parseJsonString(j, ".kind"))) == keccak256("arrival");
        f.airnode = vm.parseJsonAddress(j, ".airnode");
        f.requestHash = vm.parseJsonBytes32(j, ".requestHash");
        f.timestamp = vm.parseJsonUint(j, ".timestamp");
        f.data = bytes(vm.parseJsonString(j, ".data"));
        f.signature = vm.parseJsonBytes(j, ".signature");
    }

    /// @dev Checks signer + intended request, then settles a fresh policy with it end to end when the data is final.
    function _replay(Fixture memory f, address expectedSigner) internal returns (MockUSD usd, bool settled) {
        assertEq(f.airnode, expectedSigner, "fixture airnode field");
        assertEq(
            AirnodeV2Attestation.recoverSigner(f.requestHash, f.timestamp, f.data, f.signature),
            expectedSigner,
            "recovered signer"
        );

        usd = new MockUSD();
        CoverHarness cover = new CoverHarness(usd, expectedSigner);
        assertEq(f.requestHash, cover.requestHashFor(f.flight, f.date, f.arrival), "requestHash != requestHashFor");

        // tamper: one edited byte of the captured data must be rejected
        bytes memory edited = bytes.concat(f.data);
        edited[edited.length - 2] = edited[edited.length - 2] == "0" ? bytes1("1") : bytes1("0");
        assertTrue(
            AirnodeV2Attestation.recoverSigner(f.requestHash, f.timestamp, edited, f.signature) != expectedSigner,
            "edited data still verifies"
        );

        string memory status = ProjectedJson.readString(f.data, "status");
        bool isFinal = keccak256(bytes(status)) == keccak256(f.arrival ? bytes("Arrived") : bytes("Canceled"));
        if (!isFinal) return (usd, false); // signature + hash checks above are the point; a non-final status cannot settle

        usd.mint(address(this), 10_000e6);
        usd.approve(address(cover), type(uint256).max);
        cover.fundPool(5_000e6);
        vm.warp(f.timestamp + 1);
        uint64 sched = uint64(ProjectedJson.readTimestamp(f.data, "scheduled"));
        uint256 id = cover.openForTest(f.flight, f.date, sched, 100e6, address(0xBEEF));
        cover.settle(id, f.requestHash, f.timestamp, f.data, f.signature);
        assertTrue(cover.policy(id).status != FlightDelayCover.Status.Active, "not settled");
        settled = true;
    }

    function test_Fixture_SyntheticSampleLoadsAndSettles() public {
        (MockUSD usd, bool settled) = _replay(_load(SAMPLE), vm.addr(0xA11CE));
        assertTrue(settled);
        assertEq(usd.balanceOf(address(0xBEEF)), 100e6); // 3h15m late: full payout
    }

    function test_Fixture_RealAeroDataBoxCapture() public {
        if (!vm.exists(REAL)) {
            vm.skip(true, "no test/fixtures/aerodatabox-arrival.json captured yet");
            return;
        }
        _replay(_load(REAL), AERODATABOX_AIRNODE);
    }
}
