# demo-shell

![Agent Console](../../docs/demo-shell.png)

A hackathon demo dashboard for "AI agent that spends money under policy". It shows, live:

- **Reasoning trace:** the agent's thinking, tool calls, and results.
- **Policy decisions:** allowed, needs approval, or blocked, with reasons.
- **Human approval:** Approve/Deny buttons for anything above the threshold.
- **Kill switch:** a human control. The agent can engage it but can't release it.
- **Transactions:** settled payments with explorer links.
- **Receipt log:** signed and hash-chained, with live verification.
- **Wallet connect:** EIP-6963 discovery, with no extra dependencies.
- **Operator sign-in**, and an **MCP endpoint** so other agents (Claude Desktop, Cursor…) can use the same tools under the same policy.

It's built on the kit: `policy`, `pay` (x402), `receipts`, `mcp` (tools and the LLM agent loop) and `feed` (SSE event stream).

## Run

```bash
pnpm install && pnpm build          # from the repo root
pnpm --filter demo-shell dev        # http://localhost:3000
```

- **Demo mode** (default, no keys needed): a scripted agent calls the real tools. The policy engine, x402 signing against an in-process paywall, approvals and receipts are all real. Only the reasoning text is canned, and settlement is simulated (transactions are marked `sim`).
- **Live mode:** set any OpenAI-compatible LLM key (`GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `AGENTROUTER_API_KEY`) and that model drives the same tools. Set several to get a failover chain. See [`@codkit/mcp` → Run an agent](../../packages/mcp/README.md#run-an-agent).

`DEMO_STEP_MS=1200` slows the scripted run so you can narrate it while recording.

## Auth

| Variable | |
| --- | --- |
| `DASHBOARD_PASSWORD` | The operator password. **Required in production**: without it the dashboard stays locked and the sign-in page explains why. In `next dev` it's optional, and the top bar shows **Auth off (dev)** when it's unset. |
| `SESSION_SECRET` | Optional, at least 32 characters. It signs session cookies. If unset, a key derived from the password is used, so changing the password signs everyone out. |
| `MCP_TOKEN` | Enables `/api/mcp` (at least 16 characters, e.g. `openssl rand -hex 32`). Leave it unset to keep the endpoint off. |

- **Sign-in:** creates a 12-hour session cookie, signed (HMAC-SHA256), `HttpOnly` and `SameSite=Strict`, and `Secure` over HTTPS.
- **Two checks:** `proxy.ts` redirects signed-out visitors to `/login`, and every API route checks the session again on its own.
- **Requests that change state** must also come from the same origin.
- **Failed sign-ins** are limited to 10 per client every 5 minutes.

**MCP endpoint.** External agents use the dashboard agent's tools (x402 payments, policy checks, receipts) through `POST /api/mcp`, with a bearer token. The same budget, approvals and kill switch apply, and their actions appear in the live feed:

```bash
claude mcp add --transport http codkit http://localhost:3000/api/mcp --header "Authorization: Bearer $MCP_TOKEN"
```

## Make it yours

Everything specific to the demo lives in [`lib/runtime.ts`](lib/runtime.ts):

1. **`createVendor()`:** replace the in-process paywall with your sponsor's API, an x402 endpoint, or your own `paywall()` route.
2. **Policy:** set your chain, assets, caps, approval threshold and allow-lists.
3. **Tools:** add `evmTools` / `escrowTools` (from `@codkit/mcp/tools/*`) with a funded testnet key to move real funds through the guard.
4. **`SYSTEM_PROMPT` / `DEFAULT_PROMPT`:** describe your agent's job.
5. **`lib/scenario.ts`:** script the demo-mode story so it matches your pitch.

## API

| Route | |
| --- | --- |
| `GET /api/feed` | Server-Sent Events (history, then live; resumes with `Last-Event-ID`) |
| `GET /api/state` | Budget, spend, payments, receipts head and verification, pending approvals |
| `POST /api/run` `{ prompt? }` | Start the agent (409 if it's already running) |
| `POST /api/approve` `{ requestId, approved }` | Answer an approval request |
| `POST /api/kill` `{ engaged }` | Engage or release the kill switch |
| `POST /api/reset` | Fresh runtime |
| `POST /api/login` `{ password }` / `POST /api/logout` | Start or end an operator session |
| `GET/POST /api/mcp` | MCP (Streamable HTTP) for external agents, with `Authorization: Bearer $MCP_TOKEN` |

All routes except login, logout and MCP need an operator session.

## Test

```bash
pnpm --filter demo-shell build && pnpm --filter demo-shell test
```

This starts the built app with auth on and checks:

- **Auth:**
  - signed-out pages redirect to sign-in, and signed-out API calls get 401;
  - a wrong password and a forged session cookie are refused;
  - cross-origin POSTs get 403;
  - the MCP endpoint rejects a missing token and lists the tools with the right one.
- **The agent flow:** it signs in, runs the demo agent and approves its approval request through the API, then checks:
  - the allowed and blocked decisions;
  - 3 settled payments and 0.27 USDC spent;
  - verified receipts and the final answer;
  - the kill switch.
