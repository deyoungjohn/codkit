# codkit

**Open-source building blocks for AI agents that move money onchain, safely.**

codkit gives you the parts every "AI agent + crypto" project ends up rebuilding: spending guardrails, stablecoin payments, escrow, verifiable activity logs, LLM tool calling and a live dashboard. Each part is a small, independent TypeScript package. Use one, or wire them all together, and spend your time on the product instead.

![The codkit demo dashboard: an agent's reasoning, policy decisions and transactions in real time](docs/demo-shell.png)

## Why

The agent projects that work in practice tend to share one shape: an **AI agent takes a real financial action, inside limits a human set, pays in stablecoins, and leaves a trail anyone can verify.** The hard part is rarely the idea. It's the plumbing around it:

- How do you stop an agent from overspending, or from sending funds somewhere it shouldn't?
- How does it pay for an API, or get paid, per request?
- How do two parties trade without trusting each other?
- How does anyone check afterwards what the agent actually did?

codkit answers each of these with a tested module, so a new project starts from a working skeleton.

## What's inside

| Package | What it gives you |
| --- | --- |
| [`@codkit/policy`](packages/policy) | **Guardrails.** Spend caps (per transaction, per period, total), allow and deny lists, a human-approval threshold, a mandatory simulation before anything is signed, and a kill switch. Chain-agnostic, with an EVM adapter. |
| [`@codkit/pay`](packages/pay) | **Payments.** [x402](https://x402.org) paywall middleware for Hono and Express, plus a client that pays for HTTP requests in USDC within the policy budget. |
| [`@codkit/contracts`](packages/contracts) | **Escrow and reputation.** Create → fund → deliver → release or refund, with a reputation counter. Solidity (Foundry), Sui Move and Solana (Anchor), with TypeScript bindings for EVM and Sui. |
| [`@codkit/receipts`](packages/receipts) | **A verifiable log.** Every decision and action goes into a hash-chained, signed log. Its head is anchored onchain (EVM, Solana or Sui) and the full log can go to Walrus, so anyone can check it. |
| [`@codkit/mcp`](packages/mcp) | **Agent tools.** Define a tool once with Zod, then serve it over MCP, run it in a tool-calling loop on any OpenAI-compatible LLM (Groq, Gemini, NVIDIA NIM, OpenRouter, a local model…), or expose it in the browser via WebMCP. |
| [`@codkit/feed`](packages/feed) | **Live events.** A server-sent event stream of the agent's reasoning, tool calls, policy decisions, transactions and receipts, plus a human-approval broker. |
| [`demo-shell`](apps/demo-shell) | **A dashboard.** Next.js app showing everything above in real time, with approve/deny buttons and a kill switch. Runs with no keys in demo mode. |
| [`templates/submission`](templates/submission) | **Presentation kit.** README template, architecture diagram, demo-video script and checklist for shipping a project built on codkit. |

Every package works on its own. The cores import no blockchain SDK; chain and sponsor specifics live in thin adapters, because those SDKs change constantly.

## A taste

An agent's wallet, bounded by policy. It can't exceed 5 USDC per payment or 20 per day, payments over 3 USDC wait for a human, and every transaction is simulated before signing:

```ts
import { createPolicyEngine, usdc } from "@codkit/policy";
import { createEvmGuard } from "@codkit/policy/evm";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia

const engine = createPolicyEngine({
  policy: {
    chains: ["eip155:84532"],
    limits: [{ asset: USDC, perTx: usdc(5), perPeriod: { amount: usdc(20), seconds: 86_400 }, approvalAbove: usdc(3) }],
  },
  approver: askAHuman, // e.g. a dashboard button or a Telegram message
});

const wallet = createEvmGuard({ engine, chainId: 84532, account: account.address, reader: publicClient, sender: walletClient });
await wallet.send(tx); // allowed, sent for approval, or refused with a reason, before anything is signed
```

Hand the same guarded wallet to an LLM as tools, and the model can only act within those limits, however it's prompted.

## Proven on testnet

The contracts are deployed on **Base Sepolia** (source-verified), **Sui testnet** and **Solana devnet**, all with the [security review](docs/security/escrow-review.md) fixes. An end-to-end check runs the full flow against the EVM and Sui deployments with real transactions:

- **Base Sepolia, 12/12** ([report](apps/testnet-e2e/reports/base-sepolia-2026-10-15T22-24-11-266Z.md)): escrow create, fund, deliver and release; a reputation update; three guardrail refusals (over the cap, an unlisted contract, a failing simulation); an x402 payment settled through the public facilitator; and the receipt log anchored and verified onchain.
- **Sui testnet** ([report](apps/testnet-e2e/reports/sui-testnet-2026-10-15T22-46-02-058Z.md)): a policy check, the full escrow lifecycle, and the receipt log anchored via `kit_escrow::anchor` and verified.

| Contract | Network | Address | Deploy tx |
| --- | --- | --- | --- |
| Reputation | Base Sepolia (84532) | [`0x62d9258d0707e29650a8300a716312fb976557a2`](https://sepolia.basescan.org/address/0x62d9258d0707e29650a8300a716312fb976557a2) | [0x5f390e50…](https://sepolia.basescan.org/tx/0x5f390e50b7fd8f9673696349be484dd52f2ccf524bdf1606ac10d2575e5189e4) |
| Escrow | Base Sepolia (84532) | [`0xb32ea9219afc9ba5e77db9fd414d5a4a8746c023`](https://sepolia.basescan.org/address/0xb32ea9219afc9ba5e77db9fd414d5a4a8746c023) | [0x45c95da0…](https://sepolia.basescan.org/tx/0x45c95da052ed63c024c4924d347d25aeb74ed7106140abed3aab15a3fca4a8d7) |
| ReceiptAnchor | Base Sepolia (84532) | [`0x308023e44fe2e0411b515272fda9049af7330828`](https://sepolia.basescan.org/address/0x308023e44fe2e0411b515272fda9049af7330828) | [0xa4ca19c5…](https://sepolia.basescan.org/tx/0xa4ca19c5c7b8142c7903112577f4fc1cdd42f94f262db7f2e2ea3bf5feabf450) |
| kit_escrow package | Sui testnet | [`0x9bc025aaff8b63103a4cea136304c11267af7816e0ae2b8eeeb51bea99293944`](https://suiscan.xyz/testnet/object/0x9bc025aaff8b63103a4cea136304c11267af7816e0ae2b8eeeb51bea99293944) | [G1Rf7icqRK…](https://suiscan.xyz/testnet/tx/G1Rf7icqRKhMXPo5rCn5pUQrR7NKTCJb3nvohFGCLMDm) |
| Reputation (shared object) | Sui testnet | [`0xa03b50fe14f685602811348b86a378651aca3e674abd78229287222b5df80aa8`](https://suiscan.xyz/testnet/object/0xa03b50fe14f685602811348b86a378651aca3e674abd78229287222b5df80aa8) | [G1Rf7icqRK…](https://suiscan.xyz/testnet/tx/G1Rf7icqRKhMXPo5rCn5pUQrR7NKTCJb3nvohFGCLMDm) |
| kit_escrow program | Solana devnet | [`8kQBzMWRWAEssN4wtBzrH4G8fHtbhrbHs9e24V2jWMkX`](https://explorer.solana.com/address/8kQBzMWRWAEssN4wtBzrH4G8fHtbhrbHs9e24V2jWMkX?cluster=devnet) | [TYneZ6tPZu…](https://explorer.solana.com/tx/TYneZ6tPZuxAumyyiUg4uvLLkwuTpNQGass2FbnKbYTgGQ2BhJPhS29hNW3sQQdDrb1NDxiC4vkP3meJzRbRYPE?cluster=devnet) |

The Solana program is byte-for-byte the SBPF v3 binary its 16 LiteSVM tests run against (SHA-256 checked against the on-chain program); its end-to-end check is next.

The addresses are also exported as `deployments` from `@codkit/contracts`. Want to reproduce the run with your own wallet? [docs/TESTNET.md](docs/TESTNET.md) explains how, and you can report results with a [Testnet feedback](https://github.com/deyoungjohn/codkit/issues/new?template=testnet-feedback.yml) issue.

## Install

The packages are on npm under [`@codkit`](https://www.npmjs.com/org/codkit). They need Node 22+. Install only the ones you need:

```bash
npm install @codkit/policy                    # guardrails
npm install @codkit/pay @codkit/policy        # x402 payments
npm install @codkit/receipts                  # verifiable log
npm install @codkit/mcp                       # agent tools and the LLM loop
npm install @codkit/contracts @codkit/feed    # escrow bindings, live event stream
```

Chain SDKs (`viem`, `@mysten/sui`) and server frameworks (`hono`, `express`) are optional peer dependencies, so you only install what your project uses. Each package's README shows the setup.

## See it run

The dashboard lives in this repo:

```bash
git clone --recurse-submodules https://github.com/deyoungjohn/codkit.git
cd codkit && pnpm install && pnpm build
pnpm --filter demo-shell dev        # http://localhost:3000, no keys needed
```

It starts with a scripted agent going through the real policy engine, x402 paywall and receipt log. Add a free LLM key (Groq, Gemini, NVIDIA NIM or OpenRouter) to `.env` and a real model drives it instead; `.env.example` lists the options.

## Using codkit in a hackathon

codkit is public, MIT-licensed and existed before your event. Many hackathons require original work, so list it as a dependency ("built with codkit") in your submission. Judges can then see clearly which parts you built during the event.

## Status

v0.1 ([npm](https://www.npmjs.com/org/codkit)), testnet only. The contracts have had a [security review](docs/security/escrow-review.md) with fuzzing, static analysis and 100% test coverage, but **no independent audit**, so don't use them with real funds. On the roadmap: a Solana devnet deployment with a TypeScript client, more payment rails, persistent storage for the policy engine and logs, and agent wallets with session keys.

Contributions and issues are welcome.

## License

[MIT](LICENSE)
