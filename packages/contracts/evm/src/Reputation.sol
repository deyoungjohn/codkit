// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Reputation
/// @notice Minimal onchain track record. Authorised writers (e.g. the Escrow) record
///         outcomes; anyone can read counters. Intentionally tiny so it can sit next
///         to richer identity standards (ERC-8004 etc.) without competing with them.
contract Reputation {
    enum Outcome {
        Completed,
        Refunded,
        Disputed
    }

    struct Stats {
        uint64 completed;
        uint64 refunded;
        uint64 disputed;
        uint128 volume; // sum of completed amounts, in the deal's token units
    }

    address public owner;
    mapping(address => bool) public isWriter;
    mapping(address => Stats) internal _stats;

    event WriterSet(address indexed writer, bool allowed);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event Recorded(
        address indexed subject, address indexed counterparty, Outcome indexed outcome, uint256 amount, bytes32 ref
    );

    error NotOwner();
    error NotWriter();

    constructor(address owner_) {
        owner = owner_;
        emit OwnerTransferred(address(0), owner_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setWriter(address writer, bool allowed) external onlyOwner {
        isWriter[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @param subject     whose record changes (usually the service provider)
    /// @param counterparty the other side (usually the client)
    /// @param ref         opaque reference, e.g. the escrow deal id
    function record(address subject, address counterparty, Outcome outcome, uint256 amount, bytes32 ref) external {
        if (!isWriter[msg.sender]) revert NotWriter();
        Stats storage s = _stats[subject];
        if (outcome == Outcome.Completed) {
            s.completed += 1;
            // saturate rather than revert: reputation must never block a payout
            uint256 v = uint256(s.volume) + amount;
            s.volume = v > type(uint128).max ? type(uint128).max : uint128(v);
        } else if (outcome == Outcome.Refunded) {
            s.refunded += 1;
        } else {
            s.disputed += 1;
        }
        emit Recorded(subject, counterparty, outcome, amount, ref);
    }

    function stats(address subject) external view returns (Stats memory) {
        return _stats[subject];
    }

    /// @notice Completion rate in basis points (0..10000); 0 when there is no history.
    function score(address subject) external view returns (uint256) {
        Stats memory s = _stats[subject];
        uint256 total = uint256(s.completed) + s.refunded + s.disputed;
        return total == 0 ? 0 : (uint256(s.completed) * 10_000) / total;
    }
}
