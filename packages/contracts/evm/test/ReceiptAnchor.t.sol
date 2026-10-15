// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptAnchor} from "../src/ReceiptAnchor.sol";

contract ReceiptAnchorTest is Test {
    function test_emitsAnchored() public {
        ReceiptAnchor a = new ReceiptAnchor();
        bytes32 head = keccak256("head");
        vm.expectEmit(true, true, false, true);
        emit ReceiptAnchor.Anchored(address(this), head, 42, "walrus://abc");
        a.anchor(head, 42, "walrus://abc");
    }
}
