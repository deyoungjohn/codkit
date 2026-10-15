// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ReceiptAnchor
/// @notice Stateless notary: anyone can anchor the head hash of their receipt log.
///         The event is the record; index by `logger` to find an agent's checkpoints.
contract ReceiptAnchor {
    event Anchored(address indexed logger, bytes32 indexed head, uint64 seq, string uri);

    /// @param head hash of the latest receipt (commits to the whole chain before it)
    /// @param seq  sequence number of that receipt
    /// @param uri  where the full log lives (walrus://…, ipfs://…, https://…), may be empty
    function anchor(bytes32 head, uint64 seq, string calldata uri) external {
        emit Anchored(msg.sender, head, seq, uri);
    }
}
