/// Stateless notary: anyone can anchor the head hash of their receipt log.
/// The event is the record; query `Anchored` events by sender.
module kit_escrow::anchor;

use sui::event;

public struct Anchored has copy, drop {
    logger: address,
    /// Hash of the latest receipt (32 bytes).
    head: vector<u8>,
    seq: u64,
    /// Where the full log lives (walrus://…, ipfs://…), may be empty.
    uri: vector<u8>,
}

#[error]
const EBadHead: vector<u8> = b"head must be 32 bytes";

public fun anchor(head: vector<u8>, seq: u64, uri: vector<u8>, ctx: &TxContext) {
    assert!(head.length() == 32, EBadHead);
    event::emit(Anchored { logger: ctx.sender(), head, seq, uri });
}
