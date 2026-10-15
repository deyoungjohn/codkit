# Hackathon Kit — project brief

## Goal
A reusable, open-source toolkit of the "plumbing" modules that keep recurring among 2026 Web3 / AI hackathon winners. It is wired into each new hackathon project so build time goes to the idea, the sponsor integration, and the demo — the things judges actually score.

## Evidence (from a study of 57 hackathons / 271 rewarded projects, Jan–Oct 2026)
- Dominant winning archetype: an AI agent that takes a real onchain/financial action, bounded by policy, paid in stablecoins/x402, leaving verifiable receipts. 90 of 214 described winners are agent projects across 32 of 57 events; 64 of them use at least one module below.
- Judging criteria (55 events): working product 75%, originality 64%, real-world usefulness 58%, UX 44%, demo/docs 38%, sponsor-tech depth 35%, business case 33%.
- Every assessed winner (131) made the sponsor's tech load-bearing → the chain/sponsor layer must stay thin adapters; the event-specific integration is always built fresh.
- Only 9% of winners had verified pre-event commits. Rules: 5 events banned existing projects, 10 allowed conditionally, 15 required original work. → The kit MUST be public and open-source before use, and disclosed in submissions as a dependency.
- Same product winning multiple side tracks happened 4 times (StableCorp, Bento, buddy., Bundie).
- Dataset bias: 26 of 57 events were Superteam/Solana.

## Modules, in build order
1. **policy** — chain-agnostic guardrail engine: spend caps (per-tx, per-period, total), allow/deny lists (addresses, programs, methods), human-approval threshold, mandatory simulate/dry-run before execution, kill switch. Pure TS core + adapters.
2. **pay** — x402 server middleware (Express/Hono, FastAPI, MCP tool calls) + budget-aware x402 client; USDC transfers; payment links / QR; webhooks.
3. **contracts** — escrow (create → fund → deliver → release/refund) + simple reputation counter, in Solidity (Foundry), Anchor, Sui Move.
4. **receipts** — hash-chained, signed action log; anchor root onchain (EVM event / Solana memo / Sui) or Walrus/IPFS; explorer links.
5. **mcp** — MCP server scaffold exposing kit tools + Claude tool-calling loop with Zod schemas; WebMCP variant.
6. **demo-shell** — Next.js dashboard: wallet connect, live tx feed with explorer links, agent reasoning trace, policy decisions (allowed/blocked). Plus submission kit: README template, architecture diagram, demo-video script, deployed-contracts table.

Later / maybe: agent wallets & session keys (ERC-4337, Solana session keys), identity (ERC-8004, ENS/SNS), multi-agent orchestration. Skip: ZK/privacy, gaming, RWA (too sponsor-specific).

## Stack
- pnpm + Turborepo monorepo, TypeScript strict, Zod, Vitest.
- Chains: viem (EVM), @solana/kit + Anchor (Solana), @mysten/sui (Sui) — adapters only.
- Frontend: Next.js + Tailwind. Backend: Node (Hono/Express); optional Python FastAPI sidecar for AI-heavy work.
- AI: Anthropic SDK, MCP TypeScript SDK.
- Licence: MIT. Publish to GitHub (public) early.

## Principles
- Each module usable on its own; no module imports a chain SDK in its core.
- Every module ships with tests and a runnable example.
- Never commit keys. Testnet/devnet only in examples; deployments are run by the human.
- Keep wrappers thin — sponsor SDKs (x402, ERC-8004, agent kits) change monthly.

## First task
Scaffold the monorepo, then build `packages/policy` (core + EVM adapter + tests), then `packages/pay` (x402 middleware + client).
