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
| [`@codkit/contracts`](packages/contracts) | **Escrow and reputation.** Create → fund → deliver → release or refund, with a reputation counter. Solidity (Foundry) and Sui Move, with TypeScript bindings. |
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

The contracts are deployed on **Base Sepolia** (source-verified) and **Sui testnet**. An end-to-end check runs the full flow against them with real transactions:

- **Base Sepolia, 12/12** ([report](apps/testnet-e2e/reports/base-sepolia-2026-10-15T15-29-44-296Z.md)): escrow create, fund, deliver and release; a reputation update; three guardrail refusals (over the cap, an unlisted contract, a failing simulation); an x402 payment settled through the public facilitator; and the receipt log anchored and verified onchain.
- **Sui testnet** ([report](apps/testnet-e2e/reports/sui-testnet-2026-10-15T18-03-01-050Z.md)): a policy check, the full escrow lifecycle, and the receipt log anchored via `kit_escrow::anchor` and verified.

| Contract | Network | Address | Deploy tx |
| --- | --- | --- | --- |
| Reputation | Base Sepolia (84532) | [`0x51ac7b594345dfec761f3e9c48b79f80bfab3061`](https://sepolia.basescan.org/address/0x51ac7b594345dfec761f3e9c48b79f80bfab3061) | [0x49934871…](https://sepolia.basescan.org/tx/0x49934871339103a2632b95c99508eeeafbbec7798d680769f4a1f7bea4dee9ad) |
| Escrow | Base Sepolia (84532) | [`0x7934bd7b6e7a3732ac866c6d784244f5ebd79109`](https://sepolia.basescan.org/address/0x7934bd7b6e7a3732ac866c6d784244f5ebd79109) | [0xe79f0939…](https://sepolia.basescan.org/tx/0xe79f0939059ab42fe4261e6f1a706525eaa07128d88dd9f41484302671bb83d7) |
| ReceiptAnchor | Base Sepolia (84532) | [`0xd2c2c972d883f7fe9c61e2624bc87e1e6621f326`](https://sepolia.basescan.org/address/0xd2c2c972d883f7fe9c61e2624bc87e1e6621f326) | [0x88aeead7…](https://sepolia.basescan.org/tx/0x88aeead79cefbb6c51114c20df3fac987991ee7cce497225e93b0e1a1602fca2) |
| kit_escrow package | Sui testnet | [`0xb285fb9fe4181908efd684e62216c436d605c371d761c3db921cfea0bd5b7481`](https://suiscan.xyz/testnet/object/0xb285fb9fe4181908efd684e62216c436d605c371d761c3db921cfea0bd5b7481) | [6jKiWHKT1J…](https://suiscan.xyz/testnet/tx/6jKiWHKT1JGqkqdyCDAqKobDdV5ANWDRJCFFm2aNLssu) |
| Reputation (shared object) | Sui testnet | [`0xb25726d35d2ffbb10a53469e79b920c019c888e8939a41cb54b017ac81f076c8`](https://suiscan.xyz/testnet/object/0xb25726d35d2ffbb10a53469e79b920c019c888e8939a41cb54b017ac81f076c8) | [6jKiWHKT1J…](https://suiscan.xyz/testnet/tx/6jKiWHKT1JGqkqdyCDAqKobDdV5ANWDRJCFFm2aNLssu) |

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

v0.1 ([npm](https://www.npmjs.com/org/codkit)), testnet only. The contracts are **unaudited**: don't use them with real funds. On the roadmap: Solana (Anchor) escrow, more payment rails, persistent storage for the policy engine and logs, and agent wallets with session keys.

Contributions and issues are welcome.

## License

[MIT](LICENSE)
