# @codkit/contracts

Escrow and reputation primitives for agent commerce: **create → fund → deliver → release / refund**, plus an onchain track record.

| Chain | Status | Location |
| --- | --- | --- |
| EVM (Solidity, Foundry) | ✅ tested: unit, invariant fuzzing, 100% coverage, testnet end to end | [`evm/`](evm) |
| Sui (Move) | ✅ tested: unit, 100% coverage, testnet end to end | [`sui/`](sui) |
| Solana (Anchor) | ✅ tested: LiteSVM unit + random-walk invariants on the SBPF v3 binary; not deployed yet | [`solana/`](solana) |

> Reviewed ([security review](https://github.com/deyoungjohn/codkit/blob/main/docs/security/escrow-review.md)) but **not independently audited**. Use it on testnets and in hackathon demos only.

All three implement the same rules:
- **Review period:** at most 30 days, and above zero when there's an arbiter.
- **Arbiter timeout:** if a dispute is still unresolved 30 days after the review period ends, the client can refund it.
- **Fee-charging tokens** are rejected.

## Escrow (EVM)

```
create ─▶ fund ─▶ deliver ─▶ release (client / arbiter)
  │         │        │   └──▶ claim   (provider, after the review period)
  │         │        └─────▶ dispute (client) ─▶ arbiter release / refund
  │         └──────────────▶ refund  (client after deadline, provider any time, arbiter)
  └──▶ cancel (client, before funding)

  disputed and the arbiter silent for ARBITER_TIMEOUT (30 days) after the review period ─▶ client refund
```

- Works with ERC20 tokens only (stablecoins are the point). Fee-on-transfer tokens are rejected, and tokens that return `false` are handled.
- `arbiter` is optional. Without one, the client can't dispute and the provider can claim after `reviewPeriod`.
- `termsHash` / `deliveryHash` hold a hash or CID of what was agreed and what was delivered, which works well with receipts.
- Every outcome is recorded in `Reputation` (completed / refunded / disputed counts, volume, and `score()` in bps). A failure to record can never block a payout.

## TypeScript bindings

Write helpers return plain `{ to, data }` transactions, so an agent can send them through the policy guard:

```ts
import { escrowAbi, escrowTxs, dealIdFromLogs, readDeal, hashText } from "@codkit/contracts";
import { createEvmGuard } from "@codkit/policy/evm";

const agent = createEvmGuard({ engine, chainId, account, reader: publicClient, sender: walletClient, abis: [escrowAbi] });
const tx = escrowTxs(ESCROW);

await agent.send(tx.approve(USDC, amount));            // the policy counts the approval as spend
const { result: hash } = await agent.send(tx.createAndFund({ provider, token: USDC, amount, deadline, termsHash: hashText(spec) }));
const id = dealIdFromLogs((await publicClient.waitForTransactionReceipt({ hash })).logs);
// provider: tx.deliver(id, hashText(result)); client: tx.release(id)
```

The package also provides `readDeal`, `readReputation`, `parseEscrowLogs`, `deployData`, and the ABIs and bytecode. If you change the contracts, run `pnpm abi` to regenerate them.

## Sui (Move)

The Sui package has the same lifecycle. The only difference is that there is no unfunded state, because the coin is locked when the deal is created. Each deal is a shared `Escrow<T>` object, so it works with any coin type (SUI or USDC). `Reputation` is a singleton shared object created on publish, and only the package's `escrow` module can write to it.

```ts
import { suiEscrow, suiEscrowCreateAction, Transaction } from "@codkit/contracts/sui";

const escrow = suiEscrow({ packageId, reputationId });
const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [amount]);
escrow.create(tx, { coinType: "0x2::sui::SUI", payment: coin, provider, deadline: Date.now() + 86_400_000, terms: "spec" });
// also: deliver / dispute / release / claim / refund

await engine.authorize(suiEscrowCreateAction({ packageId }, { coinType, provider, amount })); // gate it with policy
```

Publish (run by a human): `cd sui && sui client publish`. Record the package id and the created `Reputation` object id.

## Deploy EVM (run by a human)

```bash
cd packages/contracts/evm
forge script script/Deploy.s.sol --rpc-url base_sepolia --account <cast-wallet-name> --broadcast
```

The script deploys `Reputation`, `Escrow`, and `ReceiptAnchor` (used by `@codkit/receipts`), then authorises the escrow as a reputation writer. Record the addresses in your project's deployed-contracts table.

## Solana (Anchor)

The `kit_escrow` program has the same lifecycle as Sui: the deal is funded when it's created.
- **Accounts:**
  - each deal is a PDA at `["deal", client, deal_id]`;
  - its tokens sit in the deal PDA's associated token account, which is closed on settlement so its rent returns to the client;
  - reputation lives at `["reputation", provider]`, and only the program can write it.
- **Tokens:** SPL Token and Token-2022 both work. Mints that take a transfer fee are rejected.

```bash
cd packages/contracts/solana
anchor build      # SBPF v3 (devnet supports v1–v3; v0–v2 deployments are being phased out)
cargo test        # LiteSVM: lifecycle, auth, account-substitution attacks, Token-2022, random walk
```

Toolchain: Anchor 1.2.1 with Solana 4.1.2 (`avm install 1.2.1`). The host Rust is pinned to 1.99.1 because LiteSVM 0.17 needs at least 1.97. The program itself builds with Solana's platform tools.

**The program ID** comes from `target/deploy/kit_escrow-keypair.json`, which is not committed. Before the first devnet deploy:
1. create or keep that keypair;
2. run `anchor keys sync`;
3. deploy with `anchor deploy --provider.cluster devnet` from your own wallet.

## Develop

```bash
pnpm --filter @codkit/contracts test      # forge test + anvil integration (needs Foundry)
pnpm --filter @codkit/contracts example   # narrated lifecycle on a local anvil
pnpm --filter @codkit/contracts example:sui   # publish + lifecycle on a Sui localnet
```

`test` also runs `sui move test` when the `sui` CLI is installed. To run the Sui example, first start a localnet in another terminal with `sui start --with-faucet --force-regenesis`.

Clone with `--recurse-submodules` (forge-std), or run `git submodule update --init`.
