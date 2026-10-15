use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{constants::*, error::EscrowError, events::DealCreated, state::*};

#[derive(Accounts)]
#[instruction(deal_id: u64)]
pub struct Create<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    #[account(
        init,
        payer = client,
        space = 8 + Deal::INIT_SPACE,
        seeds = [DEAL_SEED, client.key().as_ref(), &deal_id.to_le_bytes()],
        bump
    )]
    pub deal: Account<'info, Deal>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = client,
        token::token_program = token_program
    )]
    pub client_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = client,
        associated_token::mint = mint,
        associated_token::authority = deal,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_create(
    ctx: Context<Create>,
    deal_id: u64,
    provider: Pubkey,
    arbiter: Option<Pubkey>,
    amount: u64,
    deadline: i64,
    review_period: i64,
    terms_hash: [u8; 32],
) -> Result<()> {
    let client = ctx.accounts.client.key();
    let now = Clock::get()?.unix_timestamp;
    require!(
        provider != client && provider != Pubkey::default() && amount > 0 && deadline > now,
        EscrowError::InvalidParams
    );
    require!(
        (0..=MAX_REVIEW_PERIOD).contains(&review_period),
        EscrowError::InvalidParams
    );
    if let Some(a) = arbiter {
        // with an arbiter, a zero review period would make disputes impossible
        require!(
            a != client && a != provider && review_period > 0,
            EscrowError::InvalidParams
        );
    }

    let deal = &mut ctx.accounts.deal;
    deal.set_inner(Deal {
        client,
        provider,
        arbiter,
        mint: ctx.accounts.mint.key(),
        deal_id,
        amount,
        deadline,
        review_period,
        delivered_at: 0,
        status: Status::Funded,
        terms_hash,
        delivery_hash: [0; 32],
        bump: ctx.bumps.deal,
    });

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.client_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.client.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    // Reject transfer-fee mints: the vault must hold exactly what the deal promises.
    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount == amount,
        EscrowError::TransferFailed
    );

    emit!(DealCreated {
        deal: ctx.accounts.deal.key(),
        client,
        provider,
        arbiter,
        mint: ctx.accounts.mint.key(),
        amount,
        deadline,
        review_period,
        terms_hash,
    });
    Ok(())
}
