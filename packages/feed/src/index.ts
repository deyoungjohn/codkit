import type { ApprovalRequest, ApprovalResponse, PolicyEvent } from "@iamyoungjohn-kit/policy";
import { explorerTxUrl, normalize, type Json, type Receipt, type ReceiptStore } from "@iamyoungjohn-kit/receipts";

/** Everything a demo dashboard shows, as one discriminated union. */
export type FeedEventBody =
  | { kind: "policy"; verdict: "allow" | "deny" | "require_approval"; summary: string; reasons: string[]; action: Json }
  | { kind: "approval_request"; requestId: string; summary: string; reasons: string[]; expiresAt: number }
  | { kind: "approval"; approved: boolean; summary: string; by?: string; note?: string; requestId?: string }
  | { kind: "tx"; chain: string; hash: string; url: string | null; label: string; status: "sent" | "settled" | "failed"; simulated?: boolean }
  | { kind: "thinking"; text: string }
  | { kind: "message"; text: string }
  | { kind: "tool_call"; callId: string; name: string; input: Json }
  | { kind: "tool_result"; callId: string; name: string; ok: boolean; output: string; ms: number }
  | { kind: "receipt"; seq: number; type: string; hash: string }
  | { kind: "kill_switch"; engaged: boolean; reason?: string }
  | { kind: "status"; state: "idle" | "running" | "done" | "error"; detail?: string }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string };

export type FeedEvent = FeedEventBody & { id: number; ts: number };

export interface Feed {
  push(event: FeedEventBody): FeedEvent;
  /** Recent events, oldest first. */
  history(): FeedEvent[];
  /** Events after `id` (for SSE reconnects via Last-Event-ID). */
  since(id: number): FeedEvent[];
  subscribe(listener: (e: FeedEvent) => void): () => void;
  clear(): void;
}

export function createFeed(opts: { capacity?: number; now?: () => number } = {}): Feed {
  const capacity = opts.capacity ?? 500;
  const now = opts.now ?? Date.now;
  let buffer: FeedEvent[] = [];
  let nextId = 1;
  const listeners = new Set<(e: FeedEvent) => void>();
  return {
    push(body) {
      const event = { ...body, id: nextId++, ts: now() } as FeedEvent;
      buffer.push(event);
      if (buffer.length > capacity) buffer = buffer.slice(-capacity);
      for (const l of listeners) {
        try {
          l(event);
        } catch {
          // a broken subscriber must not break the agent
        }
      }
      return event;
    },
    history: () => [...buffer],
    since: (id) => buffer.filter((e) => e.id > id),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    clear() {
      buffer = [];
    },
  };
}

// ---------------------------------------------------------------- adapters

type ActionLike = { chain: string; kind: string; to: string; method?: string; spends: { asset: string; amount: bigint }[] };

/** Short human label for an action, e.g. `x402_payment 10000 0x036C…cF7e → 0x2222…2222`. */
export function summarizeAction(a: ActionLike, labels: Record<string, { symbol: string; decimals: number }> = {}): string {
  const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
  const spend = a.spends
    .map((s) => {
      const l = labels[s.asset.toLowerCase()];
      return l ? `${formatUnits(s.amount, l.decimals)} ${l.symbol}` : `${s.amount} ${short(s.asset)}`;
    })
    .join(" + ");
  return `${a.method ?? a.kind}${spend ? ` ${spend}` : ""} → ${short(a.to)}`;
}

function formatUnits(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return `${s.slice(0, -decimals) || "0"}${frac ? `.${frac}` : ""}`;
}

export interface PolicyFeedOptions {
  /** Asset address (any case) → display info, e.g. `{ "0x036c…": { symbol: "USDC", decimals: 6 } }`. */
  assets?: Record<string, { symbol: string; decimals: number }>;
  /** Mark tx events as simulated (no explorer link), e.g. in demo mode. */
  simulated?: boolean;
}

/** Mirror policy-engine events into the feed: decisions, approvals, committed txs, kill switch. */
export function connectPolicy(
  feed: Feed,
  engine: { on(l: (e: PolicyEvent) => void): () => void },
  opts: PolicyFeedOptions = {},
): () => void {
  const assets = Object.fromEntries(Object.entries(opts.assets ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return engine.on((e) => {
    switch (e.type) {
      case "decision":
        feed.push({
          kind: "policy",
          verdict: e.decision.verdict,
          summary: summarizeAction(e.decision.action, assets),
          reasons: e.decision.reasons,
          action: normalize(e.decision.action),
        });
        break;
      case "approval":
        feed.push({
          kind: "approval",
          approved: e.approved,
          summary: summarizeAction(e.action, assets),
          ...(e.by !== undefined && { by: e.by }),
          ...(e.note !== undefined && { note: e.note }),
        });
        break;
      case "committed":
        if (e.ref)
          feed.push({
            kind: "tx",
            chain: e.action.chain,
            hash: e.ref,
            url: opts.simulated ? null : (explorerTxUrl(e.action.chain, e.ref) ?? null),
            label: summarizeAction(e.action, assets),
            status: "settled",
            ...(opts.simulated && { simulated: true }),
          });
        break;
      case "failed":
        feed.push({ kind: "log", level: "warn", message: `${e.stage} failed: ${e.error}` });
        break;
      case "kill_switch":
        feed.push({ kind: "kill_switch", engaged: e.engaged, ...(e.reason !== undefined && { reason: e.reason }) });
        break;
    }
  });
}

/** Wrap a receipt store so every appended receipt also shows up in the feed. */
export function feedReceiptStore(inner: ReceiptStore, feed: Feed): ReceiptStore {
  return {
    async append(r: Receipt) {
      await inner.append(r);
      feed.push({ kind: "receipt", seq: r.seq, type: r.type, hash: r.hash });
    },
    head: () => inner.head(),
    list: () => inner.list(),
  };
}

/** Map agent-loop events (`runAgent` onEvent in `@iamyoungjohn-kit/mcp/claude`). */
export function agentEventToFeed(feed: Feed, e: { type: string; text?: string }): void {
  if (e.type === "thinking" && e.text) feed.push({ kind: "thinking", text: e.text });
  else if (e.type === "text" && e.text) feed.push({ kind: "message", text: e.text });
}

/** Map tool events (`instrument` onEvent in `@iamyoungjohn-kit/mcp`). */
export function toolEventToFeed(
  feed: Feed,
  e: { type: "tool_call"; id: string; name: string; input: unknown } | { type: "tool_result"; id: string; name: string; ok: boolean; output: string; ms: number },
): void {
  if (e.type === "tool_call") feed.push({ kind: "tool_call", callId: e.id, name: e.name, input: normalize(e.input) });
  else feed.push({ kind: "tool_result", callId: e.id, name: e.name, ok: e.ok, output: e.output, ms: e.ms });
}

// --------------------------------------------------------------------- SSE

/**
 * Server-Sent Events endpoint on web-standard Request/Response (Next.js route
 * handlers, Hono, Bun, Workers). Replays history (or everything after
 * `Last-Event-ID`), then streams live events, with a heartbeat comment.
 */
export function sseHandler(feed: Feed, opts: { heartbeatMs?: number } = {}): (req: Request) => Response {
  return (req) => {
    const enc = new TextEncoder();
    const lastId = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("since") ?? NaN);
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (e: FeedEvent) => controller.enqueue(enc.encode(`id: ${e.id}\nevent: feed\ndata: ${JSON.stringify(e)}\n\n`));
        controller.enqueue(enc.encode("retry: 2000\n\n"));
        for (const e of Number.isFinite(lastId) ? feed.since(lastId) : feed.history()) send(e);
        const off = feed.subscribe(send);
        const hb = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), opts.heartbeatMs ?? 15_000);
        cleanup = () => {
          off();
          clearInterval(hb);
        };
        req.signal?.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
    });
  };
}

/** Parse an SSE body into feed events (for tests, CLIs and Node consumers). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<FeedEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) yield JSON.parse(data) as FeedEvent;
    }
  }
}

// ---------------------------------------------------------------- approvals

export interface ApprovalBroker {
  /** Pass as `approver` to `createPolicyEngine`. */
  approver: (req: ApprovalRequest) => Promise<ApprovalResponse>;
  /** Answer a pending request (e.g. from a dashboard button). Returns false if unknown/expired. */
  resolve(requestId: string, approved: boolean, by?: string): boolean;
  pending(): { requestId: string; summary: string; expiresAt: number }[];
}

/**
 * Human-in-the-loop approvals through the feed: each request is pushed as an
 * `approval_request` event and waits for `resolve()` — or is denied after the timeout.
 */
export function createApprovalBroker(
  feed: Feed,
  opts: { timeoutMs?: number; assets?: PolicyFeedOptions["assets"]; now?: () => number } = {},
): ApprovalBroker {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const now = opts.now ?? Date.now;
  const assets = Object.fromEntries(Object.entries(opts.assets ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const waiting = new Map<string, { summary: string; expiresAt: number; done: (r: ApprovalResponse) => void }>();
  return {
    approver(req) {
      const requestId = crypto.randomUUID();
      const summary = summarizeAction(req.action, assets);
      const expiresAt = now() + timeoutMs;
      return new Promise<ApprovalResponse>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          resolve({ approved: false, note: `no response within ${Math.round(timeoutMs / 1000)}s` });
        }, timeoutMs);
        waiting.set(requestId, {
          summary,
          expiresAt,
          done: (r) => {
            clearTimeout(timer);
            waiting.delete(requestId);
            resolve(r);
          },
        });
        feed.push({ kind: "approval_request", requestId, summary, reasons: req.decision.reasons, expiresAt });
      });
    },
    resolve(requestId, approved, by) {
      const w = waiting.get(requestId);
      if (!w) return false;
      w.done({ approved, ...(by !== undefined && { by }), ...(!approved && { note: `declined by ${by ?? "human"}` }) });
      return true;
    },
    pending: () => [...waiting.entries()].map(([requestId, w]) => ({ requestId, summary: w.summary, expiresAt: w.expiresAt })),
  };
}
