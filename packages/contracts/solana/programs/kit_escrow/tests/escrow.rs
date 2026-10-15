//! LiteSVM tests for kit_escrow: every lifecycle path, every authorization and
//! parameter check, account-substitution attacks, Token-2022 (incl. rejecting
//! transfer-fee mints), and a seeded random walk that checks the same
//! invariants as the Foundry suite (balances match open deals, single payout,
//! only parties move funds, reputation matches outcomes).
use {
    anchor_lang::{
        error::ERROR_CODE_OFFSET,
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{
            self, get_associated_token_address_with_program_id, spl_associated_token_account,
        },
        token::spl_token,
        token_2022::spl_token_2022,
    },
    kit_escrow::{
        error::EscrowError, Deal, Reputation, Status, ARBITER_TIMEOUT, DEAL_SEED,
        MAX_REVIEW_PERIOD, REPUTATION_SEED,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const AMOUNT: u64 = 25_000_000; // 25 tokens, 6 decimals
const DAY: i64 = 86_400;
const MINTED: u64 = 1_000_000_000;

struct Env {
    svm: LiteSVM,
    client: Keypair,
    provider: Keypair,
    arbiter: Keypair,
    stranger: Keypair,
    mint: Pubkey,
    token_program: Pubkey,
}

fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?} {:?}", e.err, e.meta.logs))
}

fn expect_err(r: Result<(), String>, e: EscrowError) {
    let code = e as u32 + ERROR_CODE_OFFSET;
    let msg = r.expect_err("expected the transaction to fail");
    assert!(
        msg.contains(&format!("Custom({code})")),
        "expected {e:?} (Custom({code})), got: {msg}"
    );
}

fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, token_program)
}

fn balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    svm.get_account(account)
        .filter(|a| a.data.len() >= 72)
        .map(|a| u64::from_le_bytes(a.data[64..72].try_into().unwrap()))
        .unwrap_or(0)
}

fn warp(svm: &mut LiteSVM, secs: i64) {
    let mut c: Clock = svm.get_sysvar();
    c.unix_timestamp += secs;
    svm.set_sysvar(&c);
}

fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

/// A mint (optionally Token-2022 with a transfer fee) and `MINTED` tokens in `holders`' ATAs.
fn make_mint(
    svm: &mut LiteSVM,
    payer: &Keypair,
    token_program: Pubkey,
    fee_bps: Option<u16>,
    holders: &[Pubkey],
) -> Pubkey {
    let mint = Keypair::new();
    let space = match fee_bps {
        Some(_) => spl_token_2022::extension::ExtensionType::try_calculate_account_len::<
            spl_token_2022::state::Mint,
        >(&[spl_token_2022::extension::ExtensionType::TransferFeeConfig])
        .unwrap(),
        None => 82,
    };
    let rent = svm.minimum_balance_for_rent_exemption(space);
    let mut ixs = vec![system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        space as u64,
        &token_program,
    )];
    if let Some(bps) = fee_bps {
        ixs.push(
            spl_token_2022::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                &token_program,
                &mint.pubkey(),
                None,
                None,
                bps,
                u64::MAX,
            )
            .unwrap(),
        );
    }
    ixs.push(
        spl_token_2022::instruction::initialize_mint2(
            &token_program,
            &mint.pubkey(),
            &payer.pubkey(),
            None,
            6,
        )
        .unwrap(),
    );
    send(svm, &ixs, payer, &[payer, &mint]).unwrap();
    for h in holders {
        let ix = spl_associated_token_account::instruction::create_associated_token_account(
            &payer.pubkey(),
            h,
            &mint.pubkey(),
            &token_program,
        );
        let to = ata(h, &mint.pubkey(), &token_program);
        let mint_ix = spl_token_2022::instruction::mint_to(
            &token_program,
            &mint.pubkey(),
            &to,
            &payer.pubkey(),
            &[],
            MINTED,
        )
        .unwrap();
        send(svm, &[ix, mint_ix], payer, &[payer]).unwrap();
    }
    mint.pubkey()
}

fn setup_with(token_program: Pubkey, fee_bps: Option<u16>) -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/kit_escrow.so"
    ));
    svm.add_program(kit_escrow::id(), bytes).unwrap();
    let (client, provider, arbiter, stranger) = (
        Keypair::new(),
        Keypair::new(),
        Keypair::new(),
        Keypair::new(),
    );
    for k in [&client, &provider, &arbiter, &stranger] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let mut c: Clock = svm.get_sysvar();
    c.unix_timestamp = 1_800_000_000;
    svm.set_sysvar(&c);
    let mint = make_mint(
        &mut svm,
        &client,
        token_program,
        fee_bps,
        &[client.pubkey(), stranger.pubkey()],
    );
    Env {
        svm,
        client,
        provider,
        arbiter,
        stranger,
        mint,
        token_program,
    }
}

fn setup() -> Env {
    setup_with(spl_token::ID, None)
}

impl Env {
    fn deal_pda(&self, client: &Pubkey, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[DEAL_SEED, client.as_ref(), &id.to_le_bytes()],
            &kit_escrow::id(),
        )
        .0
    }
    fn rep_pda(&self, subject: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[REPUTATION_SEED, subject.as_ref()], &kit_escrow::id()).0
    }
    fn ata(&self, owner: &Pubkey) -> Pubkey {
        ata(owner, &self.mint, &self.token_program)
    }

    #[allow(clippy::too_many_arguments)]
    fn create_as(
        &mut self,
        client: &Keypair,
        id: u64,
        provider: Pubkey,
        arbiter: Option<Pubkey>,
        amount: u64,
        deadline: i64,
        review: i64,
    ) -> Result<Pubkey, String> {
        let deal = self.deal_pda(&client.pubkey(), id);
        let ix = Instruction::new_with_bytes(
            kit_escrow::id(),
            &kit_escrow::instruction::Create {
                deal_id: id,
                provider,
                arbiter,
                amount,
                deadline,
                review_period: review,
                terms_hash: [7; 32],
            }
            .data(),
            kit_escrow::accounts::Create {
                client: client.pubkey(),
                deal,
                mint: self.mint,
                client_token: self.ata(&client.pubkey()),
                vault: self.ata(&deal),
                token_program: self.token_program,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &[ix], client, &[client]).map(|_| deal)
    }

    fn create(&mut self, id: u64, with_arbiter: bool) -> Pubkey {
        let client = self.client.insecure_clone();
        let arbiter = with_arbiter.then(|| self.arbiter.pubkey());
        let deadline = now(&self.svm) + 3 * DAY;
        self.create_as(
            &client,
            id,
            self.provider.pubkey(),
            arbiter,
            AMOUNT,
            deadline,
            DAY,
        )
        .unwrap()
    }

    fn deliver(&mut self, deal: Pubkey, who: &Keypair) -> Result<(), String> {
        let ix = Instruction::new_with_bytes(
            kit_escrow::id(),
            &kit_escrow::instruction::Deliver {
                delivery_hash: [9; 32],
            }
            .data(),
            kit_escrow::accounts::Deliver {
                provider: who.pubkey(),
                deal,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &[ix], who, &[who])
    }

    fn dispute(&mut self, deal: Pubkey, who: &Keypair) -> Result<(), String> {
        let d = self.deal(deal);
        let ix = Instruction::new_with_bytes(
            kit_escrow::id(),
            &kit_escrow::instruction::Dispute {}.data(),
            kit_escrow::accounts::Dispute {
                client: who.pubkey(),
                deal,
                reputation: self.rep_pda(&d.provider),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &[ix], who, &[who])
    }

    fn payout_ix(
        &self,
        deal: Pubkey,
        signer: Pubkey,
        data: Vec<u8>,
        provider_token: Option<Pubkey>,
    ) -> Instruction {
        let d = self.deal(deal);
        Instruction::new_with_bytes(
            kit_escrow::id(),
            &data,
            kit_escrow::accounts::Payout {
                signer,
                deal,
                mint: self.mint,
                vault: self.ata(&deal),
                provider: d.provider,
                provider_token: provider_token.unwrap_or_else(|| self.ata(&d.provider)),
                client: d.client,
                reputation: self.rep_pda(&d.provider),
                token_program: self.token_program,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn release(&mut self, deal: Pubkey, who: &Keypair) -> Result<(), String> {
        let ix = self.payout_ix(
            deal,
            who.pubkey(),
            kit_escrow::instruction::Release {}.data(),
            None,
        );
        send(&mut self.svm, &[ix], who, &[who])
    }

    fn claim(&mut self, deal: Pubkey, who: &Keypair) -> Result<(), String> {
        let ix = self.payout_ix(
            deal,
            who.pubkey(),
            kit_escrow::instruction::Claim {}.data(),
            None,
        );
        send(&mut self.svm, &[ix], who, &[who])
    }

    fn refund_ix(&self, deal: Pubkey, signer: Pubkey, client_token: Option<Pubkey>) -> Instruction {
        let d = self.deal(deal);
        Instruction::new_with_bytes(
            kit_escrow::id(),
            &kit_escrow::instruction::Refund {}.data(),
            kit_escrow::accounts::Refund {
                signer,
                deal,
                mint: self.mint,
                vault: self.ata(&deal),
                client: d.client,
                client_token: client_token.unwrap_or_else(|| self.ata(&d.client)),
                reputation: self.rep_pda(&d.provider),
                token_program: self.token_program,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn refund(&mut self, deal: Pubkey, who: &Keypair) -> Result<(), String> {
        let ix = self.refund_ix(deal, who.pubkey(), None);
        send(&mut self.svm, &[ix], who, &[who])
    }

    fn deal(&self, deal: Pubkey) -> Deal {
        let acc = self.svm.get_account(&deal).expect("deal account");
        Deal::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn rep(&self, subject: &Pubkey) -> Option<Reputation> {
        let acc = self.svm.get_account(&self.rep_pda(subject))?;
        Reputation::try_deserialize(&mut acc.data.as_slice()).ok()
    }
}

// ------------------------------------------------------------- happy paths

#[test]
fn create_deliver_release() {
    let mut e = setup();
    let client_before = balance(&e.svm, &e.ata(&e.client.pubkey()));
    let deal = e.create(1, true);
    assert_eq!(balance(&e.svm, &e.ata(&deal)), AMOUNT);
    assert_eq!(
        balance(&e.svm, &e.ata(&e.client.pubkey())),
        client_before - AMOUNT
    );
    let d = e.deal(deal);
    assert_eq!(
        (d.status, d.amount, d.client, d.provider),
        (
            Status::Funded,
            AMOUNT,
            e.client.pubkey(),
            e.provider.pubkey()
        )
    );

    let provider = e.provider.insecure_clone();
    e.deliver(deal, &provider).unwrap();
    assert_eq!(e.deal(deal).status, Status::Delivered);
    assert_eq!(e.deal(deal).delivery_hash, [9; 32]);

    let client = e.client.insecure_clone();
    e.release(deal, &client).unwrap();
    assert_eq!(e.deal(deal).status, Status::Released);
    assert_eq!(balance(&e.svm, &e.ata(&e.provider.pubkey())), AMOUNT);
    assert!(
        e.svm
            .get_account(&e.ata(&deal))
            .is_none_or(|a| a.lamports == 0),
        "vault closed"
    );
    let r = e.rep(&e.provider.pubkey()).unwrap();
    assert_eq!(
        (r.completed, r.refunded, r.disputed, r.volume),
        (1, 0, 0, AMOUNT as u128)
    );
    assert_eq!(r.score(), 10_000);
    assert_eq!(r.subject, e.provider.pubkey());
}

#[test]
fn provider_claims_after_review_period() {
    let mut e = setup();
    let deal = e.create(1, true);
    let provider = e.provider.insecure_clone();
    e.deliver(deal, &provider).unwrap();
    expect_err(e.claim(deal, &provider), EscrowError::TooEarly);
    warp(&mut e.svm, DAY);
    e.claim(deal, &provider).unwrap();
    assert_eq!(balance(&e.svm, &e.ata(&e.provider.pubkey())), AMOUNT);
}

#[test]
fn client_refund_after_deadline() {
    let mut e = setup();
    let before = balance(&e.svm, &e.ata(&e.client.pubkey()));
    let deal = e.create(1, false);
    let client = e.client.insecure_clone();
    expect_err(e.refund(deal, &client), EscrowError::TooEarly);
    warp(&mut e.svm, 3 * DAY + 1);
    e.refund(deal, &client).unwrap();
    assert_eq!(balance(&e.svm, &e.ata(&e.client.pubkey())), before);
    assert_eq!(e.deal(deal).status, Status::Refunded);
    assert_eq!(e.rep(&e.provider.pubkey()).unwrap().refunded, 1);
}

#[test]
fn provider_can_refund_any_time() {
    let mut e = setup();
    let deal = e.create(1, false);
    let provider = e.provider.insecure_clone();
    e.refund(deal, &provider).unwrap();
    assert_eq!(e.deal(deal).status, Status::Refunded);
}

#[test]
fn dispute_then_arbiter_releases_or_refunds() {
    let mut e = setup();
    let (client, provider, arbiter) = (
        e.client.insecure_clone(),
        e.provider.insecure_clone(),
        e.arbiter.insecure_clone(),
    );
    let a = e.create(1, true);
    let b = e.create(2, true);
    for d in [a, b] {
        e.deliver(d, &provider).unwrap();
        e.dispute(d, &client).unwrap();
        assert_eq!(e.deal(d).status, Status::Disputed);
    }
    expect_err(e.release(a, &client), EscrowError::WrongStatus); // the client can't overrule its own dispute
    expect_err(e.claim(a, &provider), EscrowError::WrongStatus);
    e.release(a, &arbiter).unwrap();
    e.refund(b, &arbiter).unwrap();
    assert_eq!(balance(&e.svm, &e.ata(&e.provider.pubkey())), AMOUNT);
    let r = e.rep(&e.provider.pubkey()).unwrap();
    assert_eq!((r.completed, r.refunded, r.disputed), (1, 1, 2));
    assert_eq!(r.score(), 2_500);
}

// ---------------------------------------------------- security review fixes

#[test]
fn client_refunds_unresolved_dispute_after_arbiter_timeout() {
    let mut e = setup();
    let (client, provider) = (e.client.insecure_clone(), e.provider.insecure_clone());
    let before = balance(&e.svm, &e.ata(&client.pubkey()));
    let deal = e.create(1, true);
    e.deliver(deal, &provider).unwrap();
    e.dispute(deal, &client).unwrap();
    warp(&mut e.svm, DAY + ARBITER_TIMEOUT - 1);
    expect_err(e.refund(deal, &client), EscrowError::TooEarly);
    warp(&mut e.svm, 1);
    e.refund(deal, &client).unwrap();
    assert_eq!(balance(&e.svm, &e.ata(&client.pubkey())), before);
}

#[test]
fn client_cannot_refund_delivered_deal() {
    let mut e = setup();
    let (client, provider) = (e.client.insecure_clone(), e.provider.insecure_clone());
    let deal = e.create(1, true);
    e.deliver(deal, &provider).unwrap();
    warp(&mut e.svm, 365 * DAY);
    expect_err(e.refund(deal, &client), EscrowError::Unauthorized);
}

#[test]
fn rejects_invalid_params() {
    let mut e = setup();
    let client = e.client.insecure_clone();
    let (p, a, c) = (e.provider.pubkey(), e.arbiter.pubkey(), client.pubkey());
    let t = now(&e.svm);
    let cases: [(u64, Pubkey, Option<Pubkey>, u64, i64, i64); 8] = [
        (1, c, None, AMOUNT, t + DAY, DAY),                   // self-deal
        (2, p, Some(p), AMOUNT, t + DAY, DAY),                // provider as arbiter
        (3, p, Some(c), AMOUNT, t + DAY, DAY),                // client as arbiter
        (4, p, None, 0, t + DAY, DAY),                        // zero amount
        (5, p, None, AMOUNT, t, DAY),                         // deadline not in the future
        (6, p, None, AMOUNT, t + DAY, MAX_REVIEW_PERIOD + 1), // review period too long
        (7, p, Some(a), AMOUNT, t + DAY, 0),                  // arbiter with no review window
        (8, Pubkey::default(), None, AMOUNT, t + DAY, DAY),   // no provider
    ];
    for (id, provider, arbiter, amount, deadline, review) in cases {
        expect_err(
            e.create_as(&client, id, provider, arbiter, amount, deadline, review)
                .map(|_| ()),
            EscrowError::InvalidParams,
        );
    }
    // the boundaries themselves are fine
    e.create_as(&client, 10, p, None, AMOUNT, t + DAY, 0)
        .unwrap();
    e.create_as(&client, 11, p, Some(a), AMOUNT, t + DAY, MAX_REVIEW_PERIOD)
        .unwrap();
}

#[test]
fn deal_ids_cannot_be_reused() {
    let mut e = setup();
    e.create(1, false);
    let client = e.client.insecure_clone();
    let t = now(&e.svm);
    let p = e.provider.pubkey();
    assert!(e
        .create_as(&client, 1, p, None, AMOUNT, t + DAY, DAY)
        .is_err());
}

#[test]
fn status_and_timing_rules() {
    let mut e = setup();
    let (client, provider) = (e.client.insecure_clone(), e.provider.insecure_clone());
    let late = e.create(1, true);
    warp(&mut e.svm, 3 * DAY + 1);
    expect_err(e.deliver(late, &provider), EscrowError::TooLate);

    let deal = e.create(2, true);
    expect_err(e.dispute(deal, &client), EscrowError::WrongStatus); // nothing delivered yet
    e.deliver(deal, &provider).unwrap();
    expect_err(e.deliver(deal, &provider), EscrowError::WrongStatus);
    warp(&mut e.svm, DAY);
    expect_err(e.dispute(deal, &client), EscrowError::TooLate); // review period over
    e.release(deal, &client).unwrap();
    // settled deals have no vault any more (closed, rent back to the client), so a
    // second payout fails on the account check before it even reaches the status check
    let again = e
        .release(deal, &client)
        .expect_err("second release must fail");
    assert!(again.contains("AccountNotInitialized"), "{again}");
    let again = e
        .refund(deal, &client)
        .expect_err("refund after release must fail");
    assert!(again.contains("AccountNotInitialized"), "{again}");

    let no_arbiter = e.create(3, false);
    e.deliver(no_arbiter, &provider).unwrap();
    expect_err(e.dispute(no_arbiter, &client), EscrowError::Unauthorized);
}

#[test]
fn strangers_cannot_touch_a_deal() {
    let mut e = setup();
    let (stranger, provider) = (e.stranger.insecure_clone(), e.provider.insecure_clone());
    let deal = e.create(1, true);
    assert!(e.deliver(deal, &stranger).is_err()); // has_one = provider
    expect_err(e.release(deal, &stranger), EscrowError::Unauthorized);
    expect_err(e.refund(deal, &stranger), EscrowError::Unauthorized);
    e.deliver(deal, &provider).unwrap();
    assert!(e.dispute(deal, &stranger).is_err()); // has_one = client
    warp(&mut e.svm, DAY);
    expect_err(e.claim(deal, &stranger), EscrowError::Unauthorized);
    expect_err(e.release(deal, &provider), EscrowError::Unauthorized); // provider can't release to itself
    assert_eq!(balance(&e.svm, &e.ata(&deal)), AMOUNT, "funds untouched");
}

#[test]
fn funds_only_go_to_the_deal_parties() {
    let mut e = setup();
    let (client, stranger) = (e.client.insecure_clone(), e.stranger.insecure_clone());
    let deal = e.create(1, false);
    let thief = e.ata(&stranger.pubkey());

    // swap the provider's token account for the stranger's
    let ix = e.payout_ix(
        deal,
        client.pubkey(),
        kit_escrow::instruction::Release {}.data(),
        Some(thief),
    );
    assert!(send(&mut e.svm, &[ix], &client, &[&client]).is_err());
    // swap the client's token account on refund
    let provider = e.provider.insecure_clone();
    let ix = e.refund_ix(deal, provider.pubkey(), Some(thief));
    assert!(send(&mut e.svm, &[ix], &provider, &[&provider]).is_err());
    // point the "provider" at the stranger
    let mut ix = e.payout_ix(
        deal,
        client.pubkey(),
        kit_escrow::instruction::Release {}.data(),
        Some(thief),
    );
    ix.accounts[4].pubkey = stranger.pubkey();
    assert!(send(&mut e.svm, &[ix], &client, &[&client]).is_err());
    // drain another deal's vault through this deal
    let other = e.create(2, false);
    let mut ix = e.payout_ix(
        deal,
        client.pubkey(),
        kit_escrow::instruction::Release {}.data(),
        None,
    );
    ix.accounts[3].pubkey = e.ata(&other);
    assert!(send(&mut e.svm, &[ix], &client, &[&client]).is_err());

    assert_eq!(balance(&e.svm, &e.ata(&deal)), AMOUNT);
    assert_eq!(balance(&e.svm, &e.ata(&other)), AMOUNT);
    assert_eq!(balance(&e.svm, &thief), MINTED);
}

#[test]
fn reputation_cannot_be_written_directly() {
    // Reputation PDAs are program-owned; only escrow outcomes change them. A fake
    // "reputation" account passed in place of the real PDA fails the seeds check.
    let mut e = setup();
    let (client, provider) = (e.client.insecure_clone(), e.provider.insecure_clone());
    let deal = e.create(1, true);
    e.deliver(deal, &provider).unwrap();
    let mut ix = e.payout_ix(
        deal,
        client.pubkey(),
        kit_escrow::instruction::Release {}.data(),
        None,
    );
    ix.accounts[7].pubkey = e.rep_pda(&client.pubkey());
    assert!(send(&mut e.svm, &[ix], &client, &[&client]).is_err());
    assert!(e.rep(&client.pubkey()).is_none());
}

// ---------------------------------------------------------------- Token-2022

#[test]
fn token_2022_mint_works() {
    let mut e = setup_with(spl_token_2022::ID, None);
    let (client, provider) = (e.client.insecure_clone(), e.provider.insecure_clone());
    let deal = e.create(1, false);
    e.deliver(deal, &provider).unwrap();
    e.release(deal, &client).unwrap();
    assert_eq!(balance(&e.svm, &e.ata(&e.provider.pubkey())), AMOUNT);
}

#[test]
fn transfer_fee_mint_is_rejected() {
    let mut e = setup_with(spl_token_2022::ID, Some(100)); // 1% fee
    let client = e.client.insecure_clone();
    let t = now(&e.svm);
    let p = e.provider.pubkey();
    expect_err(
        e.create_as(&client, 1, p, None, AMOUNT, t + DAY, DAY)
            .map(|_| ()),
        EscrowError::TransferFailed,
    );
}

// ------------------------------------------------------ random walk invariants

/// Deterministic xorshift so failures reproduce.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[test]
fn random_walk_preserves_invariants() {
    for seed in [0x9E37_79B9_7F4A_7C15u64, 42, 7_777_777, 0xDEAD_BEEF] {
        let mut e = setup();
        let mut rng = Rng(seed);
        let actors = [
            e.client.insecure_clone(),
            e.provider.insecure_clone(),
            e.arbiter.insecure_clone(),
            e.stranger.insecure_clone(),
        ];
        let mut deals: Vec<Pubkey> = vec![];
        let mut payouts = std::collections::HashMap::<Pubkey, u32>::new();
        let (mut completed, mut refunded, mut disputed) = (0u64, 0u64, 0u64);
        let total_start = balance(&e.svm, &e.ata(&e.client.pubkey()));

        for step in 0..120u64 {
            let action = rng.below(8);
            if action == 0 || deals.is_empty() {
                let arbiter = rng.below(2) == 0;
                deals.push(e.create(step + 1, arbiter));
                continue;
            }
            let deal = deals[rng.below(deals.len() as u64) as usize];
            // 75% the right party for the action, otherwise anyone
            let who = |rng: &mut Rng, role: usize| {
                actors[if rng.below(4) == 0 {
                    rng.below(4) as usize
                } else {
                    role
                }]
                .insecure_clone()
            };
            let before = balance(&e.svm, &e.ata(&deal));
            let (ok, caller) = match action {
                1 => {
                    let w = who(&mut rng, 1);
                    (e.deliver(deal, &w).is_ok(), w)
                }
                2 => {
                    let w = who(&mut rng, 0);
                    let ok = e.dispute(deal, &w).is_ok();
                    if ok {
                        disputed += 1
                    }
                    (ok, w)
                }
                3 => {
                    let role = [0, 2][rng.below(2) as usize];
                    let w = who(&mut rng, role);
                    let ok = e.release(deal, &w).is_ok();
                    if ok {
                        completed += 1
                    }
                    (ok, w)
                }
                4 => {
                    let w = who(&mut rng, 1);
                    let ok = e.claim(deal, &w).is_ok();
                    if ok {
                        completed += 1
                    }
                    (ok, w)
                }
                5 => {
                    let role = rng.below(3) as usize;
                    let w = who(&mut rng, role);
                    let ok = e.refund(deal, &w).is_ok();
                    if ok {
                        refunded += 1
                    }
                    (ok, w)
                }
                _ => {
                    warp(
                        &mut e.svm,
                        if rng.below(6) == 0 {
                            rng.below(40 * DAY as u64) as i64
                        } else {
                            rng.below(12 * 3600) as i64
                        },
                    );
                    continue;
                }
            };
            if ok && before > 0 && balance(&e.svm, &e.ata(&deal)) == 0 {
                *payouts.entry(deal).or_default() += 1;
                let d = e.deal(deal);
                let party = caller.pubkey() == d.client
                    || caller.pubkey() == d.provider
                    || d.is_arbiter(&caller.pubkey());
                assert!(party, "seed {seed}: a non-party moved funds out of {deal}");
            }
        }

        // single payout, vaults match status, conservation, reputation matches outcomes
        let mut open = 0;
        for d in &deals {
            assert!(
                payouts.get(d).copied().unwrap_or(0) <= 1,
                "seed {seed}: double payout"
            );
            let st = e.deal(*d).status;
            let held = balance(&e.svm, &e.ata(d));
            match st {
                Status::Funded | Status::Delivered | Status::Disputed => {
                    assert_eq!(held, AMOUNT, "seed {seed}: open deal underfunded");
                    open += held;
                }
                Status::Released | Status::Refunded => {
                    assert_eq!(held, 0, "seed {seed}: settled deal still holds funds")
                }
            }
        }
        let total = balance(&e.svm, &e.ata(&e.client.pubkey()))
            + balance(&e.svm, &e.ata(&e.provider.pubkey()))
            + open;
        assert_eq!(
            total, total_start,
            "seed {seed}: tokens created or destroyed"
        );
        let r = e.rep(&e.provider.pubkey());
        let (c, f, d) = r.map_or((0, 0, 0), |r| (r.completed, r.refunded, r.disputed));
        assert_eq!(
            (c, f, d),
            (completed, refunded, disputed),
            "seed {seed}: reputation drift"
        );
        assert!(
            completed + refunded > 0,
            "seed {seed}: walk never settled a deal (vacuous)"
        );
    }
}
