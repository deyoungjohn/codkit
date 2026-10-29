# @codkit/mcp

Define an agent tool once (Zod schema + `run`), then expose it in three ways:

| Surface | Import | Use it for |
| --- | --- | --- |
| **MCP server** (stdio or Streamable HTTP) | `/server` | Claude Code, Claude Desktop, Cursor, or any MCP client |
| **Agent loop** (any OpenAI-compatible LLM) | `/agent` | Your own agent backend |
| **WebMCP** (`document.modelContext`) | `/webmcp` | In-browser agents using your dApp's tools |

It also includes ready-made **kit tools** that connect policy, payments, contracts and receipts. Every money-moving tool goes through the policy engine (caps, allow-lists, simulation, approval, kill switch).

## Define a tool

```ts
import { defineTool } from "@codkit/mcp";
import { z } from "zod";

const quote = defineTool({
  name: "get_quote",
  description: "Price quote for a swap. Read-only.",
  input: z.object({ from: z.string(), to: z.string(), amount: z.string() }),
  annotations: { readOnlyHint: true },
  run: async ({ from, to, amount }) => ({ out: "…" }), // return JSON-ish; throw to report an error
});
```

## Serve over MCP

```ts
import { serveStdio, mcpHttpHandler } from "@codkit/mcp/server";

await serveStdio(tools, { name: "my-agent" }); // local: claude mcp add my-agent -- node server.js

// remote: stateless Streamable HTTP, authenticated
const mcp = mcpHttpHandler(tools, { name: "my-agent", auth: { bearerTokens: [process.env.MCP_TOKEN!] } });
app.all("/mcp", (c) => mcp(c.req.raw));
```

**The HTTP handler requires auth**, because these tools can move money. Pick one:

| `auth` | Use it for |
| --- | --- |
| `{ bearerTokens: [token, …] }` | API tokens (at least 16 characters; `openssl rand -hex 32`). Clients send `Authorization: Bearer <token>`. Tokens are compared in constant time, and several can be active at once so you can rotate them. |
| `{ verify: (token, req) => … }` | Your own check, such as an OAuth access token or JWT from your authorization server. Add `resourceMetadataUrl` to advertise it to MCP clients (RFC 9728) in the `WWW-Authenticate` header. |
| `{ allowAnonymous: true }` | Local development only. |

A missing or wrong token gets `401` with `WWW-Authenticate: Bearer`. Calling the handler with no auth decision at all throws at startup.

To charge per call, pass `wrapHandler`, which `createMcpServer`, `serveStdio` and `mcpHttpHandler` all accept. Each tool's MCP handler goes through it. With [`@codkit/pay/mcp`](../pay#paid-mcp-tools), priced tools demand an x402 payment:

```ts
const paywall = mcpPaywall({ payTo: "0x…", tools: { premium_report: "$0.05" } });
const mcp = mcpHttpHandler(tools, { name: "data-shop", auth, wrapHandler: paywall.wrap });
```

## Run an agent

```ts
import { runAgent } from "@codkit/mcp/agent";

const { text } = await runAgent({ tools, system, prompt, onEvent: (e) => trace.push(e) });
```

The loop talks plain Chat Completions over `fetch` with no SDK, so any OpenAI-compatible provider works. Presets (key env var → default model):

| Provider | Key | Default model |
| --- | --- | --- |
| `groq` | `GROQ_API_KEY` | `openai/gpt-oss-120b` |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.5-flash`, then `gemini-flash-lite-latest` |
| `nvidia` (NIM) | `NVIDIA_API_KEY` | `openai/gpt-oss-120b` |
| `openrouter` | `OPENROUTER_API_KEY` | four free tool-capable models, tried in order (see `PROVIDERS`) |
| `agentrouter` | `AGENTROUTER_API_KEY` | none, so set `AGENTROUTER_MODEL` |
| `custom` | `LLM_API_KEY` + `LLM_BASE_URL` | `LLM_MODEL` (Ollama, vLLM, LM Studio…) |

- **Configuration:** keys are read from the repo-root `.env` (examples and the dashboard load it). `providersFromEnv()` picks every provider whose key is set, in the order above. Override the order with `LLM_PROVIDER=gemini,groq`. Set the model with `LLM_MODEL` (first provider) or `<NAME>_MODEL`. A comma-separated list (`GEMINI_MODEL=gemini-3.5-flash,gemini-flash-lite-latest`) tries each model in turn. A request that gets no answer within `requestTimeoutMs` (default 60 s) fails over to the next model straight away, without retries. Free-tier catalogues change monthly, so run `pnpm --filter @codkit/mcp example:models [filter]` to see what your keys can use. You can also pass `providers: [{ name, baseUrl, apiKey, model }]` directly.
- **Failover:** `429` and `5xx` responses are retried with backoff (`retry-after` is honoured), then the run moves to the next provider. Other errors (bad key, unknown model) fail over at once. The history is plain OpenAI format, so a run can switch providers mid-task. A `failover` event reports each switch.
- **Errors:** invalid arguments, malformed JSON and unknown tool names go back to the model as `Error: …` tool results so it can correct itself.
- **Trace:** `onEvent` emits `thinking` (from `reasoning` / `reasoning_content`, when the provider returns it), `text`, `tool_use`, and `turn` (with usage, provider and model). It stops after `maxIterations` (default 20).
- **Model choice:** small free models are weaker at multi-step tool use. Pick a model with native function calling, keep toolsets small, and rely on the policy engine, not the prompt, for safety.

## Expose in the browser (WebMCP)

```ts
import { registerWebMcpTools } from "@codkit/mcp/webmcp";
const { unregister } = await registerWebMcpTools(tools); // no-op if the browser has no model context
```

## Kit tools

| Import | Tools |
| --- | --- |
| `/tools/policy` → `policyTools(engine)` | `policy_check` (dry run), `policy_status` (limits, spend, kill switch), `policy_halt` (agent stops itself; there's no tool to resume) |
| `/tools/pay` → `payTools({ fetch })` | `pay_fetch`: HTTP that pays x402 paywalls within budget. Supports `allowedHosts`. |
| `/tools/evm` → `evmTools({ guard, reader, tokens, ... })` | `wallet_balance`, `token_transfer` (policy-checked and simulated) |
| `/tools/escrow` → `escrowTools({ guard, escrow, token, ... })` | `escrow_create`, `escrow_status`, `escrow_release`, `escrow_refund` |
| `/tools/receipts` → `receiptTools(log, publish?)` | `receipts_note`, `receipts_recent`, `receipts_verify`, and `receipts_publish` (when an anchorer or uploader is configured) |

`instrument(tools, { onEvent, receipts })` wraps any toolset so every call emits an event (for a live dashboard) and is written to the signed receipt log.

## Examples

```bash
# MCP server for Claude Code (policy + receipts; add EVM_PRIVATE_KEY for wallet + x402 tools)
claude mcp add kit -- pnpm --silent --dir packages/mcp example:server

# An LLM buys data from an x402 vendor within a budget (in-process paywall, no funds needed)
GROQ_API_KEY=… pnpm --filter @codkit/mcp example:agent
# Which models can my keys use?
GROQ_API_KEY=… OPENROUTER_API_KEY=… pnpm --filter @codkit/mcp example:models
```
