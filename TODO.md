# Remaining tasks

Status as of 2026-10-15. Modules 1 to 6 are built, tested and pushed. CI is green: Node and Foundry tests in one job, Move tests in the other. Everything below is what's left. It's split into tasks only you can do, and work I (or you) can do next.

## 1. Needs you: accounts, keys, funds

### npm publishing

1. ~~Create the npm org~~ Done: `codkit` exists. All packages are named `@codkit/*`.
2. Turn on 2FA on your npm user account (npmjs.com → Account → Two-Factor Authentication), and in the `codkit` org settings require 2FA for members. Prefer **Trusted Publishing** from GitHub Actions over long-lived npm tokens.
3. Publish:
   ```bash
   npm login
   pnpm -r --filter "./packages/*" publish --access public
   ```
   `pnpm publish` rewrites `workspace:*` dependencies to real versions. `apps/demo-shell` is private and won't be published.
4. Optional: add Changesets plus a CI publish job with npm provenance, so releases aren't manual.

### LLM keys (no Anthropic API: free tiers only)

The agent loop (`@codkit/mcp/agent`) works with any OpenAI-compatible provider. It's tested against a scripted API, so its first real run is still to do. Get one or more free keys: Groq (console.groq.com), Gemini (aistudio.google.com), NVIDIA NIM (build.nvidia.com), OpenRouter (`:free` models), or AgentRouter. Put them in `.env` (see `.env.example`). With two or more set, a rate-limited provider fails over to the next.

```bash
pnpm --filter @codkit/mcp example:models          # which models your keys can use
pnpm --filter @codkit/mcp example:agent           # the LLM buys data within budget
pnpm --filter demo-shell dev                      # the dashboard switches to "LLM live"
```

Check that the model calls `policy_status` before buying, asks for approval on the $0.25 summary, and is blocked on the $2 report. If a default model ID has been retired, set `<PROVIDER>_MODEL` and update the preset in `packages/mcp/src/agent.ts`. Before relying on AgentRouter, confirm that it accepts generic API clients and not just Claude Code or Codex, and remember that it sees every prompt.

### Testnet funds and deployments

**Base Sepolia contracts are deployed and verified (2026-10-15).** The addresses are in the root README. `pnpm e2e:evm --network base-sepolia` passes 12/12 (2026-10-15; reports committed). The Sui package is published to testnet and `pnpm e2e:sui --network testnet` passes (2026-10-15). Testnet deployment is complete. The full runbook is in [docs/TESTNET.md](docs/TESTNET.md). In short: `pnpm deploy:evm --network base-sepolia --account deployer --verify`, then `pnpm deploy:sui --network testnet`, then `pnpm e2e:evm --network base-sepolia` and `pnpm e2e:sui --network testnet`, and commit the deployments and reports. The steps below are the older manual equivalents.


- **Base Sepolia:** get ETH for gas and USDC from https://faucet.circle.com, using a throwaway key.
  ```bash
  cast wallet import dev --interactive
  cd packages/contracts/evm && forge script script/Deploy.s.sol --rpc-url base_sepolia --account dev --broadcast
  pnpm --filter @codkit/contracts deployments   # markdown table for READMEs
  ```
- **x402 on a real testnet** (only tested against an in-process facilitator so far):
  ```bash
  PAY_TO=0x... pnpm --filter @codkit/pay example:server
  EVM_PRIVATE_KEY=0x... pnpm --filter @codkit/pay example:client -- http://localhost:4021/weather
  ```
- **Sui testnet:** `cd packages/contracts/sui && sui client faucet && sui client publish`, then record the package id and the `Reputation` object id.
  - Note: the first `sui` run auto-created `~/.sui/sui_config` with a new testnet keypair. Its recovery phrase went to a scratch log, which I deleted. It holds no funds. Delete that config or replace it with your own key.
- **Walrus testnet** (I didn't upload anything to a public service): `pnpm --filter @codkit/receipts example -- --walrus`

### Solana toolchain (you said later)

Install Rust, the Solana CLI and Anchor (`avm`). Then the Solana items in section 2 can be built and tested.

## 2. Engineering backlog (I can pick these up)

### contracts

- [ ] **Anchor escrow + reputation** (Solana), with the same lifecycle as `Escrow.sol` and `escrow.move`. Needs the toolchain above.
- [ ] Sui policy adapter (`@codkit/policy/sui`): Sui tx → `Action`, plus a dry-run via `simulateTransaction`. Today only the `suiEscrowCreateAction` helper exists.
- [ ] An audit-style review pass on `Escrow.sol` and `escrow.move`. Both are unaudited and testnet-only.

### pay (rest of module 2)

- [ ] x402 for **MCP tool calls**: a paid-tool wrapper so an MCP server can charge per call.
- [ ] FastAPI middleware (a Python sidecar).
- [ ] Plain USDC transfer helpers, payment links and QR codes, and webhooks for settlement events.
- [ ] Solana x402 (`@x402/svm` `ExactSvmScheme`) in `paywall()` and the budgeted client.

### receipts

- [ ] Live-test the Solana memo anchor on devnet. Only the instruction shape is tested today.
- [ ] An IPFS uploader (Pinata or web3.storage) next to the Walrus one.
- [ ] Persistent anchoring on a schedule (for example, every N receipts).

### mcp

- [ ] Test WebMCP in a real browser (Chrome flag or the `@mcp-b/global` polyfill). Today it's tested with a fake `modelContext` only.
- [ ] Auth for `mcpHttpHandler` (bearer token or OAuth).

### demo-shell

- [ ] **Auth.** There's none today. Add it before pointing the dashboard at real funds.
- [ ] Persistence: use `JsonlFileStore` for receipts and a durable `SpendStore`, since state is in-memory today.
- [ ] A hosting decision. The runtime is an in-memory singleton with SSE, so it needs one long-running Node process (Railway, Fly or Render), not serverless functions.
- [ ] Wire a real vendor plus `evmTools` / `escrowTools` with a funded testnet key, so transactions show real explorer links instead of `sim`.

### policy

- [ ] Durable `SpendStore` implementations (SQLite, Redis).
- [ ] USD-denominated caps across assets, using a price feed.

### Later or maybe (from the brief)

- [ ] Agent wallets and session keys (ERC-4337, Solana session keys)
- [ ] Identity (ERC-8004, ENS/SNS)
- [ ] Multi-agent orchestration

## 3. Known limitations, by design for v0.1

- The policy engine, receipt log and feed keep state in memory by default. Plug in a store for anything long-running.
- Policy reservations never expire unless `reservationTtlMs` is set. That's conservative for signed-but-unsettled x402 payments.
- EVM contract calls other than ERC20 transfer/approve expose only their native `value` as spend. Restrict them with `allow.programs` and `allow.methods`.
- The agent loop has no provider SDK. It uses plain Chat Completions over `fetch`. Default free-tier model IDs drift, so override them with env vars.
