# Progress

The running record of what has changed in codkit, why, and how it was checked. **Add an entry for every change, in the same commit as the change** (rule in [CLAUDE.md](CLAUDE.md)). Newest first. Say what could _not_ be verified as plainly as what could.

Provenance: entries before 2026-10-29 were reconstructed from git history and the earlier session transcripts, not recalled. From 2026-10-29 on they come from the working sessions. Short hashes are commits on `main`.

## Status (2026-11-24)

| Track / phase                                                          | State                                    | Published                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Agent modules: policy, pay, contracts, receipts, mcp, feed, demo-shell | Built, tested, e2e on testnets           | policy 0.1.1 · pay 0.1.2 · contracts 0.1.3 · receipts 0.1.1 · mcp 0.2.2 · feed 0.1.1 |
| dapp toolkit, Phase 0 (wallet-kit decision, VERSIONS.md)               | Done                                     |                                                                                      |
| Phase 1 (tsup + Biome, `@codkit/config`)                               | Done                                     | config 0.1.2                                                                         |
| Phase 2 (`@codkit/wallet`, `@codkit/ui`, Vite + Next examples)         | Done; owner has tested with real wallets | wallet 0.1.2 · ui 0.1.3                                                              |
| Phase 3 (contracts usable from other repos, deployments in config)     | Done; codegen intentionally not wrapped  |                                                                                      |
| Phase 4 (`@codkit/agent-tools`)                                        | **In progress**                          |                                                                                      |
| Phase 5 (`create-app` + templates)                                     | Not started                              |                                                                                      |

All nine packages publish through GitHub Actions Trusted Publishing (set up 2026-11-19). Nothing has been deployed to a mainnet.

**Waiting on the owner:** phone check of the "Open in …" deep links (MetaMask's encoding is the unverified one); a WalletConnect project ID if they want it on in the examples; the Trust Wallet link report (could not be reproduced). Backlog that isn't Phase 4/5 lives in [TODO.md](TODO.md).

## Log

### 2026-11-24 — Phase 4, slice 1: the agent tools on EVM, in the AI SDK and MCP

- **Design recorded first** ([decision 0002](docs/decisions/0002-agent-tools.md)) after checking the facts HANDOFF assumed. Three of them were wrong: LI.FI has **no routes on Base Sepolia** (HTTP 404 "No available quotes", swap and bridge); Jupiter is **mainnet only**; `@coinbase/agentkit` is **35 dependencies / 825 MB**, pins `@solana/kit` 2.3 and **fails to import on Node 22 here**, so it isn't used. What does work on a testnet: **Uniswap v3 on Base Sepolia** (WETH/USDC pools at all four fee tiers, non-zero liquidity), so the testnet swap check will use it. LI.FI and Jupiter ship as providers (quotes are read-only and safe); they are never executed on mainnet by codkit's tests.
- **`@codkit/mcp/ai-sdk`** (new export, `toAiSdkTools`): any kit tool as a Vercel AI SDK tool. Written against `ai` 7.0.180, whose API differs from older majors (`isStepCount`, built-in `toolApproval`). Tested with the real SDK against a scripted OpenAI-compatible server: tool call, bigint-safe results, a thrown tool error reaching the model, and invalid input never executing.
- **`@codkit/agent-tools`** (new, **private until it's complete**, so the release job skips it): `get_balance`, `transfer`, `quote_swap`, `swap` over `@codkit/mcp`'s tool type. Every fund-moving call goes through three gates in order: the operator's per-call cap (`maxPerCall`, per asset; an asset with no cap can't be moved; the model's `maxSpend` can only tighten it), dry run (operator-forced or model-requested; the model can't switch off the operator's), then `@codkit/policy` (caps, lists, approval, mandatory simulation, kill switch). EVM adapter on viem: balances, native and ERC-20 transfers, swaps with an exact-amount approval counted as one policy unit (not 2× the spend), best-of-providers quotes, and a reverted transaction throws so the engine releases the reserved spend.
- **Verified:** 25 tests against a real local Anvil (23 on the tools, 2 proving the same tools run through the AI SDK and through a real MCP client/server pair). Mutation check: removing the cap check, ignoring the operator's dry run, or ignoring the model's `maxSpend` each made the right tests fail (4, 1 and 1).
- **Not yet:** Uniswap v3 and LI.FI providers, Solana, Jupiter, the live Base Sepolia / devnet checks, examples, README.

### 2026-11-24 — PROGRESS.md; Phase 4 starts

- Added this file and the rule that keeps it current ([CLAUDE.md](CLAUDE.md)). Reconstructed the entries below from `git log` (70 commits, 7 release PRs) and session history.
- Phase 4 (`@codkit/agent-tools`) begun; see the entry above.

### 2026-11-24 — Picker: suggestions only below 3 wallets, no scrollbar · `daac9ee` `624e468`

- Owner: "Get a wallet" only when fewer than 3 wallets are detected, and the list should never need a scrollbar. `suggestBelow` prop (default 3). The fixed row cap (`--ck-visible-options`) is gone; the dialog is a flex column and the list is the one shrinkable part, so it scrolls only when the window is too short.
- Checked in the owner's own Chrome through the Claude-in-Chrome extension: 11 EVM and 10 Solana wallets, no scrollbar, dialog inside a 784px window.
- Found while testing: a browser with no wallet still listed a generic "Injected" connect option (wagmi's connector, listed even without `window.ethereum`). `@codkit/wallet` now lists it only when `window.ethereum` exists and nothing announced itself.
- New real-browser layout check `e2e:picker` (6 scenarios, in CI).
- **Trust Wallet install link:** owner reported it didn't load on click but did via Google. Not reproduced: HTTP 200 for four request-header variants, identical in headless Chromium, and it loaded fully from the picker in the owner's Chrome. Trust's page throws its own script error on load (`TenantFeatures`). Left unchanged; owner to report what they see if it recurs.
- **Mistake:** `git add -A` committed `examples/dapp-next/AGENTS.md`, which `next dev` generates (agent instructions that ask to be committed). Removed and git-ignored in the next commit; its instructions were not followed. Lesson: read the untracked list before staging.
- Also checked: SSR/hydration of the wallet list in Next dev mode shows no mismatch warnings.

### 2026-11-24 — Environment questions (no repo change)

- `modern-web-guidance` (Google, global npm package): its CLI runs from WSL (`search`, `retrieve`, `list`, `legacy-scan`); the owner later registered the skill (it now appears in the session skill list). Not needed for backend/tooling work.
- Chrome DevTools MCP plugin: not installed. The Claude-in-Chrome extension already covers click/scroll/navigate/console/network in the owner's real Chrome; DevTools MCP's extra value is performance traces, source-mapped console stacks and a11y/memory skills. It collects usage statistics by default and officially supports only Chrome / Chrome for Testing (none on the WSL PATH).

### 2026-11-20 — Picker closes on connect, fits 10 wallets, suggests uninstalled wallets · `966006c` `64f785d` `7e22118`

- Owner feedback: the picker should close after connecting and show 10 wallets without a scrollbar. It now closes on success and reopens on the first ecosystem not yet connected.
- The Vite example had been resolving `@codkit/*` to built `dist`, so "the picker doesn't close" was a stale build. Its dev server now serves workspace source (the Next example still uses `dist`).
- "Get a wallet" section with official install links (desktop) and "Open in …" deep links (phones), only from links found on each wallet's own site or docs: MetaMask, Coinbase Wallet, Trust Wallet, Rabby (EVM); Phantom, Solflare, Backpack (Solana); open-in-app for MetaMask, Phantom, Solflare, Backpack. OKX left out (docs unreadable; no documented deep link in its GitHub). Chrome Web Store links skipped (consent gate; a spoofed-cookie fetch was blocked, correctly). Not tested on a real phone.
- Owner decided: **no codkit codegen wrapper**. Phase 5 templates will wire `@wagmi/cli`, Codama and `@mysten/codegen` behind `pnpm codegen`.
- HOT Wallet signing now works (owner retested). OKX has no dapp-side fix for reconnecting the same account: it ignores `wallet_revokePermissions` and `wallet_requestPermissions`; the picker explains the workaround.

### 2026-11-19 — Phase 3, release plumbing, real-wallet fixes · `b36e228` `d30fa61` `2cb023f` `d9de8d9` `2bf2823` `edc9e84` `d527ce9`

- **Phase 3:** a root `foundry.toml` makes `forge install deyoungjohn/codkit` remap `codkit/` to the Solidity sources; `kit_escrow` works as a cargo git dependency (cpi feature); the Move package works as a git dependency with `subdir`, linking to the published testnet package. `DeploymentRecorder.sol` writes `deployments/<chainId>.json`; `@codkit/config` gained `parseDeployment` / `findDeployment` / `contractAddress`; codkit's own records carry `chain` + `contracts`. `scripts/consumer-check.mjs` builds a throwaway consumer per ecosystem and runs in CI. (A first CI run failed on a record-count assertion that counted git-ignored local files; fixed.)
- **Releases:** the owner published `wallet` and `ui` by hand and ran the `npm trust github` loop. Earlier `npm publish` instructions from me were wrong (it leaves `workspace:^` ranges); corrected to `pnpm publish`. A dirty `forge-std` submodule (my repo-wide Biome reformat had reformatted its YAML) blocked pnpm's git check; restored. The release after the merge published 7 versions with provenance. `pnpm smoke:npm` installs every package from the registry and loads all 37 entry points as ESM and CJS.
- **Real-wallet fixes** (owner tested OKX, HOT, Phantom and others): errors are `WalletError`s with plain messages instead of raw viem text; EVM signing retries plain-text `personal_sign` for wallets that refuse hex; `disconnect()` asks the wallet to revoke the site and reports when it couldn't (`lastDisconnect`); one dialog with a tab per ecosystem replaced the stretched two-section list.
- Biome had been rewriting `.changeset` frontmatter into invalid YAML; excluded.

### 2026-11-17 — Handoff received: Phases 0–2 · `86a2e09` `a1fc1c2` `560456b` `63c3a27` `812ef59` `90a361c` `7b3245a` `442f78d`

- Owner's `HANDOFF.md` (a plan for a dapp toolkit) integrated into codkit instead of a new repo. Decisions: EVM + Solana first (Sui later), Next.js and Vite templates, tsup + Biome for every package, handoff merged into `CLAUDE.md` and moved to `docs/`.
- **Phase 0:** same connect flow bundled per wallet kit. wagmi 3 + Wallet Standard 41 KB gzipped (chosen); ConnectorKit 393 KB; `@dzapio/wallet` and `@sodax/wallet-sdk-react` over 2 MB each and not browser-clean without Node polyfills; TrustConnect packages are empty `0.0.0` placeholders; WalletConnect adds ~535 KB so it's opt-in. Decision 0001, `VERSIONS.md`. TypeScript stays on 5.9 (tsup's type build doesn't support 7).
- **Phase 1:** all six packages moved from tsc to tsup (ESM + CJS, entries derived from the `exports` map; all 30 entry points loaded both ways; packed tarball typechecks under nodenext and bundler); Biome lint and format in CI (reformat commit hidden from `git blame`); Next 16.4.0 → 16.4.6 (published advisory). `@codkit/config`: 21 EVM chains (generated from viem), Solana, Sui; RPC fallbacks (`<KEY>_RPC_URL` → Helius/Alchemy → public); env schema; viem transport. Sui public fullnodes no longer serve JSON-RPC (gRPC/GraphQL only), so Sui entries carry `graphqlUrl`. Alchemy has no Scroll Sepolia endpoint.
- **Phase 2** (landed 2026-11-19, `7b3245a`): `@codkit/wallet` (one `useWallet()`, adapters for EVM over wagmi and Solana over the Wallet Standard with `@solana/kit`) and `@codkit/ui`. Examples `dapp-vite` and `dapp-next`; headless-Chromium e2e with injected test wallets (keys stay in Node), run in CI. With `--testnet` it sent real self-transfers through the UI: [Base Sepolia](https://sepolia.basescan.org/tx/0xa8c6ebc02d0e282b8f5838062ebac5fdd2f87cb9df4dad9958e044acdb313b41) and [Solana devnet](https://explorer.solana.com/tx/46PynzQnboLJ1fELUDnrLPfWphjXMhGwAzdspVGtgmFxrSNpXcNcz7epRZ4oEj21McMQLBD41rJnb9XNpmGog3t?cluster=devnet).
- **Mistake caught:** `pnpm add` of a package newer than the 1-day release-age policy silently adds `minimumReleaseAgeExclude` entries; one (viem 2.58.0) had been committed. Removed, and dependencies re-resolved within policy. `pnpm update -r` narrowed published ranges, so it was reverted.
- Releases kept failing with `ENEEDAUTH` because Trusted Publishing wasn't set up for most packages: the 2026-11-05 run failed at `pay` (only `mcp` 0.2.1 went out) and the 2026-11-17 run at `policy`. The owner fixed it on 2026-11-19.

### 2026-11-05 — Version Packages #2 merged · `0753e89`

- Released `@codkit/mcp` 0.2.1; `@codkit/pay` 0.1.1 failed to publish (`ENEEDAUTH`). Not noticed until 2026-11-17.

### 2026-10-29 — Backlog work on `pay` and the agent loop; first live LLM run · `e0a0252` `4918fc9` `ab5c2f5` `120ecf9` `76d034b` `5ea0fec` `1c37660`

- Project memory (this tool's, outside the repo) had been wiped by the owner's cleanup; rebuilt from the earlier transcripts.
- **Paid MCP tools:** `@codkit/pay/mcp` (`mcpPaywall`, `withPaidTools`) over `@x402/mcp`; `createMcpServer({ wrapHandler })`. **Solana x402:** `@codkit/pay/svm`; `paywall()` now merges schemes per network family. **Payment links, QR codes, signed webhooks:** `@codkit/pay/links`, `/webhooks`.
- **Agent loop:** `requestTimeoutMs` (default 60 s) with immediate failover (Gemini `gemini-3.8-flash` hung for 90 s+); Gemini preset updated (`gemini-2.5-flash` retired). First live run of `example:agent`: Gemini 3.5 Flash checked the budget, bought two $0.01 prices, declined the $2 report with a receipted reason, failed over to Groq on a free-tier 429; the receipt log verifies. Owner permitted the `GEMINI_MODEL` edit in `.env`.
- **Live x402 on Solana devnet** (`pnpm e2e:x402-solana`, 8/8 through the public facilitator): an HTTP payment and a paid MCP tool call settled onchain; a $0.50 purchase was blocked by policy before signing. The owner funded the e2e agent `Bc8M…nN38` with devnet USDC.

### 2026-10-16 — Releases, dashboard, auth · `43f595d` `75dd184` `adb8742` `6193553` `0d1f77d` `7618a04` `3043ae2`

- Automated releases (Changesets + npm Trusted Publishing, `docs/RELEASING.md`). Dashboard redesigned from the owner's reference image. Auth for the dashboard (password + session) and the MCP HTTP endpoint (bearer tokens; the handler refuses to start without an auth decision).
- Solana devnet e2e 10/10. `@codkit/contracts` 0.1.1 (review fixes, Solana client, new deployments) published by the owner.

### 2026-10-15 — Everything else: modules 1–6, testnets, npm · `4e969e4` … `0ec9f9e`

- Built in order: policy + pay, contracts (EVM, Sui, then Anchor), receipts, mcp, feed + demo-shell + submission kit, with tests. Renamed to `codkit` / `@codkit/*`.
- Owner forbade the Anthropic API; the first agent loop (on the Anthropic SDK) was replaced with a provider-neutral OpenAI-compatible loop (Groq, Gemini, NVIDIA NIM, OpenRouter, AgentRouter).
- Testnet deploys run by the owner from their own wallets: Base Sepolia (e2e 12/12), Sui testnet (one publish used the wrong wallet and was redone with an `--expect-address` guard), Solana devnet. Security review of the escrows (`docs/security/escrow-review.md`) with fixes on all three chains; not an independent audit.
- All six packages published to npm at 0.1.0 by the owner.
