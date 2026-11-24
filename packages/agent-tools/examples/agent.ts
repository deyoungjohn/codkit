/**
 * An LLM with a wallet, through the Vercel AI SDK. It checks its balance, quotes a swap and does it,
 * on Base Sepolia, with per-call caps and a policy engine in the way.
 *
 *   pnpm --filter @codkit/agent-tools example:agent            # dry run: everything but sending (default)
 *   pnpm --filter @codkit/agent-tools example:agent -- --live  # really swaps, a few cents of testnet value
 *
 * Needs AGENT_PRIVATE_KEY (a Base Sepolia test key with a little ETH) and a key for any OpenAI-compatible
 * provider (GROQ_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY …) in the repo-root .env.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { providersFromEnv } from "@codkit/mcp/agent";
import { toAiSdkTools } from "@codkit/mcp/ai-sdk";
import { generateText, isStepCount } from "ai";
import { setup } from "./setup.js";

const live = process.argv.includes("--live");
const { tools, address } = setup({ dryRun: !live });
const provider = providersFromEnv()[0];
if (!provider) throw new Error("set an LLM key, e.g. GROQ_API_KEY (see packages/mcp/src/agent.ts for the presets)");

const llm = createOpenAICompatible({ name: provider.name, baseURL: provider.baseUrl, ...(provider.apiKey && { apiKey: provider.apiKey }) });
console.log(`${live ? "LIVE" : "dry run"} · ${provider.name}/${provider.model} · wallet ${address}\n`);

const { text, steps } = await generateText({
  model: llm(provider.model),
  tools: toAiSdkTools(tools, { onResult: (e) => console.log(`  ${e.ok ? "✓" : "✗"} ${e.name}: ${e.output.slice(0, 200)}`) }),
  stopWhen: isStepCount(8),
  system:
    "You are a careful on-chain agent on Base Sepolia (a testnet). Use the tools; never invent balances. Say plainly what happened, including refusals.",
  prompt: "Check my balances. Then quote swapping 0.0001 ETH to USDC, and make the swap if the quote looks sane. Report what you received.",
});
console.log(`\n${text}\n\n(${steps.length} steps)`);
