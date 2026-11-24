# @codkit/agent-tools

Four tools an AI agent can use to hold and move funds: `get_balance`, `transfer`, `quote_swap`, `swap`. On EVM (viem) and Solana (`@solana/kit`). Every call that moves money passes three gates, in this order:

1. **Per-call cap.** You set `maxPerCall` per asset. An asset with no cap can't be moved at all. The model may pass `maxSpend` to tighten a cap for one call, never to loosen it.
2. **Dry run.** Force it for everything (`dryRun: true`) or let the model ask per call. A dry run does everything except send: prepares the transaction, checks the cap, gets the policy verdict (including "needs human approval") and simulates. The model can't switch off a dry run you forced.
3. **[`@codkit/policy`](../policy).** Caps, allow/deny lists, approval, mandatory simulation, kill switch.

The tools are `KitTool`s from [`@codkit/mcp`](../mcp): the same definitions run in the Vercel AI SDK, an MCP server, the OpenAI-compatible agent loop and WebMCP.

```sh
pnpm add @codkit/agent-tools @codkit/mcp @codkit/policy viem
```

## Use

```ts
import { createPolicyEngine, toAtomic } from "@codkit/policy";
import { agentTools } from "@codkit/agent-tools";
import { evmChain } from "@codkit/agent-tools/evm";
import { uniswapV3 } from "@codkit/agent-tools/uniswap";
import { toAiSdkTools } from "@codkit/mcp/ai-sdk";
import { generateText, isStepCount } from "ai";

const chain = evmChain({
  chain: "base-sepolia",
  publicClient,
  walletClient, // viem clients; the wallet client holds the key
  tokens: { USDC: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 } },
  swap: [uniswapV3()],
});
const engine = createPolicyEngine({
  policy: { chains: ["eip155:84532"], limits: [{ asset: "native", chain: "eip155:84532", label: "ETH", perTx: toAtomic("0.0005", 18) }] },
});
const tools = agentTools({ engine, chains: [chain], maxPerCall: { ETH: "0.0005", USDC: "0.5" }, dryRun: true });

await generateText({ model, tools: toAiSdkTools(tools), stopWhen: isStepCount(8), prompt: "Swap 0.0001 ETH to USDC" });
```

As an MCP server: `await serveStdio(tools, { name: "wallet" })` from `@codkit/mcp/server`. Runnable versions: [`examples/agent.ts`](examples/agent.ts) and [`examples/mcp-server.ts`](examples/mcp-server.ts).

## Subpaths

| Import                | What                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `@codkit/agent-tools` | `agentTools(config)`, no chain SDK                                                                   |
| `/evm`                | `evmChain`: balances, native and ERC-20 transfers, swaps (exact-amount approval)                     |
| `/solana`             | `solanaChain`: SOL and SPL balances and transfers, swaps with fee-payer, program and balance checks  |
| `/uniswap`            | Uniswap v3 on Ethereum, Base, Sepolia, Base Sepolia (QuoterV2, best fee tier). **The testnet path.** |
| `/lifi`               | LI.FI aggregator, mainnets only                                                                      |
| `/jupiter`            | Jupiter, Solana mainnet only                                                                         |

## Things to know

- **Testnets:** LI.FI has no routes on testnets and Jupiter is mainnet only, so only Uniswap v3 can execute a swap on Base Sepolia. Pass several providers and the best quote wins.
- **Policy limits are per asset.** ETH and SOL are both `"native"`: scope each limit with `chain` when one engine covers both.
- **LI.FI returns calldata to sign.** The provider rejects responses whose chain, tokens or amount don't match the request, but also restrict where it can go with the policy's `allow.programs` (the LI.FI diamond is `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`).
- **Jupiter** transactions are checked before signing: fee payer is the agent, every top-level program is on a short allowlist, and a simulation may not take more than the swap input (plus a fee allowance) or return less than the guaranteed minimum.
- **Solana:** the legacy Token program only (Token-2022 mints are refused). Rent for a new token account isn't counted as spend.
- **Never executed on mainnet by codkit's tests or examples.** Mainnet is read-only there (quotes and simulations); running it for real is your decision.

## Verified

Unit tests against a real Anvil and a stubbed Solana RPC; live runs on Base Sepolia and Solana devnet (`pnpm e2e:agent-tools` in the monorepo) with the reports under `apps/testnet-e2e/reports`.
