/**
 * Structured output with fallback, then a streamed answer from the same fallback chain.
 *
 *   pnpm --filter @codkit/ai example:structured
 */
import { streamText } from "ai";
import { z } from "zod";
import { generateStructured, modelFromEnv, modelsFromEnv } from "../src/index.js";

const report = await generateStructured({
  models: modelsFromEnv(),
  schema: z.object({
    verdict: z.enum(["buy", "hold", "skip"]),
    reasons: z.array(z.string()).max(3),
    maxPriceUsd: z.number(),
  }),
  name: "purchase_decision",
  prompt: "A data vendor sells a market report for $2.00. My agent has a $0.50 per-payment cap. Should it buy?",
  onFallback: (e) => console.log(`  falling back: ${e.from.provider} → ${e.to.provider}`),
});
console.log(`${report.provider}:${report.modelId} (attempt ${report.attempts})`, report.object);

const stream = streamText({ model: modelFromEnv(), prompt: "In one sentence: why should an AI agent's spending have a cap?" });
for await (const chunk of stream.textStream) process.stdout.write(chunk);
console.log();
