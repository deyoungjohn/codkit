/// Coin escrow for agent ↔ agent / human ↔ agent deals. Same lifecycle as the
/// EVM `Escrow.sol`, minus the unfunded state (on Sui the coin comes in at creation):
///
///   create(+fund) ─▶ deliver ─▶ release (client / arbiter)
///        │              │   └──▶ claim   (provider, after the review period)
///        │              └─────▶ dispute (client) ─▶ arbiter release / refund
///        └────────────────────▶ refund  (client after deadline, provider any time, arbiter)
///
/// Each deal is a shared `Escrow<T>` object. Not audited — testnet / devnet only.
module kit_escrow::escrow;

use kit_escrow::reputation::{Self, Reputation};
use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

public enum Status has copy, drop, store {
    Funded,
    Delivered,
    Disputed,
    Released,
    Refunded,
}

public struct Escrow<phantom T> has key {
    id: UID,
    client: address,
    provider: address,
    arbiter: Option<address>,
    funds: Balance<T>,
    amount: u64,
    /// Provider must deliver by this time (ms since epoch, `Clock` time).
    deadline_ms: u64,
    /// Time the client has to dispute after delivery.
    review_period_ms: u64,
    delivered_at_ms: Option<u64>,
    status: Status,
    /// Hash / CID of what was agreed.
    terms_hash: vector<u8>,
    /// Hash / CID of what was delivered.
    delivery_hash: vector<u8>,
}

// Events -------------------------------------------------------------------

public struct DealCreated has copy, drop {
    deal: ID,
    client: address,
    provider: address,
    arbiter: Option<address>,
    amount: u64,
    deadline_ms: u64,
    review_period_ms: u64,
    terms_hash: vector<u8>,
}

public struct Delivered has copy, drop { deal: ID, delivery_hash: vector<u8> }

public struct Disputed has copy, drop { deal: ID, by: address }

public struct Released has copy, drop { deal: ID, to: address, amount: u64, by: address }

public struct Refunded has copy, drop { deal: ID, to: address, amount: u64, by: address }

// Errors -------------------------------------------------------------------

#[error]
const EInvalidParams: vector<u8> = b"Invalid deal parameters";
#[error]
const EUnauthorized: vector<u8> = b"Sender is not allowed to do this";
#[error]
const EWrongStatus: vector<u8> = b"Deal is not in the required status";
#[error]
const ETooEarly: vector<u8> = b"Too early";
#[error]
const ETooLate: vector<u8> = b"Too late";

// Create -------------------------------------------------------------------

/// Lock `payment` in a new shared escrow. Returns the deal's object ID.
public fun create<T>(
    provider: address,
    arbiter: Option<address>,
    payment: Coin<T>,
    deadline_ms: u64,
    review_period_ms: u64,
    terms_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    let client = ctx.sender();
    let amount = payment.value();
    assert!(provider != client && amount > 0 && deadline_ms > clock.timestamp_ms(), EInvalidParams);
    if (arbiter.is_some()) {
        let a = *arbiter.borrow();
        assert!(a != client && a != provider, EInvalidParams);
    };
    let escrow = Escrow<T> {
        id: object::new(ctx),
        client,
        provider,
        arbiter,
        funds: payment.into_balance(),
        amount,
        deadline_ms,
        review_period_ms,
        delivered_at_ms: option::none(),
        status: Status::Funded,
        terms_hash,
        delivery_hash: vector[],
    };
    let deal = object::id(&escrow);
    event::emit(DealCreated { deal, client, provider, arbiter, amount, deadline_ms, review_period_ms, terms_hash });
    transfer::share_object(escrow);
    deal
}

// Deliver / dispute --------------------------------------------------------

public fun deliver<T>(e: &mut Escrow<T>, delivery_hash: vector<u8>, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == e.provider, EUnauthorized);
    assert!(e.status == Status::Funded, EWrongStatus);
    let now = clock.timestamp_ms();
    assert!(now <= e.deadline_ms, ETooLate);
    e.status = Status::Delivered;
    e.delivered_at_ms = option::some(now);
    e.delivery_hash = delivery_hash;
    event::emit(Delivered { deal: object::id(e), delivery_hash });
}

/// Client contests a delivery during the review period. Needs an arbiter.
public fun dispute<T>(e: &mut Escrow<T>, rep: &mut Reputation, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == e.client && e.arbiter.is_some(), EUnauthorized);
    assert!(e.status == Status::Delivered, EWrongStatus);
    assert!(clock.timestamp_ms() < *e.delivered_at_ms.borrow() + e.review_period_ms, ETooLate);
    e.status = Status::Disputed;
    rep.record(e.provider, e.client, reputation::disputed_outcome(), e.amount, object::id(e));
    event::emit(Disputed { deal: object::id(e), by: ctx.sender() });
}

// Settle -------------------------------------------------------------------

/// Pay the provider. Client: when Funded/Delivered. Arbiter: also when Disputed.
public fun release<T>(e: &mut Escrow<T>, rep: &mut Reputation, ctx: &mut TxContext) {
    let sender = ctx.sender();
    let is_arbiter = is_arbiter(e, sender);
    assert!(sender == e.client || is_arbiter, EUnauthorized);
    assert!(
        e.status == Status::Funded || e.status == Status::Delivered || (e.status == Status::Disputed && is_arbiter),
        EWrongStatus,
    );
    pay_provider(e, rep, ctx);
}

/// Provider collects once the review period after delivery has passed without a dispute.
public fun claim<T>(e: &mut Escrow<T>, rep: &mut Reputation, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == e.provider, EUnauthorized);
    assert!(e.status == Status::Delivered, EWrongStatus);
    assert!(clock.timestamp_ms() >= *e.delivered_at_ms.borrow() + e.review_period_ms, ETooEarly);
    pay_provider(e, rep, ctx);
}

/// Return funds to the client. Provider or arbiter: any time while funds are held.
/// Client: only if nothing was delivered by the deadline.
public fun refund<T>(e: &mut Escrow<T>, rep: &mut Reputation, clock: &Clock, ctx: &mut TxContext) {
    let sender = ctx.sender();
    assert!(
        e.status == Status::Funded || e.status == Status::Delivered || e.status == Status::Disputed,
        EWrongStatus,
    );
    if (sender == e.client) {
        assert!(e.status == Status::Funded, EUnauthorized);
        assert!(clock.timestamp_ms() > e.deadline_ms, ETooEarly);
    } else {
        assert!(sender == e.provider || is_arbiter(e, sender), EUnauthorized);
    };
    e.status = Status::Refunded;
    rep.record(e.provider, e.client, reputation::refunded_outcome(), e.amount, object::id(e));
    let amount = e.funds.value();
    transfer::public_transfer(coin::from_balance(e.funds.withdraw_all(), ctx), e.client);
    event::emit(Refunded { deal: object::id(e), to: e.client, amount, by: sender });
}

// Read ---------------------------------------------------------------------

public fun client<T>(e: &Escrow<T>): address { e.client }

public fun provider<T>(e: &Escrow<T>): address { e.provider }

public fun arbiter<T>(e: &Escrow<T>): Option<address> { e.arbiter }

public fun amount<T>(e: &Escrow<T>): u64 { e.amount }

public fun held<T>(e: &Escrow<T>): u64 { e.funds.value() }

public fun status<T>(e: &Escrow<T>): Status { e.status }

public fun deadline_ms<T>(e: &Escrow<T>): u64 { e.deadline_ms }

public fun delivered_at_ms<T>(e: &Escrow<T>): Option<u64> { e.delivered_at_ms }

public fun terms_hash<T>(e: &Escrow<T>): vector<u8> { e.terms_hash }

public fun delivery_hash<T>(e: &Escrow<T>): vector<u8> { e.delivery_hash }

public fun is_released(s: &Status): bool { s == Status::Released }

public fun is_refunded(s: &Status): bool { s == Status::Refunded }

public fun is_delivered(s: &Status): bool { s == Status::Delivered }

public fun is_disputed(s: &Status): bool { s == Status::Disputed }

public fun is_funded(s: &Status): bool { s == Status::Funded }

// Internals ----------------------------------------------------------------

fun is_arbiter<T>(e: &Escrow<T>, who: address): bool {
    e.arbiter.is_some() && *e.arbiter.borrow() == who
}

fun pay_provider<T>(e: &mut Escrow<T>, rep: &mut Reputation, ctx: &mut TxContext) {
    e.status = Status::Released;
    rep.record(e.provider, e.client, reputation::completed_outcome(), e.amount, object::id(e));
    let amount = e.funds.value();
    transfer::public_transfer(coin::from_balance(e.funds.withdraw_all(), ctx), e.provider);
    event::emit(Released { deal: object::id(e), to: e.provider, amount, by: ctx.sender() });
}
