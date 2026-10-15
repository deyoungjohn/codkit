# Escrow security review

**Scope:** the escrow and reputation contracts in [`packages/contracts`](../../packages/contracts):

- **EVM:** `Escrow.sol`, `Reputation.sol`, `ReceiptAnchor.sol`
- **Sui Move:** `kit_escrow::{escrow, reputation, anchor}`
- **Solana (Anchor):** the `kit_escrow` program, written during this review with every fix built in

**Date:** 2026-10-15. **Reviewer:** the maintainer's AI assistant, working with tools.

**Status:** all fixes are applied and tested. This is a structured self-review, **not an independent audit.** The contracts remain testnet-only until someone independent has reviewed them.

## Summary

The core money flows held up under every method below: random multi-actor fuzzing, static analysis, mutation checks and full coverage. No issue allowed theft, double payout, or a non-party moving funds. The findings are about **liveness**, meaning funds that could get stuck, and **parameter hygiene**. There is also one **design limitation** in how much the reputation counters can be trusted.

| ID | Severity | Finding | Chains | Status |
| --- | --- | --- | --- | --- |
| M-01 | Medium | Funds in a dispute are locked forever if the arbiter never acts | EVM, Sui | Fixed |
| M-02 | Medium (design) | Reputation can be farmed with worthless tokens or sybil counterparties; `volume` mixes token units | all | Acknowledged, documented |
| L-01 | Low | Unbounded review period: a client can park the provider's payment for years (on Sui, an overflow abort blocks `claim`) | EVM, Sui | Fixed |
| L-02 | Low | An arbiter with a zero review period makes disputes impossible | EVM, Sui | Fixed |
| L-03 | Low | A deal can be funded after its deadline, when it can no longer be delivered | EVM | Fixed |
| L-04 | Low | `Reputation` ownership: single-step transfer, and a zero owner is accepted | EVM | Fixed |
| I-01 | Info | Events emitted after external calls (log ordering under reentrancy) | EVM | Fixed |
| I-02 | Info | Slither `reentrancy-balance` on `fund` | EVM | False positive, test added |
| I-03 | Info | The arbiter is chosen by the client | all | Acknowledged |
| I-04 | Info | Blacklisting, rebasing and fee-charging tokens | EVM, Solana | Acknowledged / rejected |
| I-05 | Info | Tokens sent straight to the escrow can't be recovered | EVM | Acknowledged |
| I-06 | Info | Timestamps come from validators | all | Acknowledged |
| I-07 | Info | Settled Sui escrows stay as shared objects | Sui | Acknowledged |

## Method

| | EVM | Sui | Solana |
| --- | --- | --- | --- |
| Manual review | line by line, against the lifecycle diagram | same | written to the same rules |
| Static analysis | Slither 0.11.6, `forge lint` (Foundry 1.8.3) | compiler | `cargo clippy -D warnings` |
| Unit tests | 32 | 41 | 15 |
| Random / property tests | 6 Foundry invariants, 64 runs × 128 calls from 5 actors (role-aware: 80% the right party, 20% anyone) | n/a | seeded random walk, 4 seeds × 120 steps, checking the same invariants |
| Coverage | **100%** lines, statements, branches, functions | **100%** (`sui move test --coverage`) | every instruction, error and account constraint exercised |
| Mutation checks | 2 mutants (double refund, missing auth): both caught | n/a | missing auth on `release`: caught by 2 tests |

The Solana tests run in LiteSVM 0.17 against the **exact SBPF v3 binary** that `anchor build` produces. Devnet has SBPF v1, v2 and v3 enabled, and a pending feature (SIMD-0500) will disable new v0–v2 deployments, so v3 is the right target.

**Invariants**, checked after every random call sequence on EVM and every random walk on Solana:
1. The escrow holds exactly the sum of the amounts of open deals (Funded, Delivered or Disputed).
2. Tokens are conserved: actors plus the escrow always hold what was minted.
3. A deal pays out (release, claim or refund) at most once.
4. Only a deal's client, provider or arbiter ever moves its funds.
5. Released, Refunded and Cancelled are final.
6. Reputation counters equal the outcomes that actually happened.

## Findings

### M-01: Funds in a dispute are locked forever if the arbiter never acts

Once the client disputes a delivery, only the arbiter can settle it, apart from the provider giving up and refunding. If the arbiter disappears, which is likely enough with a hackathon-grade arbiter key, the funds stay in the contract forever.

**Fix:** if a dispute is still open `ARBITER_TIMEOUT` (30 days) after the review period ends, the **client** can refund it. Refunding restores the state before the deal. The arbiter can still decide at any time before that.
- **EVM:** `refund()`.
- **Sui:** `refund()` and `arbiter_timeout_ms()`.
- **Solana:** `refund` and `ARBITER_TIMEOUT`.

**Tests:**
- `test_clientCanRefundUnresolvedDisputeAfterArbiterTimeout` and `test_arbiterCanStillDecideBeforeTimeout` (EVM);
- `client_refunds_unresolved_dispute_after_arbiter_timeout` and `client_cannot_refund_dispute_before_arbiter_timeout` (Sui);
- `client_refunds_unresolved_dispute_after_arbiter_timeout` (Solana).

### M-02: Reputation counters are only as meaningful as the deals behind them

Only the escrow can write reputation, so counters can't be forged directly. But a deal can use any token, and any two addresses can trade, so one person can mint a worthless token and run deals between their own addresses to inflate `completed` and `volume`. `volume` also adds up raw amounts across tokens with different decimals.

**Status:** design limitation, documented in each contract (NatSpec / doc comments). Consumers should weigh the counters using the `Recorded` / `Released` events, for example counting only deals in tokens they trust, or only with counterparties they know. Making this robust needs identity or stake, which is out of scope for v0.1 (see ERC-8004 in the roadmap).

### L-01: Unbounded review period

A client could set a review period of up to `uint32` max (about 136 years) on EVM, or `u64` max on Sui. The provider can't claim until it ends. On Sui, `delivered_at_ms + review_period_ms` would also overflow, so `claim` and `dispute` abort for good. The provider could still refund, giving up, and should read the terms before delivering, but this is a needless trap.

**Fix:** `MAX_REVIEW_PERIOD` = 30 days, enforced at creation on all three chains. This also keeps the Sui sum far from overflowing. **Tests:** `test_reviewPeriodBounds`, `review_period_above_max_rejected`, `rejects_invalid_params`.

### L-02: An arbiter with a zero review period can't be used

With `reviewPeriod = 0` the dispute window closes the moment the work is delivered. Naming an arbiter is then pointless and misleading to the provider.

**Fix:** a deal that has an arbiter must have a review period above zero. **Tests:** as for L-01, plus `arbiter_with_zero_review_period_rejected`.

### L-03: Funding after the deadline (EVM)

`fund` accepted a deal whose deadline had already passed. The provider could no longer deliver, so the client's funds sat until they refunded them. **Fix:** `fund` reverts with `TooLate`. Sui and Solana fund at creation, which already requires a future deadline. **Test:** `test_cannotFundAfterDeadline`.

### L-04: Reputation ownership (EVM)

A typo in `transferOwnership`, or address zero, would permanently lose control of `setWriter`. **Fix:** two-step ownership (`transferOwnership` → `acceptOwnership`), and zero-address checks in the constructor. **Tests:** `test_onlyOwnerAdmin`, `test_cannotRenounceToZero`.

Sui and Solana have no owner: only the escrow code can write reputation.

### I-01: Events after external calls (EVM)

`Released`, `Refunded` and `Disputed` were emitted after the token or reputation calls. A reentrant token could reorder the logs that indexers read. **Fix:** these events are now emitted before the external calls. `Funded` stays after its transfer, because it reports the balance check, and `fund` holds the reentrancy lock.

### I-02: Slither "reentrancy-balance" on `fund` (false positive)

Slither flags that `fund` reads the escrow's balance before and after `transferFrom`. A reentrant call could only change that balance through `release`, `claim` or `refund`, and all three share `fund`'s reentrancy lock. The unguarded functions (`createDeal`, `cancel`, `deliver`, `dispute`) never move tokens. **Test:** `test_reentrantTokenCannotDoublePay` uses a token that tries to re-enter `release`, `refund` and `claim` on every transfer out of the escrow. Every attempt fails and the balances are exact.

### I-03: The client chooses the arbiter

The arbiter can release or refund at any time while funds are held. A client could name an arbiter it controls. The deal terms, including the arbiter, are on-chain before any work starts, so **providers must vet the arbiter before delivering.**

### I-04: Non-standard tokens

- **Fee-on-transfer:** rejected. On EVM, `fund` checks the balance change. On Solana, `create` checks the vault received the exact amount; see `transfer_fee_mint_is_rejected`, which uses a Token-2022 mint with a 1% fee.
- **Rebasing tokens:** unsupported. Balances drift, so payouts can fail.
- **Blacklisting tokens (e.g. USDC):** if the provider is blacklisted, `release` reverts. The provider or arbiter can still refund the client.
- **Missing return values:** handled by a SafeERC20-style call that also requires the token to have code (`test_payoutToCodelessTokenFails`).

### I-05: Tokens sent straight to the contract (EVM)

Tokens sent to `Escrow` outside `fund` can't be recovered; there is no sweep function. Adding one would need an admin, which this contract deliberately doesn't have.

### I-06: Timestamps

Deadlines and review windows use `block.timestamp` on EVM, the `Clock` object on Sui, and the `Clock` sysvar on Solana. Validators can shift these by seconds, which doesn't matter at the hour-to-day scale of these windows.

### I-07: Settled Sui escrows aren't deleted

A settled `Escrow<T>` stays a shared object with an empty balance. That's harmless apart from storage. A future `close` could delete it and refund the storage rebate.

## Solana program notes

The Anchor program implements the rules above from the start. Specifics:

- **Accounts:**
  - Each deal is a PDA at `["deal", client, deal_id]`.
  - Its funds sit in the deal PDA's associated token account (the vault).
  - Reputation lives at `["reputation", provider]`.
- **Supported tokens:** SPL Token and Token-2022, via `token_interface`.
- **On settlement:** the vault is emptied and closed, and its rent goes back to the client. A second payout attempt then fails on the missing vault, which the tests assert.
- **Account substitution:** every account is checked with seeds, `has_one` or associated-token constraints. `funds_only_go_to_the_deal_parties` tries swapping in:
  - the attacker's token account, on release and on refund;
  - a different "provider";
  - another deal's vault.

  Every attempt fails. `reputation_cannot_be_written_directly` tries passing the wrong reputation account, and that fails too.
- **Recipient accounts:** if the recipient's token account doesn't exist yet, it's created during settlement, at the caller's expense. That's a small cost, and it means a missing account can't block a payout.

## Residual risk and next steps

1. **The deployed testnet contracts predate this review.** That's Base Sepolia, and the Sui testnet package `0xb285…7481`. Redeploy from the owner's wallets to pick up the fixes, then rerun `pnpm e2e:evm` and `pnpm e2e:sui`.
2. The Solana program isn't deployed. Deploy it to devnet, and add a TypeScript client and an e2e check like the EVM and Sui ones.
3. Get an independent review before any mainnet use. Hackathon demos on testnet don't need one.
