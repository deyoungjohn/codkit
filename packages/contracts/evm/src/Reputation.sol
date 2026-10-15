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

    /// Counters are only as meaningful as the deals behind them: any token and any
    /// counterparty can produce them (including a worthless token between two of the
    /// same person's addresses). Weigh them using the `Recorded` events, e.g. counting
    /// only deals in tokens you trust. `volume` sums raw amounts across all tokens.
    struct Stats {
        uint64 completed;
        uint64 refunded;
        uint64 disputed;
        uint128 volume; // sum of completed amounts, in each deal's token units (mixed tokens summed as-is)
    }

    address public owner;
    /// Two-step ownership: the new owner must accept, so a typo can't brick `setWriter`.
    address public pendingOwner;
    mapping(address => bool) public isWriter;
    mapping(address => Stats) internal _stats;

    event WriterSet(address indexed writer, bool allowed);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event Recorded(
        address indexed subject, address indexed counterparty, Outcome indexed outcome, uint256 amount, bytes32 ref
    );

    error NotOwner();
    error NotWriter();
    error ZeroAddress();

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
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

    /// @notice Start a transfer; `newOwner` must call `acceptOwnership`. Pass address(0) to cancel.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner || msg.sender == address(0)) revert NotOwner();
        emit OwnerTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
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
            // forge-lint: disable-next-line(unsafe-typecast) — clamped to uint128 max on the line itself
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
