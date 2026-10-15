use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, events::Disputed, state::*};

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.client.as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = client @ EscrowError::Unauthorized
    )]
    pub deal: Account<'info, Deal>,
    #[account(
        init_if_needed,
        payer = client,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [REPUTATION_SEED, deal.provider.as_ref()],
        bump
    )]
    pub reputation: Account<'info, Reputation>,
    pub system_program: Program<'info, System>,
}

pub fn handle_dispute(ctx: Context<Dispute>) -> Result<()> {
    let deal = &mut ctx.accounts.deal;
    require!(deal.arbiter.is_some(), EscrowError::Unauthorized);
    require!(deal.status == Status::Delivered, EscrowError::WrongStatus);
    let now = Clock::get()?.unix_timestamp;
    require!(
        now < deal.delivered_at.saturating_add(deal.review_period),
        EscrowError::TooLate
    );
    deal.status = Status::Disputed;
    ctx.accounts.reputation.record(
        deal.provider,
        ctx.bumps.reputation,
        Outcome::Disputed,
        deal.amount,
    );
    emit!(Disputed {
        deal: deal.key(),
        by: ctx.accounts.client.key()
    });
    Ok(())
}
