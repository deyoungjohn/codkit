//! Token escrow for agent ↔ agent / human ↔ agent deals, with an onchain
//! reputation counter. Same lifecycle and rules as the EVM `Escrow.sol` and the
//! Sui `kit_escrow::escrow` module (funded at creation, like Sui):
//!
//!   create(+fund) ─▶ deliver ─▶ release (client / arbiter)
//!        │              │   └──▶ claim   (provider, after the review period)
//!        │              └─────▶ dispute (client) ─▶ arbiter release / refund
//!        └────────────────────▶ refund  (client after deadline, provider any time, arbiter;
//!                                        client also once an unresolved dispute times out)
//!
//! Works with SPL Token and Token-2022 mints; mints that take a transfer fee are
//! rejected. Reviewed (docs/security/escrow-review.md) but not audited — devnet only.
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("8kQBzMWRWAEssN4wtBzrH4G8fHtbhrbHs9e24V2jWMkX");

#[program]
pub mod kit_escrow {
    use super::*;

    /// Lock `amount` of `mint` from the client in a new deal.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        ctx: Context<Create>,
        deal_id: u64,
        provider: Pubkey,
        arbiter: Option<Pubkey>,
        amount: u64,
        deadline: i64,
        review_period: i64,
        terms_hash: [u8; 32],
    ) -> Result<()> {
        instructions::create::handle_create(
            ctx,
            deal_id,
            provider,
            arbiter,
            amount,
            deadline,
            review_period,
            terms_hash,
        )
    }

    pub fn deliver(ctx: Context<Deliver>, delivery_hash: [u8; 32]) -> Result<()> {
        instructions::deliver::handle_deliver(ctx, delivery_hash)
    }

    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        instructions::dispute::handle_dispute(ctx)
    }

    /// Pay the provider. Client: when Funded/Delivered. Arbiter: also when Disputed.
    pub fn release(ctx: Context<Payout>) -> Result<()> {
        instructions::settle::handle_release(ctx)
    }

    /// Provider collects once the review period after delivery has passed without a dispute.
    pub fn claim(ctx: Context<Payout>) -> Result<()> {
        instructions::settle::handle_claim(ctx)
    }

    /// Return the funds to the client (rules on `instructions::settle::handle_refund`).
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::settle::handle_refund(ctx)
    }
}
