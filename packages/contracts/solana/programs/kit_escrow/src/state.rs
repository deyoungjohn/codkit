use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Status {
    Funded,
    Delivered,
    Disputed,
    Released,
    Refunded,
}

/// One deal. PDA: ["deal", client, deal_id (u64 LE)]. Its funds sit in the
/// deal's associated token account (the vault), which only this program can move.
#[account]
#[derive(InitSpace)]
pub struct Deal {
    pub client: Pubkey,
    pub provider: Pubkey,
    pub arbiter: Option<Pubkey>,
    pub mint: Pubkey,
    pub deal_id: u64,
    pub amount: u64,
    /// Provider must deliver by this unix time (seconds).
    pub deadline: i64,
    /// Seconds the client has to dispute after delivery.
    pub review_period: i64,
    /// Unix time of delivery; 0 until delivered.
    pub delivered_at: i64,
    pub status: Status,
    /// Hash / CID of what was agreed.
    pub terms_hash: [u8; 32],
    /// Hash / CID of what was delivered.
    pub delivery_hash: [u8; 32],
    pub bump: u8,
}

impl Deal {
    pub fn is_arbiter(&self, who: &Pubkey) -> bool {
        self.arbiter.as_ref() == Some(who)
    }
}

/// Track record of a provider. PDA: ["reputation", subject]. Only this program
/// writes it, so counters can't be forged — but any mint and any counterparty can
/// produce them, so weigh them by the deals behind them (see the events).
#[account]
#[derive(InitSpace)]
pub struct Reputation {
    pub subject: Pubkey,
    pub completed: u64,
    pub refunded: u64,
    pub disputed: u64,
    /// Sum of completed amounts in each deal's base units (mixed mints summed as-is).
    pub volume: u128,
    pub bump: u8,
}

pub enum Outcome {
    Completed,
    Refunded,
    Disputed,
}

impl Reputation {
    /// Saturating: recording can never block a payout.
    pub fn record(&mut self, subject: Pubkey, bump: u8, outcome: Outcome, amount: u64) {
        if self.subject == Pubkey::default() {
            self.subject = subject;
            self.bump = bump;
        }
        match outcome {
            Outcome::Completed => {
                self.completed = self.completed.saturating_add(1);
                self.volume = self.volume.saturating_add(amount as u128);
            }
            Outcome::Refunded => self.refunded = self.refunded.saturating_add(1),
            Outcome::Disputed => self.disputed = self.disputed.saturating_add(1),
        }
    }

    /// Completion rate in basis points (0..10000); 0 when there is no history.
    pub fn score(&self) -> u64 {
        let total = self.completed as u128 + self.refunded as u128 + self.disputed as u128;
        (self.completed as u128 * 10_000)
            .checked_div(total)
            .unwrap_or(0) as u64
    }
}
