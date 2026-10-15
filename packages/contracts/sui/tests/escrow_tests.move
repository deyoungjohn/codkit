#[test_only]
module kit_escrow::escrow_tests;

use kit_escrow::escrow::{Self, Escrow};
use kit_escrow::reputation::{Self, Reputation};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const CLIENT: address = @0xC1;
const PROVIDER: address = @0xB0;
const ARBITER: address = @0xA1;
const STRANGER: address = @0x55;
const AMOUNT: u64 = 25_000_000;
const DAY: u64 = 86_400_000;

fun setup(): (Scenario, Clock) {
    let mut s = ts::begin(@0xD0);
    reputation::init_for_testing(s.ctx());
    let mut clock = clock::create_for_testing(s.ctx());
    clock.set_for_testing(1_000_000);
    (s, clock)
}

fun create_deal(s: &mut Scenario, clock: &Clock, arbiter: Option<address>): ID {
    s.next_tx(CLIENT);
    let payment = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, arbiter, payment, clock.timestamp_ms() + 3 * DAY, DAY, b"terms", clock, s.ctx())
}

fun deliver(s: &mut Scenario, clock: &Clock) {
    s.next_tx(PROVIDER);
    let mut e = s.take_shared<Escrow<SUI>>();
    escrow::deliver(&mut e, b"ipfs://result", clock, s.ctx());
    ts::return_shared(e);
}

fun release_as(s: &mut Scenario, who: address) {
    s.next_tx(who);
    let mut e = s.take_shared<Escrow<SUI>>();
    let mut rep = s.take_shared<Reputation>();
    escrow::release(&mut e, &mut rep, s.ctx());
    ts::return_shared(e);
    ts::return_shared(rep);
}

fun refund_as(s: &mut Scenario, clock: &Clock, who: address) {
    s.next_tx(who);
    let mut e = s.take_shared<Escrow<SUI>>();
    let mut rep = s.take_shared<Reputation>();
    escrow::refund(&mut e, &mut rep, clock, s.ctx());
    ts::return_shared(e);
    ts::return_shared(rep);
}

fun dispute(s: &mut Scenario, clock: &Clock) {
    s.next_tx(CLIENT);
    let mut e = s.take_shared<Escrow<SUI>>();
    let mut rep = s.take_shared<Reputation>();
    escrow::dispute(&mut e, &mut rep, clock, s.ctx());
    ts::return_shared(e);
    ts::return_shared(rep);
}

fun claim(s: &mut Scenario, clock: &Clock) {
    s.next_tx(PROVIDER);
    let mut e = s.take_shared<Escrow<SUI>>();
    let mut rep = s.take_shared<Reputation>();
    escrow::claim(&mut e, &mut rep, clock, s.ctx());
    ts::return_shared(e);
    ts::return_shared(rep);
}

/// Value of the single coin `owner` received.
fun received(s: &mut Scenario, owner: address): u64 {
    s.next_tx(owner);
    let c = s.take_from_sender<Coin<SUI>>();
    let v = c.value();
    s.return_to_sender(c);
    v
}

fun finish(s: Scenario, clock: Clock) {
    clock.destroy_for_testing();
    s.end();
}

// Happy paths --------------------------------------------------------------

#[test]
fun create_deliver_release() {
    let (mut s, clock) = setup();
    let id = create_deal(&mut s, &clock, option::some(ARBITER));

    s.next_tx(CLIENT);
    let e = s.take_shared_by_id<Escrow<SUI>>(id);
    assert!(e.held() == AMOUNT && e.amount() == AMOUNT);
    assert!(e.status().is_funded());
    assert!(e.client() == CLIENT && e.provider() == PROVIDER);
    ts::return_shared(e);

    deliver(&mut s, &clock);
    s.next_tx(CLIENT);
    let e = s.take_shared<Escrow<SUI>>();
    assert!(e.status().is_delivered());
    assert!(e.delivery_hash() == b"ipfs://result");
    assert!(e.delivered_at_ms() == option::some(clock.timestamp_ms()));
    ts::return_shared(e);

    release_as(&mut s, CLIENT);
    assert!(received(&mut s, PROVIDER) == AMOUNT);

    s.next_tx(CLIENT);
    let e = s.take_shared<Escrow<SUI>>();
    assert!(e.status().is_released() && e.held() == 0);
    ts::return_shared(e);
    let rep = s.take_shared<Reputation>();
    let st = rep.stats(PROVIDER);
    assert!(st.completed() == 1 && st.volume() == (AMOUNT as u128));
    assert!(rep.score(PROVIDER) == 10_000);
    ts::return_shared(rep);
    finish(s, clock);
}

#[test]
fun client_can_release_before_delivery() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    release_as(&mut s, CLIENT);
    assert!(received(&mut s, PROVIDER) == AMOUNT);
    finish(s, clock);
}

#[test]
fun provider_claims_after_review_period() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    clock.increment_for_testing(DAY);
    claim(&mut s, &clock);
    assert!(received(&mut s, PROVIDER) == AMOUNT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::ETooEarly)]
fun provider_cannot_claim_early() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    clock.increment_for_testing(DAY - 1);
    claim(&mut s, &clock);
    finish(s, clock);
}

// Refunds ------------------------------------------------------------------

#[test]
fun client_refund_after_missed_deadline() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::none());
    clock.increment_for_testing(3 * DAY + 1);
    refund_as(&mut s, &clock, CLIENT);
    assert!(received(&mut s, CLIENT) == AMOUNT);
    s.next_tx(CLIENT);
    let rep = s.take_shared<Reputation>();
    assert!(rep.stats(PROVIDER).refunded() == 1);
    assert!(rep.score(PROVIDER) == 0);
    ts::return_shared(rep);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::ETooEarly)]
fun client_cannot_refund_before_deadline() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    refund_as(&mut s, &clock, CLIENT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun client_cannot_refund_after_delivery() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    clock.increment_for_testing(30 * DAY);
    refund_as(&mut s, &clock, CLIENT);
    finish(s, clock);
}

#[test]
fun provider_can_refund_voluntarily() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    refund_as(&mut s, &clock, PROVIDER);
    assert!(received(&mut s, CLIENT) == AMOUNT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::ETooLate)]
fun cannot_deliver_after_deadline() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::none());
    clock.increment_for_testing(3 * DAY + 1);
    deliver(&mut s, &clock);
    finish(s, clock);
}

// Disputes -----------------------------------------------------------------

#[test]
fun arbiter_resolves_dispute_with_refund() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    refund_as(&mut s, &clock, ARBITER);
    assert!(received(&mut s, CLIENT) == AMOUNT);
    s.next_tx(CLIENT);
    let rep = s.take_shared<Reputation>();
    let st = rep.stats(PROVIDER);
    assert!(st.disputed() == 1 && st.refunded() == 1);
    ts::return_shared(rep);
    finish(s, clock);
}

#[test]
fun arbiter_can_release_disputed() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    release_as(&mut s, ARBITER);
    assert!(received(&mut s, PROVIDER) == AMOUNT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EWrongStatus)]
fun dispute_blocks_claim() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    clock.increment_for_testing(DAY + 1);
    claim(&mut s, &clock);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EWrongStatus)]
fun client_cannot_release_disputed() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    release_as(&mut s, CLIENT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::ETooLate)]
fun dispute_window_closes() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    clock.increment_for_testing(DAY);
    dispute(&mut s, &clock);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun dispute_needs_arbiter() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    finish(s, clock);
}

// Access control / params --------------------------------------------------

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun stranger_cannot_release() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    release_as(&mut s, STRANGER);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun stranger_cannot_refund() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    refund_as(&mut s, &clock, STRANGER);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun only_provider_delivers() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    s.next_tx(CLIENT);
    let mut e = s.take_shared<Escrow<SUI>>();
    escrow::deliver(&mut e, b"fake", &clock, s.ctx());
    ts::return_shared(e);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EWrongStatus)]
fun no_double_settlement() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    release_as(&mut s, CLIENT);
    refund_as(&mut s, &clock, ARBITER);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EInvalidParams)]
fun rejects_self_deal() {
    let (mut s, clock) = setup();
    s.next_tx(PROVIDER);
    let payment = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, option::none(), payment, clock.timestamp_ms() + DAY, DAY, b"", &clock, s.ctx());
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EInvalidParams)]
fun rejects_zero_amount() {
    let (mut s, clock) = setup();
    s.next_tx(CLIENT);
    let payment = coin::mint_for_testing<SUI>(0, s.ctx());
    escrow::create(PROVIDER, option::none(), payment, clock.timestamp_ms() + DAY, DAY, b"", &clock, s.ctx());
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EInvalidParams)]
fun rejects_past_deadline() {
    let (mut s, clock) = setup();
    s.next_tx(CLIENT);
    let payment = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, option::none(), payment, clock.timestamp_ms(), DAY, b"", &clock, s.ctx());
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EInvalidParams)]
fun rejects_provider_as_arbiter() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(PROVIDER));
    finish(s, clock);
}

// Security review fixes ----------------------------------------------------

#[test]
fun client_refunds_unresolved_dispute_after_arbiter_timeout() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    clock.increment_for_testing(DAY + escrow::arbiter_timeout_ms());
    refund_as(&mut s, &clock, CLIENT);
    assert!(received(&mut s, CLIENT) == AMOUNT);
    s.next_tx(CLIENT);
    let rep = s.take_shared<Reputation>();
    let st = reputation::stats(&rep, PROVIDER);
    assert!(reputation::refunded(&st) == 1 && reputation::disputed(&st) == 1);
    ts::return_shared(rep);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::ETooEarly)]
fun client_cannot_refund_dispute_before_arbiter_timeout() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    clock.increment_for_testing(DAY + escrow::arbiter_timeout_ms() - 1);
    refund_as(&mut s, &clock, CLIENT);
    finish(s, clock);
}

#[test]
fun arbiter_can_still_decide_before_timeout() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    clock.increment_for_testing(10 * DAY);
    release_as(&mut s, ARBITER);
    assert!(received(&mut s, PROVIDER) == AMOUNT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun client_cannot_refund_delivered_deal() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    clock.increment_for_testing(365 * DAY);
    refund_as(&mut s, &clock, CLIENT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EInvalidParams)]
fun review_period_above_max_rejected() {
    let (mut s, clock) = setup();
    s.next_tx(CLIENT);
    let payment = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, option::none(), payment, clock.timestamp_ms() + DAY, escrow::max_review_period_ms() + 1, b"", &clock, s.ctx());
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EInvalidParams)]
fun arbiter_with_zero_review_period_rejected() {
    let (mut s, clock) = setup();
    s.next_tx(CLIENT);
    let payment = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, option::some(ARBITER), payment, clock.timestamp_ms() + DAY, 0, b"", &clock, s.ctx());
    finish(s, clock);
}

#[test]
fun review_period_bounds_accepted() {
    let (mut s, clock) = setup();
    s.next_tx(CLIENT);
    let p1 = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, option::none(), p1, clock.timestamp_ms() + DAY, 0, b"", &clock, s.ctx());
    let p2 = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, option::some(ARBITER), p2, clock.timestamp_ms() + DAY, escrow::max_review_period_ms(), b"", &clock, s.ctx());
    finish(s, clock);
}

// Failure paths found uncovered by `sui move test --coverage` --------------

#[test, expected_failure(abort_code = escrow::EWrongStatus)]
fun cannot_deliver_twice() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    deliver(&mut s, &clock);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun cannot_dispute_without_arbiter() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    dispute(&mut s, &clock);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun stranger_cannot_dispute() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    deliver(&mut s, &clock);
    s.next_tx(STRANGER);
    let mut e = s.take_shared<Escrow<SUI>>();
    let mut rep = s.take_shared<Reputation>();
    escrow::dispute(&mut e, &mut rep, &clock, s.ctx());
    ts::return_shared(e);
    ts::return_shared(rep);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EWrongStatus)]
fun cannot_dispute_before_delivery() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    dispute(&mut s, &clock);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EWrongStatus)]
fun cannot_release_twice() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::none());
    release_as(&mut s, CLIENT);
    release_as(&mut s, CLIENT);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EUnauthorized)]
fun stranger_cannot_claim() {
    let (mut s, mut clock) = setup();
    create_deal(&mut s, &clock, option::none());
    deliver(&mut s, &clock);
    clock.increment_for_testing(2 * DAY);
    s.next_tx(STRANGER);
    let mut e = s.take_shared<Escrow<SUI>>();
    let mut rep = s.take_shared<Reputation>();
    escrow::claim(&mut e, &mut rep, &clock, s.ctx());
    ts::return_shared(e);
    ts::return_shared(rep);
    finish(s, clock);
}

#[test, expected_failure(abort_code = escrow::EInvalidParams)]
fun rejects_client_as_arbiter() {
    let (mut s, clock) = setup();
    s.next_tx(CLIENT);
    let payment = coin::mint_for_testing<SUI>(AMOUNT, s.ctx());
    escrow::create(PROVIDER, option::some(CLIENT), payment, clock.timestamp_ms() + DAY, DAY, b"", &clock, s.ctx());
    finish(s, clock);
}

#[test]
fun getters_reflect_deal() {
    let (mut s, clock) = setup();
    create_deal(&mut s, &clock, option::some(ARBITER));
    s.next_tx(CLIENT);
    let e = s.take_shared<Escrow<SUI>>();
    assert!(escrow::arbiter(&e) == option::some(ARBITER));
    assert!(escrow::deadline_ms(&e) == clock.timestamp_ms() + 3 * DAY);
    assert!(escrow::terms_hash(&e) == b"terms");
    assert!(!escrow::is_refunded(&escrow::status(&e)) && !escrow::is_disputed(&escrow::status(&e)));
    ts::return_shared(e);
    finish(s, clock);
}

#[test]
fun reputation_defaults_for_unknown_subject() {
    let (mut s, clock) = setup();
    s.next_tx(CLIENT);
    let rep = s.take_shared<Reputation>();
    let st = reputation::stats(&rep, STRANGER);
    assert!(reputation::completed(&st) == 0 && reputation::volume(&st) == 0);
    assert!(reputation::score(&rep, STRANGER) == 0);
    ts::return_shared(rep);
    finish(s, clock);
}
