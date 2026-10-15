# Public testnet runbook

Deploy codkit's contracts with **your** wallet, run the end-to-end checks against them, and publish the results. Every script here was rehearsed on local chains (anvil and a Sui localnet) before release.

## 0. Wallets (testnet only)

| Role | What | Funding |
| --- | --- | --- |
| **Deployer** (yours) | Foundry keystore: `cast wallet import deployer --interactive` | ~0.01 Base Sepolia ETH |
| **Agent** | A separate testnet key in `.env` as `AGENT_PRIVATE_KEY` (it plays the AI agent) | ~0.002 ETH + 0.15 USDC from [faucet.circle.com](https://faucet.circle.com) |
| **Sui deployer** (yours) | Your Sui CLI address on testnet (`sui client switch --env testnet`). It receives the `UpgradeCap` | ~1 SUI from `sui client faucet` |
| **Sui agent** | A separate key: `SUI_PRIVATE_KEY` in `.env` (`sui keytool generate ed25519`, then `sui keytool export`). Without it, the e2e signs with the CLI's *active* address, which is usually your deployer | ~0.2 SUI |

Base Sepolia ETH faucets: [Coinbase CDP](https://portal.cdp.coinbase.com/products/faucet), [Alchemy](https://www.alchemy.com/faucets/base-sepolia).

```bash
cp .env.example .env   # fill AGENT_PRIVATE_KEY and, optionally, ETHERSCAN_API_KEY
pnpm install && pnpm build
```

## 1. Deploy to Base Sepolia (Reputation, Escrow, ReceiptAnchor)

```bash
pnpm deploy:evm --network base-sepolia --account deployer --dry-run   # simulate first
pnpm deploy:evm --network base-sepolia --account deployer --verify    # broadcast + verify source
```

- Foundry asks for your keystore password. Your address becomes the deployer and the owner of `Reputation`.
- **Verification:** uses Etherscan if `ETHERSCAN_API_KEY` is set (one Etherscan v2 key covers Basescan), otherwise Sourcify.
- **Output:** writes `packages/contracts/deployments/base-sepolia.json` and regenerates `src/deployments.ts`, so `import { deployments } from "@codkit/contracts"` returns the addresses.

## 2. Publish to Sui testnet (escrow, reputation, anchor)

```bash
sui client switch --env testnet && sui client faucet
pnpm deploy:sui --network testnet --expect-address <your Sui address> --dry-run
pnpm deploy:sui --network testnet --expect-address <your Sui address>
```

This writes `packages/contracts/deployments/sui-testnet.json`, and the Sui CLI records the publication in `packages/contracts/sui/`. Commit both.

## 2b. Solana devnet (program `kit_escrow`)

Deployed from your wallet with `anchor deploy --provider.cluster devnet --provider.wallet <deployer.json>`, then `anchor idl init`. Your deployer is the upgrade authority. See `packages/contracts/README.md`. The deployment is recorded in `packages/contracts/deployments/solana-devnet.json`.

## 3. Run the end-to-end checks

```bash
pnpm e2e:evm --network base-sepolia            # add --walrus to also store the receipt log on Walrus
pnpm e2e:sui --network testnet
pnpm e2e:solana                                 # SOLANA_AGENT_KEYPAIR: a separate devnet key with ~0.05 SOL
```

**Solana checks:**
- the run creates its own test mint (or use `--mint` for devnet USDC);
- a policy-guarded escrow create, simulated before sending;
- an over-cap funding is refused;
- deliver, then release: the provider is paid, the vault closed, and reputation recorded;
- a second payout is refused in simulation;
- the receipt head is anchored in an SPL memo, read back from the chain and verified;
- the provider returns the tokens and closes its token account.

**EVM checks:**
- agent funds a fresh provider (policy-guarded);
- escrow approve + createAndFund 0.10 USDC, then deliver, then release;
- the reputation contract records the completed deal;
- guardrails on a real chain: an over-cap approval, a call to a non-allow-listed contract, and a simulated revert are all refused before signing;
- an **x402 payment through the public facilitator** settles onchain;
- the receipt log is anchored on `ReceiptAnchor` and verified against the onchain head;
- the provider refunds the agent's USDC.

**Sui checks:**
- a policy check on the escrow funding;
- escrow create, deliver and release;
- the receipt log is anchored via `kit_escrow::anchor` and verified;
- the provider refunds the agent.

**RPC:** `sepolia.base.org` is load-balanced and rate-limited. A read right after a confirmed transaction can hit a node that hasn't seen it yet, and `eth_getLogs` is capped at 200 blocks. The e2e polls until the expected state appears, but a dedicated endpoint (Alchemy, Infura, QuickNode, all with free tiers) in `BASE_SEPOLIA_RPC_URL` is faster and more reliable. Use one for agent dApps too: a stale read makes the policy guard's simulation fail closed, which blocks a valid transaction. Load-balanced RPCs can also report a stale nonce right after a mined transaction ("replacement transaction underpriced"). Create agent accounts with viem's `nonceManager` (`privateKeyToAccount(key, { nonceManager })`) so nonces are tracked locally, as the e2e does. Error text in e2e reports has RPC URLs and API keys redacted, so the reports are safe to commit.

Each run writes `apps/testnet-e2e/reports/<network>-<time>.md` and `.json`, with explorer links. **Commit the reports**: they're your public evidence, and they're what testers compare their own runs against.

## 4. Publish the results and collect feedback

```bash
git add packages/contracts/deployments packages/contracts/src/deployments.ts packages/contracts/sui apps/testnet-e2e/reports
git commit -m "Testnet deployments + e2e reports" && git push
```

- Fill in the "Testnet deployments" table in the root README (`pnpm --filter @codkit/contracts deployments` generates it).
- Ask testers to run `pnpm e2e:evm` / `pnpm e2e:sui` against your deployments with their own wallets, and to file results with the **Testnet feedback** issue template. Their reports are independent confirmation.

## Costs per e2e run

**Base Sepolia:** about 0.0005 ETH in gas. The USDC goes from the agent to the provider and back, except the 0.001 USDC x402 payment, which is also returned. **Sui:** about 0.02 SUI in gas. All testnet funds, so no real cost.
