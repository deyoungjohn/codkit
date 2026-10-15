// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Reputation} from "./Reputation.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
}

/// @title Escrow
/// @notice ERC20 escrow for agent ↔ agent / human ↔ agent deals.
///
///   create ─▶ fund ─▶ deliver ─▶ release (client / arbiter)
///     │         │        │   └──▶ claim   (provider, after the review period)
///     │         │        └─────▶ dispute (client) ─▶ arbiter release / refund
///     │         └──────────────▶ refund  (client after deadline, provider any time, arbiter)
///     └──▶ cancel (client, before funding)
///
/// Outcomes are recorded in an optional `Reputation` contract. Recording can never
/// block a payout. Not audited — testnets and hackathon demos only.
contract Escrow {
    enum Status {
        None,
        Created,
        Funded,
        Delivered,
        Disputed,
        Released,
        Refunded,
        Cancelled
    }

    struct Deal {
        address client;
        uint64 deadline; // provider must deliver by this time
        Status status;
        address provider;
        uint64 deliveredAt;
        address arbiter; // address(0) = no arbiter, no disputes
        uint32 reviewPeriod; // seconds the client has after delivery before the provider can claim
        address token;
        uint256 amount;
        bytes32 termsHash; // hash / CID of what was agreed
        bytes32 deliveryHash; // hash / CID of what was delivered
    }

    Reputation public immutable reputation;
    uint256 public dealCount;
    mapping(uint256 => Deal) internal _deals;
    uint256 private _lock = 1;

    event DealCreated(
        uint256 indexed id,
        address indexed client,
        address indexed provider,
        address arbiter,
        address token,
        uint256 amount,
        uint64 deadline,
        uint32 reviewPeriod,
        bytes32 termsHash
    );
    event Funded(uint256 indexed id, uint256 amount);
    event Delivered(uint256 indexed id, bytes32 deliveryHash);
    event Disputed(uint256 indexed id, address indexed by);
    event Released(uint256 indexed id, address indexed to, uint256 amount, address by);
    event Refunded(uint256 indexed id, address indexed to, uint256 amount, address by);
    event Cancelled(uint256 indexed id);

    error InvalidParams();
    error WrongStatus(Status current);
    error Unauthorized();
    error TooEarly();
    error TooLate();
    error TransferFailed();
    error Reentrancy();

    constructor(Reputation reputation_) {
        reputation = reputation_;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ------------------------------------------------------------------ create

    function createDeal(
        address provider,
        address arbiter,
        address token,
        uint256 amount,
        uint64 deadline,
        uint32 reviewPeriod,
        bytes32 termsHash
    ) public returns (uint256 id) {
        if (
            provider == address(0) || provider == msg.sender || token == address(0) || amount == 0
                || deadline <= block.timestamp || arbiter == provider || arbiter == msg.sender
        ) revert InvalidParams();
        id = ++dealCount;
        _deals[id] = Deal({
            client: msg.sender,
            deadline: deadline,
            status: Status.Created,
            provider: provider,
            deliveredAt: 0,
            arbiter: arbiter,
            reviewPeriod: reviewPeriod,
            token: token,
            amount: amount,
            termsHash: termsHash,
            deliveryHash: bytes32(0)
        });
        emit DealCreated(id, msg.sender, provider, arbiter, token, amount, deadline, reviewPeriod, termsHash);
    }

    /// @notice Pull `amount` from the client (approve first). Rejects fee-on-transfer tokens.
    function fund(uint256 id) public nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.client) revert Unauthorized();
        _expect(d, Status.Created);
        d.status = Status.Funded;
        uint256 before = IERC20Min(d.token).balanceOf(address(this));
        _call(d.token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), d.amount)); // transferFrom
        if (IERC20Min(d.token).balanceOf(address(this)) - before != d.amount) revert TransferFailed();
        emit Funded(id, d.amount);
    }

    function createAndFund(
        address provider,
        address arbiter,
        address token,
        uint256 amount,
        uint64 deadline,
        uint32 reviewPeriod,
        bytes32 termsHash
    ) external returns (uint256 id) {
        id = createDeal(provider, arbiter, token, amount, deadline, reviewPeriod, termsHash);
        fund(id);
    }

    function cancel(uint256 id) external {
        Deal storage d = _deals[id];
        if (msg.sender != d.client) revert Unauthorized();
        _expect(d, Status.Created);
        d.status = Status.Cancelled;
        emit Cancelled(id);
    }

    // ----------------------------------------------------------------- deliver

    function deliver(uint256 id, bytes32 deliveryHash) external {
        Deal storage d = _deals[id];
        if (msg.sender != d.provider) revert Unauthorized();
        _expect(d, Status.Funded);
        if (block.timestamp > d.deadline) revert TooLate();
        d.status = Status.Delivered;
        d.deliveredAt = uint64(block.timestamp);
        d.deliveryHash = deliveryHash;
        emit Delivered(id, deliveryHash);
    }

    /// @notice Client contests a delivery during the review period. Needs an arbiter.
    function dispute(uint256 id) external {
        Deal storage d = _deals[id];
        if (msg.sender != d.client || d.arbiter == address(0)) revert Unauthorized();
        _expect(d, Status.Delivered);
        if (block.timestamp >= uint256(d.deliveredAt) + d.reviewPeriod) revert TooLate();
        d.status = Status.Disputed;
        _record(d, Reputation.Outcome.Disputed, id);
        emit Disputed(id, msg.sender);
    }

    // ------------------------------------------------------------------ settle

    /// @notice Pay the provider. Client: when Funded/Delivered. Arbiter: also when Disputed.
    function release(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        bool isArbiter = msg.sender == d.arbiter && d.arbiter != address(0);
        if (msg.sender != d.client && !isArbiter) revert Unauthorized();
        Status s = d.status;
        if (!(s == Status.Funded || s == Status.Delivered || (s == Status.Disputed && isArbiter))) {
            revert WrongStatus(s);
        }
        _payProvider(d, id);
    }

    /// @notice Provider collects once the review period after delivery has passed without a dispute.
    function claim(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        if (msg.sender != d.provider) revert Unauthorized();
        _expect(d, Status.Delivered);
        if (block.timestamp < uint256(d.deliveredAt) + d.reviewPeriod) revert TooEarly();
        _payProvider(d, id);
    }

    /// @notice Return funds to the client.
    ///         Provider or arbiter: any time while funds are held.
    ///         Client: only if nothing was delivered by the deadline.
    function refund(uint256 id) external nonReentrant {
        Deal storage d = _deals[id];
        Status s = d.status;
        if (s != Status.Funded && s != Status.Delivered && s != Status.Disputed) revert WrongStatus(s);
        bool isArbiter = msg.sender == d.arbiter && d.arbiter != address(0);
        if (msg.sender == d.client) {
            if (s != Status.Funded) revert Unauthorized();
            if (block.timestamp <= d.deadline) revert TooEarly();
        } else if (msg.sender != d.provider && !isArbiter) {
            revert Unauthorized();
        }
        d.status = Status.Refunded;
        _record(d, Reputation.Outcome.Refunded, id);
        _call(d.token, abi.encodeWithSelector(0xa9059cbb, d.client, d.amount)); // transfer
        emit Refunded(id, d.client, d.amount, msg.sender);
    }

    // -------------------------------------------------------------------- read

    function getDeal(uint256 id) external view returns (Deal memory) {
        return _deals[id];
    }

    // --------------------------------------------------------------- internals

    function _payProvider(Deal storage d, uint256 id) private {
        d.status = Status.Released;
        _record(d, Reputation.Outcome.Completed, id);
        _call(d.token, abi.encodeWithSelector(0xa9059cbb, d.provider, d.amount)); // transfer
        emit Released(id, d.provider, d.amount, msg.sender);
    }

    function _record(Deal storage d, Reputation.Outcome outcome, uint256 id) private {
        if (address(reputation) == address(0)) return;
        try reputation.record(d.provider, d.client, outcome, d.amount, bytes32(id)) {} catch {}
    }

    function _expect(Deal storage d, Status s) private view {
        if (d.status != s) revert WrongStatus(d.status);
    }

    /// @dev SafeERC20-style call: success and (no return data or `true`).
    function _call(address token, bytes memory data) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
