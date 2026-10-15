// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Escrow} from "../src/Escrow.sol";
import {Reputation} from "../src/Reputation.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";

/// Deploys Reputation + Escrow (+ ReceiptAnchor) and authorises the escrow as a reputation writer.
///
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --account <keystore> --broadcast [--verify]
///
/// Run by a human, on a testnet. The deployer becomes the Reputation owner.
contract Deploy is Script {
    function run() external returns (Reputation rep, Escrow escrow, ReceiptAnchor anchor) {
        vm.startBroadcast();
        address owner = msg.sender;
        rep = new Reputation(owner);
        escrow = new Escrow(rep);
        rep.setWriter(address(escrow), true);
        anchor = new ReceiptAnchor();
        vm.stopBroadcast();

        console.log("chainId    ", block.chainid);
        console.log("Reputation ", address(rep));
        console.log("Escrow     ", address(escrow));
        console.log("Anchor     ", address(anchor));
    }
}
