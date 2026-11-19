// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @notice Mix into a deploy script to write `deployments/<chainId>.json` in the shape
/// the codkit config package reads with `contractAddress(deployments, chain, "Name")`:
///
///   { "chain": "eip155:<chainId>", "contracts": { "<Name>": { "address": "0x…" } } }
///
/// ```solidity
/// contract Deploy is Script, DeploymentRecorder {
///     function run() external {
///         vm.startBroadcast();
///         Shop shop = new Shop();
///         vm.stopBroadcast();
///         record("Shop", address(shop));
///         writeDeployments(); // needs fs_permissions = [{ access = "read-write", path = "./deployments" }]
///     }
/// }
/// ```
abstract contract DeploymentRecorder is Script {
    string private constant CONTRACTS = "codkit.deployment.contracts";
    string private _contracts;
    uint256 private _count;

    /// @notice Add (or overwrite) a contract in this run's deployment record.
    function record(string memory name, address addr) internal {
        require(bytes(name).length != 0 && addr != address(0), "DeploymentRecorder: name and address required");
        string memory entry = vm.serializeAddress(string.concat("codkit.deployment.entry.", name), "address", addr);
        _contracts = vm.serializeString(CONTRACTS, name, entry);
        _count++;
    }

    /// @notice The record as JSON.
    function deploymentJson() internal returns (string memory) {
        require(_count != 0, "DeploymentRecorder: nothing recorded");
        string memory root = "codkit.deployment.root";
        vm.serializeString(root, "chain", string.concat("eip155:", vm.toString(block.chainid)));
        return vm.serializeString(root, "contracts", _contracts);
    }

    /// @notice Write `<project>/deployments/<chainId>.json`; returns the path.
    function writeDeployments() internal returns (string memory path) {
        string memory dir = string.concat(vm.projectRoot(), "/deployments");
        vm.createDir(dir, true);
        path = string.concat(dir, "/", vm.toString(block.chainid), ".json");
        vm.writeJson(deploymentJson(), path);
    }

    /// @notice Write the record to a path of your choice.
    function writeDeployments(string memory path) internal {
        vm.writeJson(deploymentJson(), path);
    }
}
