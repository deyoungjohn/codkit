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

It's built on the kit: `policy`, `pay` (x402), `receipts`, `mcp` (tools and the Claude loop) and `feed` (SSE event stream).

## Run

```bash
pnpm install && pnpm build          # from the repo root
pnpm --filter demo-shell dev        # http://localhost:3000
```

- **Demo mode** (default, no keys needed): a scripted agent calls the real tools. The policy engine, x402 signing against an in-process paywall, approvals and receipts are all real. Only the reasoning text is canned, and settlement is simulated (transactions are marked `sim`).
- **Live mode:** set `ANTHROPIC_API_KEY` and Claude (`claude-opus-5-5`) drives the same tools.

`DEMO_STEP_MS=1200` slows the scripted run so you can narrate it while recording.

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

**There's no auth.** Put the dashboard behind a login, or keep it local, before you point it at real funds.

## Test

```bash
pnpm --filter demo-shell build && pnpm --filter demo-shell test
```

This starts the built app, runs the demo agent, approves the approval request through the API, and checks the results: allowed and blocked decisions, 3 settled payments, 0.27 USDC spent, verified receipts, the final answer, and the kill switch.
