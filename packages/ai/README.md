# @codkit/ai

Every model provider your env has a key for, as [Vercel AI SDK](https://ai-sdk.dev) models, in one fallback chain. A rate limit, a timeout or an outage moves on to the next provider instead of failing your demo. Plus structured output that also moves on when a model answers with something that doesn't fit the schema.

```sh
pnpm add @codkit/ai ai zod
```

Providers (set any keys; the ones that are set are used in this order):

| `LLM_PROVIDER` name                                                      | Key                                                | Default model                      |
| ------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------- |
| `gateway` (Vercel AI Gateway)                                            | `AI_GATEWAY_API_KEY`                               | `anthropic/claude-sonnet-5.5`      |
| `anthropic`                                                              | `ANTHROPIC_API_KEY`                                | `claude-sonnet-5-5`                |
| `openai`                                                                 | `OPENAI_API_KEY`                                   | `gpt-5.5`                          |
| `google` (alias `gemini`)                                                | `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` | `gemini-3.5-flash`                 |
| `groq`                                                                   | `GROQ_API_KEY`                                     | `openai/gpt-oss-120b`              |
| `openrouter`                                                             | `OPENROUTER_API_KEY`                               | two free models (free slugs churn) |
| `nvidia` (alias `nim`)                                                   | `NVIDIA_API_KEY`                                   | `openai/gpt-oss-120b`              |
| `agentrouter`                                                            | `AGENTROUTER_API_KEY`                              | none: set `AGENTROUTER_MODEL`      |
| `custom` (any OpenAI-compatible URL: Ollama, vLLM, a sponsor's endpoint) | `LLM_API_KEY` + `LLM_BASE_URL`                     | set `LLM_MODEL`                    |

- `LLM_PROVIDER=anthropic,groq` picks and orders providers.
- `<NAME>_MODEL` picks a model per provider (`ANTHROPIC_MODEL=claude-opus-5-5`), `LLM_MODEL` the first provider's. A comma-separated list adds each model to the chain.

## Use

```ts
import { generateStructured, modelFromEnv, modelsFromEnv } from "@codkit/ai";
import { streamText } from "ai";
import { z } from "zod";

// one model that falls back across every provider in env: works in streamText, generateText, useChat routes, agents
const result = streamText({ model: modelFromEnv(), prompt: "…" });

// a typed object; a model that times out, is rate-limited or answers off-schema hands over to the next
const { object, provider, modelId } = await generateStructured({
  models: modelsFromEnv(),
  schema: z.object({ verdict: z.enum(["buy", "skip"]), reasons: z.array(z.string()) }),
  prompt: "…",
  onFallback: (e) => console.log(`${e.from.provider} → ${e.to.provider}`),
});
```

A Next.js chat route with `useChat` on the client:

```ts
// app/api/chat/route.ts
import { modelFromEnv } from "@codkit/ai";
import { convertToModelMessages, streamText } from "ai";

export async function POST(req: Request) {
  const { messages } = await req.json();
  return streamText({ model: modelFromEnv(), messages: await convertToModelMessages(messages) }).toUIMessageStreamResponse();
}
```

With tools from codkit (`@codkit/agent-tools`, `policy`, `pay`), pass `toAiSdkTools(tools)` from `@codkit/mcp/ai-sdk` as `tools`.

## Behaviour

- **What falls back:** HTTP 408, 409, 425, 429 and 5xx, the SDK's retries running out, network failures, and a model that takes longer than `timeoutMs` (default 60s; for a stream, the time to connect). `generateStructured` also falls back when the answer doesn't fit the schema.
- **What doesn't:** a bad key or a bad request (400, 401, 403, 404), so a bug isn't hidden behind the next provider; and a call you aborted.
- **Streams** fall back only while connecting. Once text flows, an error is passed through.
- `generateStructured` retries each model once (`maxRetries: 1`) before moving on.
- Groq through the native provider handles multi-step tool calls. Through a plain OpenAI-compatible client, its reasoning models reject the replayed `reasoning_content`.

Live check on 2026-11-27 (`pnpm --filter @codkit/ai example:models`): Gemini Flash-Lite and Groq `gpt-oss-120b` did structured output and a two-step tool call. `gemini-3.5-flash` timed out on the free tier and the chain moved on. Several OpenRouter free slugs had been retired. OpenRouter's Nemotron 3.5 Super VL (free) did both once JSON-schema output was switched on for it (`OPENROUTER_STRUCTURED`); without that, its answers didn't fit the schema.

## Examples

- `pnpm --filter @codkit/ai example:models`: every model in your env, each asked for structured output and a tool call. Run it before an event to see which keys work.
- `pnpm --filter @codkit/ai example:structured`: structured output with fallback, then a streamed answer from the same chain.
