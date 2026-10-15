/// Minimal onchain track record. Only this package's `escrow` module can write
/// (`public(package)`), so counters can't be forged; anyone can read them.
module kit_escrow::reputation;

use sui::event;
use sui::table::{Self, Table};

public struct Stats has copy, drop, store {
    completed: u64,
    refunded: u64,
    disputed: u64,
    /// Sum of completed amounts (token base units; mixed tokens are summed as-is).
    volume: u128,
}

/// Singleton shared object, created on publish.
public struct Reputation has key {
    id: UID,
    stats: Table<address, Stats>,
}

public struct Recorded has copy, drop {
    subject: address,
    counterparty: address,
    /// 0 = completed, 1 = refunded, 2 = disputed
    outcome: u8,
    amount: u64,
    deal: ID,
}

const COMPLETED: u8 = 0;
const REFUNDED: u8 = 1;
const DISPUTED: u8 = 2;

fun init(ctx: &mut TxContext) {
    transfer::share_object(Reputation { id: object::new(ctx), stats: table::new(ctx) });
}

public(package) fun record(
    rep: &mut Reputation,
    subject: address,
    counterparty: address,
    outcome: u8,
    amount: u64,
    deal: ID,
) {
    if (!rep.stats.contains(subject)) {
        rep.stats.add(subject, Stats { completed: 0, refunded: 0, disputed: 0, volume: 0 });
    };
    let s = &mut rep.stats[subject];
    if (outcome == COMPLETED) {
        s.completed = s.completed + 1;
        s.volume = s.volume + (amount as u128);
    } else if (outcome == REFUNDED) {
        s.refunded = s.refunded + 1;
    } else {
        s.disputed = s.disputed + 1;
    };
    event::emit(Recorded { subject, counterparty, outcome, amount, deal });
}

public(package) fun completed_outcome(): u8 { COMPLETED }

public(package) fun refunded_outcome(): u8 { REFUNDED }

public(package) fun disputed_outcome(): u8 { DISPUTED }

public fun stats(rep: &Reputation, subject: address): Stats {
    if (rep.stats.contains(subject)) rep.stats[subject]
    else Stats { completed: 0, refunded: 0, disputed: 0, volume: 0 }
}

/// Completion rate in basis points (0..10000); 0 when there is no history.
public fun score(rep: &Reputation, subject: address): u64 {
    let s = stats(rep, subject);
    let total = s.completed + s.refunded + s.disputed;
    if (total == 0) 0 else s.completed * 10_000 / total
}

public fun completed(s: &Stats): u64 { s.completed }

public fun refunded(s: &Stats): u64 { s.refunded }

public fun disputed(s: &Stats): u64 { s.disputed }

public fun volume(s: &Stats): u128 { s.volume }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
