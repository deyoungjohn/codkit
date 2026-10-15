#[test_only]
module kit_escrow::anchor_tests;

use kit_escrow::anchor;
use sui::test_scenario as ts;

#[test]
fun anchors_32_byte_head() {
    let mut s = ts::begin(@0xA);
    let mut head = vector[];
    32u64.do!(|_| head.push_back(7u8));
    anchor::anchor(head, 3, b"walrus://x", s.ctx());
    let effects = s.next_tx(@0xA);
    assert!(effects.num_user_events() == 1);
    s.end();
}

#[test, expected_failure(abort_code = anchor::EBadHead)]
fun rejects_short_head() {
    let mut s = ts::begin(@0xA);
    anchor::anchor(b"short", 0, b"", s.ctx());
    s.end();
}
