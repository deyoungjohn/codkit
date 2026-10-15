# Hackathon Kit

Open-source plumbing for Web3 / AI-agent hackathon projects. The kit covers the common pieces so you can spend the weekend on the idea, the sponsor integration, and the demo.

The pattern that keeps winning is an **AI agent that takes a real onchain action, bounded by policy, paid in stablecoins / x402, and leaving verifiable receipts**. This repo provides that skeleton as small, independent modules.

> **Disclosure for submissions:** this kit is a public, MIT-licensed dependency that existed before the event. List it under "dependencies / prior work" so judges can tell your hackathon work from the plumbing.

## Packages

| Package | Status | What it does |
| --- | --- | --- |
| [`@iamyoungjohn-kit/policy`](packages/policy) | ✅ v0.1 | Guardrail engine: spend caps, allow/deny lists, human approval, mandatory simulation, kill switch. Includes an EVM adapter (viem). |
| [`@iamyoungjohn-kit/pay`](packages/pay) | ✅ v0.1 | x402 paywall middleware (Hono / Express) and a budget-aware x402 client bounded by `policy`. |
| [`@iamyoungjohn-kit/contracts`](packages/contracts) | 🟡 EVM + Sui v0.1 | Escrow (create → fund → deliver → release/refund) and reputation in Solidity (Foundry) and Sui Move, with TS bindings. Anchor (Solana) is still to do. |
| `receipts` | planned | Hash-chained, signed action log anchored onchain or on Walrus/IPFS. |
| `mcp` | planned | MCP server exposing kit tools, plus a Claude tool-calling loop. |
| `demo-shell` | planned | Next.js dashboard (wallet, live tx feed, reasoning trace, policy decisions) and a submission kit. |

Each package works on its own, and the core of each package imports no chain SDK. Chain and sponsor code lives in thin adapters, because sponsor SDKs change monthly.

## Develop

```bash
pnpm install
pnpm build       # turbo: builds packages in dependency order
pnpm test
pnpm typecheck
```

Requirements: Node ≥ 22, pnpm, [Foundry](https://getfoundry.sh), and optionally the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) for `contracts`. Clone with `--recurse-submodules`.

## Rules of the repo

- Never commit keys. `.env` is git-ignored, and `.env.example` lists what the examples read.
- Examples use testnet or devnet only. Any deployment or mainnet transaction is run by a human.
- Every package ships with tests and a runnable example.

## License

MIT
