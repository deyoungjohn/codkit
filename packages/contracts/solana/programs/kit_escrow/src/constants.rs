use anchor_lang::prelude::*;

#[constant]
pub const DEAL_SEED: &[u8] = b"deal";
#[constant]
pub const REPUTATION_SEED: &[u8] = b"reputation";

/// Longest review period a deal may set (seconds) — protects providers from funds parked for years.
pub const MAX_REVIEW_PERIOD: i64 = 30 * 24 * 60 * 60;
/// How long an arbiter has to resolve a dispute, counted from the end of the review period.
pub const ARBITER_TIMEOUT: i64 = 30 * 24 * 60 * 60;
