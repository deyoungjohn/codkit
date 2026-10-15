# @codkit/mcp

Define an agent tool once (Zod schema + `run`), then expose it in three ways:

| Surface | Import | Use it for |
| --- | --- | --- |
| **MCP server** (stdio or Streamable HTTP) | `/server` | Claude Code, Claude Desktop, Cursor, or any MCP client |
| **Claude agent loop** (Anthropic SDK tool runner) | `/claude` | Your own agent backend |
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

await serveStdio(tools, { name: "my-agent" });            // local: claude mcp add my-agent -- node server.js
app.all("/mcp", (c) => mcpHttpHandler(tools, { name: "my-agent" })(c.req.raw)); // remote: stateless HTTP
```

Put auth in front of the HTTP endpoint, because these tools can move money.

## Run a Claude agent

```ts
import { runAgent } from "@codkit/mcp/claude";

const { text } = await runAgent({ tools, system, prompt, onEvent: (e) => trace.push(e) });
```

- **Defaults:** `claude-opus-5-5` with adaptive thinking (summarized, so the reasoning trace can be shown in a demo), `effort: "high"`, and a cap of 20 iterations.
- **Refusal fallback:** server-side refusal fallback is on (`fallbacks: "default"`). Pass `fallbacks: false` to turn it off.
- **Errors:** when a tool fails, its error goes back to the model as an `is_error` result so it can adjust and try again.
- **Credentials:** read from `ANTHROPIC_API_KEY` or an `ant auth login` profile.

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

# Claude buys data from an x402 vendor within a budget (in-process paywall, no funds needed)
ANTHROPIC_API_KEY=… pnpm --filter @codkit/mcp example:agent
```
