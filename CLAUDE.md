# codkit — project brief

## Goal

Ship hackathon projects faster by owning the glue code that gets rewritten at every event, so build time goes to the idea, the sponsor integration and the demo, which are what judges score. codkit is a public, open-source monorepo of **packages only**. Each hackathon project lives in its own repo and installs just the `@codkit/*` packages it needs.

Two tracks, in priority order:

1. **dapp toolkit** (current priority; the owner uses it most): config, wallet, ui, create-app. Plan: [docs/HANDOFF.md](docs/HANDOFF.md).
2. **agent modules** (built, maintained): policy, pay, contracts, receipts, mcp, feed, demo-shell.

## Rules

- **No hackathon project code here.** `apps/` holds the demo dashboard and testnet e2e runners; `examples/` holds tiny apps that prove each package installs and works from npm.
- **Don't wrap what installs in one line.** viem, wagmi, @solana/kit, Anchor, Foundry and the Vercel AI SDK are used directly. A package exists only if it saves real setup time or hides vendor churn.
- **Don't rebuild infrastructure.** No custom WalletConnect relay, MPC/embedded wallets, bundlers, paymasters, RPC or indexers.
- **Wallets:** hand-wired wagmi + the Solana Wallet Standard (with `@solana/kit`) behind one `useWallet()`, one adapter file per ecosystem ([decision 0001](docs/decisions/0001-wallet-kit.md)). No Reown AppKit paid tiers; WalletConnect is an opt-in connector, loaded on demand.
- Each package is usable on its own; no package imports a chain SDK in its core (chain code goes in adapters / subpath exports, with chain SDKs as peers).
- Every package ships with tests and a runnable example.
- Never commit keys. Testnet/devnet only in examples; mainnet deployments are run by the human.
- Keep wrappers thin: sponsor SDKs (x402, ERC-8004, agent kits) change monthly. Verify versions and APIs from code, not docs, and record them in [VERSIONS.md](VERSIONS.md).

## dapp toolkit: build plan (from docs/HANDOFF.md)

Chains first: **EVM + Solana**; Sui follows as an adapter. Templates: **Next.js and Vite**.

- Phase 0 ✅: wallet-kit decision ([0001](docs/decisions/0001-wallet-kit.md)), [VERSIONS.md](VERSIONS.md).
- Phase 1 ✅ (config published 0.1.0): move every package to tsup (ESM + CJS + types) and Biome; then `@codkit/config`: a chain registry (id, name, ecosystem, RPC URLs, explorer, native token), a typed env schema (zod), `getRpcUrl(chain)` with a fallback order; first publish.
- Phase 2 ✅ (published 2026-11-19): `@codkit/wallet` (`useWallet()` → `{ ecosystem, address, connect, disconnect, signMessage, sendTransaction, switchChain }`) and `@codkit/ui` (ConnectButton, TokenAmountInput, TxStatusToast, AddressPill, ChainSwitcher; shadcn-style, copy-in or import).
- Phase 3: contracts consumable from other repos: `forge install` + remapping into `packages/contracts/evm/src`, a cargo git dependency, a Move git dependency with `subdir`; deploy JSON readable by `@codkit/config`; Codama / TS client codegen.
- Phase 4: `@codkit/agent-tools` (getBalance, transfer, quoteSwap, swap; AgentKit / LI.FI / Jupiter; Vercel AI SDK + MCP exports; dry-run and per-call caps, reusing `@codkit/policy`). Payments are already `@codkit/pay`.
- Phase 5: `create-app` (`pnpm create @codkit/app`): ecosystem(s), agent y/n, payments y/n → a standalone repo from `templates/`.

## Agent modules (built)

policy (guardrails: caps, allow/deny, approval, simulate, kill switch) · pay (x402 HTTP/MCP/Solana, links/QR, webhooks) · contracts (escrow + reputation on EVM, Solana, Sui) · receipts (hash-chained signed log, onchain anchors) · mcp (tools, MCP server, OpenAI-compatible agent loop, WebMCP) · feed + demo-shell (dashboard). Backlog: TODO.md.

## Evidence (57 hackathons / 271 rewarded projects, Jan–Oct 2026)

- Dominant winning archetype: an AI agent that takes a real onchain/financial action, bounded by policy, paid in stablecoins/x402, leaving verifiable receipts (90 of 214 described winners, across 32 of 57 events).
- Judging criteria (55 events): working product 75%, originality 64%, real-world usefulness 58%, UX 44%, demo/docs 38%, sponsor-tech depth 35%, business case 33%.
- Every assessed winner (131) made the sponsor's tech load-bearing, so the chain/sponsor layer stays thin adapters and the event-specific integration is always built fresh.
- Only 9% of winners had verified pre-event commits; 5 events banned existing projects, 10 allowed them conditionally and 15 required original work. So codkit must be public and open-source before use, and disclosed in submissions as a dependency.
- Dataset bias: 26 of 57 events were Superteam/Solana.

## Stack

- pnpm + Turborepo, TypeScript strict (5.9), tsup, Biome, Zod, Vitest, Changesets, GitHub Actions (Trusted Publishing to npm under `@codkit`).
- Chains: viem/wagmi (EVM), @solana/kit + @solana/react + Anchor (Solana), @mysten/sui (Sui). Contracts: Foundry, Anchor, Sui Move.
- Frontend: Next.js and Vite, Tailwind. Backend: Node (Hono/Express).
- AI: provider-neutral OpenAI-compatible Chat Completions (Groq, Gemini, NVIDIA NIM, OpenRouter, AgentRouter free tiers), MCP TypeScript SDK. Do NOT use the Anthropic API.
- Licence: MIT.
