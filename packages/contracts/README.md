# @iamyoungjohn-kit/contracts

Escrow and reputation primitives for agent commerce: **create → fund → deliver → release / refund**, plus an onchain track record.

| Chain | Status | Location |
| --- | --- | --- |
| EVM (Solidity, Foundry) | ✅ v0.1, tested (unit, fuzz, anvil integration) | [`evm/`](evm) |
| Solana (Anchor) | planned | `solana/` |
| Sui (Move) | planned | `sui/` |

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
import { escrowAbi, escrowTxs, dealIdFromLogs, readDeal, hashText } from "@iamyoungjohn-kit/contracts";
import { createEvmGuard } from "@iamyoungjohn-kit/policy/evm";

const agent = createEvmGuard({ engine, chainId, account, reader: publicClient, sender: walletClient, abis: [escrowAbi] });
const tx = escrowTxs(ESCROW);

await agent.send(tx.approve(USDC, amount));            // the policy counts the approval as spend
const { result: hash } = await agent.send(tx.createAndFund({ provider, token: USDC, amount, deadline, termsHash: hashText(spec) }));
const id = dealIdFromLogs((await publicClient.waitForTransactionReceipt({ hash })).logs);
// provider: tx.deliver(id, hashText(result)); client: tx.release(id)
```

The package also provides `readDeal`, `readReputation`, `parseEscrowLogs`, `deployData`, and the ABIs and bytecode. If you change the contracts, run `pnpm abi` to regenerate them.

## Deploy (run by a human)

```bash
cd packages/contracts/evm
forge script script/Deploy.s.sol --rpc-url base_sepolia --account <cast-wallet-name> --broadcast
```

The script deploys `Reputation` and `Escrow`, then authorises the escrow as a reputation writer. Record the addresses in your project's deployed-contracts table.

## Develop

```bash
pnpm --filter @iamyoungjohn-kit/contracts test      # forge test + anvil integration (needs Foundry)
pnpm --filter @iamyoungjohn-kit/contracts example   # narrated lifecycle on a local anvil
```

Clone with `--recurse-submodules` (forge-std), or run `git submodule update --init`.
