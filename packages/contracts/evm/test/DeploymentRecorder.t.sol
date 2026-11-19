// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeploymentRecorder} from "../src/DeploymentRecorder.sol";
import {Reputation} from "../src/Reputation.sol";

contract Recorder is DeploymentRecorder {
    function add(string memory name, address addr) external {
        record(name, addr);
    }

    function json() external returns (string memory) {
        return deploymentJson();
    }
}

contract DeploymentRecorderTest is Test {
    function test_WritesTheConfigShape() public {
        vm.chainId(84532);
        Recorder r = new Recorder();
        address rep = address(new Reputation(address(this)));
        r.add("Reputation", rep);
        r.add("Escrow", address(0xBEEF));
        string memory json = r.json();
        assertEq(vm.parseJsonString(json, ".chain"), "eip155:84532");
        assertEq(vm.parseJsonAddress(json, ".contracts.Reputation.address"), rep);
        assertEq(vm.parseJsonAddress(json, ".contracts.Escrow.address"), address(0xBEEF));
        string[] memory names = vm.parseJsonKeys(json, ".contracts");
        assertEq(names.length, 2);
    }

    function test_RefusesAnEmptyRecord() public {
        Recorder r = new Recorder();
        vm.expectRevert("DeploymentRecorder: nothing recorded");
        r.json();
    }

    function test_RefusesTheZeroAddress() public {
        Recorder r = new Recorder();
        vm.expectRevert("DeploymentRecorder: name and address required");
        r.add("Escrow", address(0));
    }
}
