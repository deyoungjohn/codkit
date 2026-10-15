// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Escrow} from "../src/Escrow.sol";
import {Reputation} from "../src/Reputation.sol";

/// Deploys Reputation + Escrow and authorises the escrow as a reputation writer.
///
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --account <keystore> --broadcast [--verify]
///
/// Run by a human, on a testnet. The deployer becomes the Reputation owner.
contract Deploy is Script {
    function run() external returns (Reputation rep, Escrow escrow) {
        vm.startBroadcast();
        address owner = msg.sender;
        rep = new Reputation(owner);
        escrow = new Escrow(rep);
        rep.setWriter(address(escrow), true);
        vm.stopBroadcast();

        console.log("chainId    ", block.chainid);
        console.log("Reputation ", address(rep));
        console.log("Escrow     ", address(escrow));
    }
}
