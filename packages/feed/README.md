# @iamyoungjohn-kit/feed

A live event stream for agent demos. It merges policy decisions, approvals, tool calls, reasoning, transactions and receipts into one typed `FeedEvent` union, and serves it over Server-Sent Events.

```ts
import { createFeed, connectPolicy, createApprovalBroker, feedReceiptStore, sseHandler, toolEventToFeed } from "@iamyoungjohn-kit/feed";

const feed = createFeed();
const approvals = createApprovalBroker(feed);                 // human-in-the-loop via the dashboard
const engine = createPolicyEngine({ policy, approver: approvals.approver });
connectPolicy(feed, engine, { assets: { [USDC]: { symbol: "USDC", decimals: 6 } } });
const log = new ReceiptLog({ signer, store: feedReceiptStore(new MemoryReceiptStore(), feed) });
const tools = instrument(kitTools, { onEvent: (e) => toolEventToFeed(feed, e) });

export const GET = (req: Request) => sseHandler(feed)(req);  // Next.js route / Hono / Workers
// on a button click: approvals.resolve(requestId, true, "alice")
```

- **Resuming:** `sseHandler` replays history, then streams live. Browsers reconnect with `Last-Event-ID` and receive only what they missed.
- **Approvals:** `createApprovalBroker` pushes `approval_request` events and denies a request automatically after `timeoutMs` (default 2 minutes).
- **Reading in Node:** `readSse(body)` parses a stream into events, for tests and CLIs.

See [`apps/demo-shell`](../../apps/demo-shell) for a complete dashboard built on it.
