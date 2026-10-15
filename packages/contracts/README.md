# @codkit/contracts

Escrow and reputation primitives for agent commerce: **create → fund → deliver → release / refund**, plus an onchain track record.

| Chain | Status | Location |
| --- | --- | --- |
| EVM (Solidity, Foundry) | ✅ v0.1, tested (unit, fuzz, anvil integration) | [`evm/`](evm) |
| Solana (Anchor) | planned | `solana/` |
| Sui (Move) | ✅ v0.1, tested (Move unit tests, localnet end to end) | [`sui/`](sui) |

> Not audited. Use it on testnets and in hackathon demos only.

## Escrow (EVM)

```
create ─▶ fund ─▶ deliver ─▶ release (client / arbiter)
  │         │        │   └──▶ claim   (provider, after the review period)
  │         │        └─────▶ dispute (client) ─▶ arbiter release / refund
  │         └──────────────▶ refund  (client after deadline, provider any time, arbiter)
  └──▶ cancel (client, before funding)
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

## Develop

```bash
pnpm --filter @codkit/contracts test      # forge test + anvil integration (needs Foundry)
pnpm --filter @codkit/contracts example   # narrated lifecycle on a local anvil
pnpm --filter @codkit/contracts example:sui   # publish + lifecycle on a Sui localnet
```

`test` also runs `sui move test` when the `sui` CLI is installed. To run the Sui example, first start a localnet in another terminal with `sui start --with-faucet --force-regenesis`.

Clone with `--recurse-submodules` (forge-std), or run `git submodule update --init`.
