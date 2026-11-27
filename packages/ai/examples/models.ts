/**
 * Every model your env provides, each asked for a structured answer and a two-step tool call: a quick way to see
 * which keys work and which models can do tools before an event.
 *
 *   pnpm --filter @codkit/ai example:models
 *   LLM_PROVIDER=anthropic,groq pnpm --filter @codkit/ai example:models
 */
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { generateStructured, modelsFromEnv } from "../src/index.js";

const models = modelsFromEnv();
if (!models.length)
  throw new Error("no LLM keys in env (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, AI_GATEWAY_API_KEY …)");

const time = tool({
  description: "The current time in a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ city, time: "14:05" }),
});

for (const m of models) {
  const name = `${m.provider}:${m.modelId}`;
  const t0 = Date.now();
  try {
    const s = await generateStructured({
      models: [m],
      schema: z.object({ capital: z.string(), population: z.number() }),
      prompt: "The capital of Ghana and its approximate population as a number.",
      maxRetries: 0,
    });
    const r = await generateText({
      model: m.model,
      tools: { time },
      stopWhen: isStepCount(3),
      prompt: "What time is it in Accra? Use the tool.",
      maxRetries: 0,
    });
    const usedTool = r.steps.some((st) => st.toolCalls.length > 0);
    console.log(
      `✓ ${name} (${Date.now() - t0}ms): structured ${JSON.stringify(s.object)}; tools ${usedTool ? "ok" : "NOT CALLED"}: ${r.text.slice(0, 60).replace(/\s+/g, " ")}`,
    );
  } catch (e) {
    console.log(`✗ ${name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}
