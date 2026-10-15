# codkit

Open-source plumbing for Web3 / AI-agent hackathon projects. The kit covers the common pieces so you can spend the weekend on the idea, the sponsor integration, and the demo.

![demo-shell](docs/demo-shell.png)

The pattern that keeps winning is an **AI agent that takes a real onchain action, bounded by policy, paid in stablecoins / x402, and leaving verifiable receipts**. This repo provides that skeleton as small, independent modules.

> **Disclosure for submissions:** this kit is a public, MIT-licensed dependency that existed before the event. List it under "dependencies / prior work" so judges can tell your hackathon work from the plumbing.

## Packages

| Package | Status | What it does |
| --- | --- | --- |
| [`@codkit/policy`](packages/policy) | ✅ v0.1 | Guardrail engine: spend caps, allow/deny lists, human approval, mandatory simulation, kill switch. Includes an EVM adapter (viem). |
| [`@codkit/pay`](packages/pay) | ✅ v0.1 | x402 paywall middleware (Hono / Express) and a budget-aware x402 client bounded by `policy`. |
| [`@codkit/contracts`](packages/contracts) | 🟡 EVM + Sui v0.1 | Escrow (create → fund → deliver → release/refund) and reputation in Solidity (Foundry) and Sui Move, with TS bindings. Anchor (Solana) is still to do. |
| [`@codkit/receipts`](packages/receipts) | ✅ v0.1 | Hash-chained, signed action log. Records policy events automatically, anchors onchain (EVM event or calldata, Solana memo, Sui event), stores the full log on Walrus, and lets anyone verify it. |
| [`@codkit/mcp`](packages/mcp) | ✅ v0.1 | Define tools once with Zod and serve them as an MCP server (stdio or HTTP), an agent loop on any OpenAI-compatible LLM (Groq, Gemini, NIM, OpenRouter…), or WebMCP. Includes kit tools for policy, x402, wallet, escrow and receipts. |
| [`@codkit/feed`](packages/feed) | ✅ v0.1 | Live event stream (SSE) of decisions, approvals, tool calls, reasoning, transactions and receipts, plus a human-approval broker. |
| [`apps/demo-shell`](apps/demo-shell) | ✅ v0.1 | Next.js dashboard: wallet connect, live reasoning trace, allowed/blocked decisions, approve/deny, kill switch, transactions with explorer links, and receipt verification. Runs in demo mode with no keys. |
| [`templates/submission`](templates/submission) | ✅ | Submission README template, architecture diagram, 3-minute demo script, checklist, and a deployed-contracts table generator. |

Each package works on its own, and the core of each package imports no chain SDK. Chain and sponsor code lives in thin adapters, because sponsor SDKs change monthly.

## Testnet deployments

Deployed 2026-10-15 to Base Sepolia (source-verified) and Sui testnet. The EVM `Reputation` owner is the deployer `0xefa0913b8a51359ebdf897a434e2783b1c86001a`. The Sui package was published by `0x0edf9ba9df762186979b58d8caa3b3d37bc9d6035ed79a5a773f664be7d2bc55`, which holds the `UpgradeCap`. The addresses are also exported as `deployments` from `@codkit/contracts`.

End-to-end checks against these deployments:
- **Base Sepolia, 12/12** ([report](apps/testnet-e2e/reports/base-sepolia-2026-10-15T15-29-44-296Z.md)): escrow create, fund, deliver and release; reputation; three guardrail refusals; an x402 payment settled through the public facilitator; and a receipt log anchored onchain.
- **Sui testnet** ([report](apps/testnet-e2e/reports/sui-testnet-2026-10-15T17-27-33-349Z.md)): a policy check, then escrow create, fund, deliver and release, then a receipt log anchored via `kit_escrow::anchor` and verified.

| Contract | Network | Address | Deploy tx |
| --- | --- | --- | --- |
| Reputation | Base Sepolia (84532) | [`0x51ac7b594345dfec761f3e9c48b79f80bfab3061`](https://sepolia.basescan.org/address/0x51ac7b594345dfec761f3e9c48b79f80bfab3061) | [0x49934871…](https://sepolia.basescan.org/tx/0x49934871339103a2632b95c99508eeeafbbec7798d680769f4a1f7bea4dee9ad) |
| Escrow | Base Sepolia (84532) | [`0x7934bd7b6e7a3732ac866c6d784244f5ebd79109`](https://sepolia.basescan.org/address/0x7934bd7b6e7a3732ac866c6d784244f5ebd79109) | [0xe79f0939…](https://sepolia.basescan.org/tx/0xe79f0939059ab42fe4261e6f1a706525eaa07128d88dd9f41484302671bb83d7) |
| ReceiptAnchor | Base Sepolia (84532) | [`0xd2c2c972d883f7fe9c61e2624bc87e1e6621f326`](https://sepolia.basescan.org/address/0xd2c2c972d883f7fe9c61e2624bc87e1e6621f326) | [0x88aeead7…](https://sepolia.basescan.org/tx/0x88aeead79cefbb6c51114c20df3fac987991ee7cce497225e93b0e1a1602fca2) |
| kit_escrow package | Sui testnet | [`0xb285fb9fe4181908efd684e62216c436d605c371d761c3db921cfea0bd5b7481`](https://suiscan.xyz/testnet/object/0xb285fb9fe4181908efd684e62216c436d605c371d761c3db921cfea0bd5b7481) | [6jKiWHKT1J…](https://suiscan.xyz/testnet/tx/6jKiWHKT1JGqkqdyCDAqKobDdV5ANWDRJCFFm2aNLssu) |
| Reputation (shared object) | Sui testnet | [`0xb25726d35d2ffbb10a53469e79b920c019c888e8939a41cb54b017ac81f076c8`](https://suiscan.xyz/testnet/object/0xb25726d35d2ffbb10a53469e79b920c019c888e8939a41cb54b017ac81f076c8) | [6jKiWHKT1J…](https://suiscan.xyz/testnet/tx/6jKiWHKT1JGqkqdyCDAqKobDdV5ANWDRJCFFm2aNLssu) |

Ran it yourself? File a [Testnet feedback](https://github.com/deyoungjohn/codkit/issues/new?template=testnet-feedback.yml) issue.

## Develop

```bash
pnpm install
pnpm build       # turbo: builds packages in dependency order
pnpm test
pnpm typecheck
pnpm --filter demo-shell dev   # dashboard at http://localhost:3000 (demo mode, no keys needed)
```

See [TODO.md](TODO.md) for remaining work and tasks that need accounts/funds.

Requirements: Node ≥ 22, pnpm, [Foundry](https://getfoundry.sh), and optionally the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) for `contracts`. Clone with `--recurse-submodules`.

## Rules of the repo

- Never commit keys. `.env` is git-ignored, and `.env.example` lists what the examples read.
- Examples use testnet or devnet only. Any deployment or mainnet transaction is run by a human.
- Every package ships with tests and a runnable example.

## License

MIT
