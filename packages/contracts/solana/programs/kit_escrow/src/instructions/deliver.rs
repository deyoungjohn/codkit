use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, events::Delivered, state::*};

#[derive(Accounts)]
pub struct Deliver<'info> {
    pub provider: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.client.as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = provider @ EscrowError::Unauthorized
    )]
    pub deal: Account<'info, Deal>,
}

pub fn handle_deliver(ctx: Context<Deliver>, delivery_hash: [u8; 32]) -> Result<()> {
    let deal = &mut ctx.accounts.deal;
    require!(deal.status == Status::Funded, EscrowError::WrongStatus);
    let now = Clock::get()?.unix_timestamp;
    require!(now <= deal.deadline, EscrowError::TooLate);
    deal.status = Status::Delivered;
    deal.delivered_at = now;
    deal.delivery_hash = delivery_hash;
    emit!(Delivered {
        deal: deal.key(),
        delivery_hash
    });
    Ok(())
}
