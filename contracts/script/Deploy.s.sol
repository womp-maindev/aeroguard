// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FlightDelayCover} from "../src/FlightDelayCover.sol";

/// forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $DEPLOYER_PK --verify
contract Deploy is Script {
    // aUSD on Base Sepolia (AirnodeHub test dollar) and the AeroDataBox Airnode signer
    address constant AUSD = 0xbeA34973e5f67F18F656A2C6070C64326C791808;
    address constant AERODATABOX_AIRNODE = 0x83FE2E8F24E66520B1902C3507De4F471248f2Ec;

    function run() external returns (FlightDelayCover cover) {
        vm.startBroadcast();
        // 8% premium, signed responses valid for 1h at settlement, max 5 aUSD cover (faucet gives 10 aUSD per account) per policy
        cover = new FlightDelayCover(IERC20(AUSD), AERODATABOX_AIRNODE, 800, 1 hours, 5e6);
        vm.stopBroadcast();
        console.log("FlightDelayCover", address(cover));
    }
}
