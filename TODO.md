# Remaining tasks

Status as of 2026-10-15. Modules 1 to 6 are built, tested and pushed. CI is green: Node and Foundry tests in one job, Move tests in the other. Everything below is what's left. It's split into tasks only you can do, and work I (or you) can do next.

## 1. Needs you: accounts, keys, funds

### npm publishing

1. ~~Create the npm org~~ Done: `codkit` exists. All packages are named `@codkit/*`.
2. Turn on 2FA on your npm user account (npmjs.com → Account → Two-Factor Authentication), and in the `codkit` org settings require 2FA for members. Prefer **Trusted Publishing** from GitHub Actions over long-lived npm tokens.
3. ~~Publish~~ Done: all six packages are on npm at 0.1.0 (2026-10-15). I verified them by installing from the registry into a clean project: all 25 entry points import and typecheck. A published version can't be changed, so fix forward (0.1.1) or `npm deprecate`.
4. Automated releases are set up (Changesets plus Trusted Publishing; see [docs/RELEASING.md](docs/RELEASING.md)). **You still need to** run the one-time `npm trust github …` loop from that doc. Until then the release job can open Version PRs, but it can't publish.

### LLM keys (no Anthropic API: free tiers only)

The agent loop (`@codkit/mcp/agent`) works with any OpenAI-compatible provider. **First live run done (2026-10-29):** `example:agent` with Gemini (`gemini-3.5-flash`), which failed over to Groq on a mid-run 429. The model called `policy_status` first, bought the two $0.01 prices, declined the $2 report with a receipted rationale, and the receipt log verifies.

- `gemini-3.8-flash` and the `gemini-flash-latest` alias hung for 90 s+ on 2026-10-29, so `.env` now uses `GEMINI_MODEL=gemini-3.5-flash,gemini-flash-lite-latest`. Hung requests time out after 60 s (`requestTimeoutMs`) and fail over.
- The Gemini free tier ran out of quota after about 5 turns; Groq covered the rest.
- Before relying on AgentRouter, confirm that it accepts generic API clients and not just Claude Code or Codex, and remember that it sees every prompt.

```bash
pnpm --filter @codkit/mcp example:models          # which models your keys can use
pnpm --filter @codkit/mcp example:agent           # the LLM buys data within budget
pnpm --filter demo-shell dev                      # the dashboard switches to "LLM live"
```

### Testnet funds and deployments

**Base Sepolia contracts are deployed and verified (2026-10-15).** The addresses are in the root README. `pnpm e2e:evm --network base-sepolia` passes 12/12 (2026-10-15; reports committed). The Sui package is published to testnet and `pnpm e2e:sui --network testnet` passes with a dedicated agent key, `SUI_PRIVATE_KEY` (2026-10-15). Testnet deployment is complete. The full runbook is in [docs/TESTNET.md](docs/TESTNET.md). In short: `pnpm deploy:evm --network base-sepolia --account deployer --verify`, then `pnpm deploy:sui --network testnet`, then `pnpm e2e:evm --network base-sepolia` and `pnpm e2e:sui --network testnet`, and commit the deployments and reports. The steps below are the older manual equivalents.


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

- [x] **Anchor escrow + reputation** (Solana): `packages/contracts/solana`. It has 16 LiteSVM tests on the SBPF v3 binary and runs in CI (2026-10-15).
- [x] Solana program deployed to devnet by `FvWq…zMow`, the upgrade authority (2026-10-15). The IDL is on-chain, and the binary matches the tested build (SHA-256).
- [x] TypeScript client (`@codkit/contracts/solana`) and `pnpm e2e:solana`: passes 10/10 on devnet (2026-10-16). The agent is `~/.config/solana/codkit-agent.json`, separate from the deployer.
- [x] EVM redeployed with the security-review fixes (Base Sepolia, 2026-10-15). `e2e:evm` passes 12/12.
- [x] Sui republished with the fixes (package `0x9bc0…3944`, 2026-10-15). `e2e:sui` passes.
- [x] `@codkit/contracts` 0.1.1 published (2026-10-16): the review fixes, the Solana client and the current deployments. Verified by installing it from npm.
- [ ] Sui policy adapter (`@codkit/policy/sui`): Sui tx → `Action`, plus a dry-run via `simulateTransaction`. Today only the `suiEscrowCreateAction` helper exists.
- [x] Security review of the EVM, Sui and Solana escrows: [docs/security/escrow-review.md](docs/security/escrow-review.md) (2026-10-15). All fixes applied. An independent audit is still needed before mainnet.

### pay (rest of module 2)

- [x] x402 for **MCP tool calls** (2026-10-29): `@codkit/pay/mcp` (`mcpPaywall`, `withPaidTools`) over `@x402/mcp`; `createMcpServer({ wrapHandler })`. Tested in-process; not yet against a live facilitator.
- [ ] FastAPI middleware (a Python sidecar).
- [x] Payment links (EIP-681 / Solana Pay), SVG QR codes, `usdcTransferTx` for the EVM guard, and signed webhooks with retries (2026-10-29): `@codkit/pay/links`, `@codkit/pay/webhooks`.
- [ ] Detect payment to a Solana Pay link onchain (`reference` lookup via `getSignaturesForAddress`).
- [x] Solana x402 (2026-10-29): `@codkit/pay/svm` (`svmSchemes`, `ExactSvmScheme`). Tested against a stub RPC and facilitator. **Live devnet run needs you:** devnet USDC for the e2e agent `Bc8MUG6gkGGie7fYftZpZNHBCPnLiV3r1hkhUNALnN38` from https://faucet.circle.com (Solana devnet).

### receipts

- [x] Solana memo anchor live-tested on devnet by `e2e:solana`: the memo is read back from the chain and verified.
- [ ] An IPFS uploader (Pinata or web3.storage) next to the Walrus one.
- [ ] Persistent anchoring on a schedule (for example, every N receipts).

### mcp

- [ ] Test WebMCP in a real browser (Chrome flag or the `@mcp-b/global` polyfill). Today it's tested with a fake `modelContext` only.
- [x] Auth for `mcpHttpHandler` (2026-10-16): required; bearer tokens, or a `verify` hook for OAuth/JWT with RFC 9728 metadata. The dashboard exposes `/api/mcp` behind `MCP_TOKEN`.

### demo-shell

- [x] **Auth** (2026-10-16): operator password, signed session cookie, a check in `proxy.ts` plus a check in every route, a same-origin check, and login throttling. See `apps/demo-shell/README.md#auth`.
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
