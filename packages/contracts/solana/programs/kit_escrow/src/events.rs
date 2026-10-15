use anchor_lang::prelude::*;

#[event]
pub struct DealCreated {
    pub deal: Pubkey,
    pub client: Pubkey,
    pub provider: Pubkey,
    pub arbiter: Option<Pubkey>,
    pub mint: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub review_period: i64,
    pub terms_hash: [u8; 32],
}

#[event]
pub struct Delivered {
    pub deal: Pubkey,
    pub delivery_hash: [u8; 32],
}

#[event]
pub struct Disputed {
    pub deal: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct Released {
    pub deal: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub by: Pubkey,
}

#[event]
pub struct Refunded {
    pub deal: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub by: Pubkey,
}
