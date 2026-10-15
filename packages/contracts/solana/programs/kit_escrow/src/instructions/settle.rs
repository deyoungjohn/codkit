use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    constants::*,
    error::EscrowError,
    events::{Refunded, Released},
    state::*,
};

/// Accounts for paying the provider (`release`, `claim`).
#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.client.as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = mint,
        has_one = provider,
        has_one = client
    )]
    pub deal: Account<'info, Deal>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deal,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: the deal's provider (`has_one`); receives the funds.
    pub provider: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = provider,
        associated_token::token_program = token_program
    )]
    pub provider_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: the deal's client (`has_one`); gets the vault's rent back.
    #[account(mut)]
    pub client: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [REPUTATION_SEED, deal.provider.as_ref()],
        bump
    )]
    pub reputation: Account<'info, Reputation>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Accounts for returning the funds to the client (`refund`).
#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.client.as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = mint,
        has_one = client
    )]
    pub deal: Account<'info, Deal>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deal,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: the deal's client (`has_one`); receives the funds and the vault's rent.
    #[account(mut)]
    pub client: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = client,
        associated_token::token_program = token_program
    )]
    pub client_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + Reputation::INIT_SPACE,
        seeds = [REPUTATION_SEED, deal.provider.as_ref()],
        bump
    )]
    pub reputation: Account<'info, Reputation>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_release(ctx: Context<Payout>) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let deal = &ctx.accounts.deal;
    let is_arbiter = deal.is_arbiter(&signer);
    require!(
        signer == deal.client || is_arbiter,
        EscrowError::Unauthorized
    );
    require!(
        matches!(deal.status, Status::Funded | Status::Delivered)
            || (deal.status == Status::Disputed && is_arbiter),
        EscrowError::WrongStatus
    );
    pay_provider(ctx)
}

pub fn handle_claim(ctx: Context<Payout>) -> Result<()> {
    let deal = &ctx.accounts.deal;
    require!(
        ctx.accounts.signer.key() == deal.provider,
        EscrowError::Unauthorized
    );
    require!(deal.status == Status::Delivered, EscrowError::WrongStatus);
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= deal.delivered_at.saturating_add(deal.review_period),
        EscrowError::TooEarly
    );
    pay_provider(ctx)
}

/// Provider or arbiter: any time while funds are held.
/// Client: if nothing was delivered by the deadline, or if a dispute is still
/// unresolved `ARBITER_TIMEOUT` after the review period ended.
pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let deal = &ctx.accounts.deal;
    require!(
        matches!(
            deal.status,
            Status::Funded | Status::Delivered | Status::Disputed
        ),
        EscrowError::WrongStatus
    );
    let now = Clock::get()?.unix_timestamp;
    if signer == deal.client {
        match deal.status {
            Status::Funded => require!(now > deal.deadline, EscrowError::TooEarly),
            Status::Disputed => require!(
                now >= deal
                    .delivered_at
                    .saturating_add(deal.review_period)
                    .saturating_add(ARBITER_TIMEOUT),
                EscrowError::TooEarly
            ),
            _ => return err!(EscrowError::Unauthorized),
        }
    } else {
        require!(
            signer == deal.provider || deal.is_arbiter(&signer),
            EscrowError::Unauthorized
        );
    }

    let deal = &mut ctx.accounts.deal;
    deal.status = Status::Refunded;
    let (amount, provider) = (deal.amount, deal.provider);
    ctx.accounts
        .reputation
        .record(provider, ctx.bumps.reputation, Outcome::Refunded, amount);
    emit!(Refunded {
        deal: deal.key(),
        to: deal.client,
        amount,
        by: signer
    });

    let a = &ctx.accounts;
    empty_vault(
        &a.deal,
        &a.vault,
        &a.mint,
        a.client_token.to_account_info(),
        a.client.to_account_info(),
        &a.token_program,
    )
}

fn pay_provider(ctx: Context<Payout>) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let deal = &mut ctx.accounts.deal;
    deal.status = Status::Released;
    let (amount, provider) = (deal.amount, deal.provider);
    ctx.accounts
        .reputation
        .record(provider, ctx.bumps.reputation, Outcome::Completed, amount);
    emit!(Released {
        deal: deal.key(),
        to: provider,
        amount,
        by: signer
    });

    let a = &ctx.accounts;
    empty_vault(
        &a.deal,
        &a.vault,
        &a.mint,
        a.provider_token.to_account_info(),
        a.client.to_account_info(),
        &a.token_program,
    )
}

/// Move everything in the vault to `to`, then close the vault (rent → client).
fn empty_vault<'info>(
    deal: &Account<'info, Deal>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: AccountInfo<'info>,
    rent_to: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<()> {
    let id = deal.deal_id.to_le_bytes();
    let seeds: &[&[u8]] = &[DEAL_SEED, deal.client.as_ref(), &id, &[deal.bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to,
                authority: deal.to_account_info(),
            },
            signer,
        ),
        vault.amount,
        mint.decimals,
    )?;
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: vault.to_account_info(),
            destination: rent_to,
            authority: deal.to_account_info(),
        },
        signer,
    ))
}
