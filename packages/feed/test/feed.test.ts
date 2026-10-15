import { createPolicyEngine, usdc } from "@codkit/policy";
import { ed25519Signer, MemoryReceiptStore, ReceiptLog } from "@codkit/receipts";
import { describe, expect, it } from "vitest";
import {
  agentEventToFeed,
  connectPolicy,
  createApprovalBroker,
  createFeed,
  feedReceiptStore,
  readSse,
  sseHandler,
  summarizeAction,
  toolEventToFeed,
  type FeedEvent,
} from "../src/index.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const action = (amount: bigint) => ({
  chain: "eip155:84532",
  kind: "x402_payment",
  to: "0x2222222222222222222222222222222222222222",
  spends: [{ asset: USDC, amount }],
});

describe("feed", () => {
  it("assigns ids, keeps a bounded history and notifies subscribers", () => {
    const feed = createFeed({ capacity: 3 });
    const seen: number[] = [];
    const off = feed.subscribe((e) => seen.push(e.id));
    for (let i = 0; i < 5; i++) feed.push({ kind: "log", level: "info", message: `m${i}` });
    off();
    feed.push({ kind: "log", level: "info", message: "after" });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(feed.history().map((e) => e.id)).toEqual([4, 5, 6]);
    expect(feed.since(5).map((e) => e.id)).toEqual([6]);
  });

  it("summarizes actions with asset labels", () => {
    expect(summarizeAction(action(usdc("0.25")), { [USDC.toLowerCase()]: { symbol: "USDC", decimals: 6 } })).toBe(
      "x402_payment 0.25 USDC → 0x2222…2222",
    );
    expect(summarizeAction(action(5n))).toBe("x402_payment 5 0x036C…CF7e → 0x2222…2222");
  });
});

describe("adapters", () => {
  it("mirrors policy decisions, committed txs and the kill switch", async () => {
    const feed = createFeed();
    const engine = createPolicyEngine({ policy: { limits: [{ asset: USDC, perTx: usdc(1) }], requireSimulation: false } });
    connectPolicy(feed, engine, { assets: { [USDC]: { symbol: "USDC", decimals: 6 } } });
    await engine.execute(action(usdc("0.5")), { execute: async () => "0xabc", ref: (h) => h });
    await engine.execute(action(usdc(3)), { execute: async () => "0x" }).catch(() => {});
    engine.kill("demo");

    const kinds = feed.history().map((e) => e.kind);
    expect(kinds).toEqual(["policy", "tx", "policy", "kill_switch"]);
    const [allow, tx, deny] = feed.history() as Extract<FeedEvent, { kind: string }>[];
    expect(allow).toMatchObject({ verdict: "allow", summary: "x402_payment 0.5 USDC → 0x2222…2222" });
    expect(tx).toMatchObject({ kind: "tx", hash: "0xabc", url: "https://sepolia.basescan.org/tx/0xabc", status: "settled" });
    expect(deny).toMatchObject({ verdict: "deny", reasons: [expect.stringMatching(/per-tx cap/)] });
    expect((allow as unknown as { action: { spends: { amount: string }[] } }).action.spends[0]!.amount).toBe("500000");
  });

  it("marks simulated txs without explorer links", async () => {
    const feed = createFeed();
    const engine = createPolicyEngine({ policy: { unknownAssets: "allow", requireSimulation: false } });
    connectPolicy(feed, engine, { simulated: true });
    await engine.execute(action(1n), { execute: async () => "0xfake", ref: (h) => h });
    expect(feed.history().find((e) => e.kind === "tx")).toMatchObject({ url: null, simulated: true });
  });

  it("streams receipts, agent and tool events", async () => {
    const feed = createFeed();
    const log = new ReceiptLog({ signer: ed25519Signer(), store: feedReceiptStore(new MemoryReceiptStore(), feed) });
    await log.append("agent.note", { note: "hi" });
    agentEventToFeed(feed, { type: "thinking", text: "hmm" });
    agentEventToFeed(feed, { type: "turn" });
    toolEventToFeed(feed, { type: "tool_call", id: "c1", name: "pay_fetch", input: { url: "x", n: 1n } });
    toolEventToFeed(feed, { type: "tool_result", id: "c1", name: "pay_fetch", ok: true, output: "{}", ms: 3 });
    expect(feed.history().map((e) => e.kind)).toEqual(["receipt", "thinking", "tool_call", "tool_result"]);
    expect(feed.history()[2]).toMatchObject({ input: { url: "x", n: "1" } });
    expect((await log.list()).length).toBe(1);
  });
});

describe("SSE", () => {
  it("replays history then streams live events; resumes after Last-Event-ID", async () => {
    const feed = createFeed();
    feed.push({ kind: "log", level: "info", message: "old-1" });
    feed.push({ kind: "log", level: "info", message: "old-2" });
    const handler = sseHandler(feed, { heartbeatMs: 10 });

    const ac = new AbortController();
    const res = handler(new Request("http://x/feed", { signal: ac.signal }));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const got: string[] = [];
    const reading = (async () => {
      for await (const e of readSse(res.body!)) {
        got.push((e as { message: string }).message);
        if (got.length === 3) break;
      }
    })();
    setTimeout(() => feed.push({ kind: "log", level: "info", message: "live" }), 30);
    await reading;
    ac.abort();
    expect(got).toEqual(["old-1", "old-2", "live"]);

    const resumed = handler(new Request("http://x/feed", { headers: { "last-event-id": "2" } }));
    const it = readSse(resumed.body!);
    expect(((await it.next()).value as { message: string }).message).toBe("live");
    await it.return(undefined);
  });
});

describe("approval broker", () => {
  it("routes approval requests through the feed and waits for a human", async () => {
    const feed = createFeed();
    const broker = createApprovalBroker(feed, { assets: { [USDC]: { symbol: "USDC", decimals: 6 } } });
    const engine = createPolicyEngine({
      policy: { limits: [{ asset: USDC, perTx: usdc(5), approvalAbove: usdc("0.1") }], requireSimulation: false },
      approver: broker.approver,
    });
    connectPolicy(feed, engine);
    const running = engine.execute(action(usdc("0.25")), { execute: async () => "0x1", ref: (h) => h });
    await new Promise((r) => setTimeout(r, 10));
    const req = feed.history().find((e) => e.kind === "approval_request") as Extract<FeedEvent, { kind: "approval_request" }>;
    expect(req).toMatchObject({ summary: "x402_payment 0.25 USDC → 0x2222…2222" });
    expect(broker.pending()).toHaveLength(1);
    expect(broker.resolve("nope", true)).toBe(false);
    expect(broker.resolve(req.requestId, true, "alice")).toBe(true);
    await expect(running).resolves.toMatchObject({ result: "0x1" });
    expect(feed.history().find((e) => e.kind === "approval")).toMatchObject({ approved: true, by: "alice" });
  });

  it("denies when nobody answers in time", async () => {
    const feed = createFeed();
    const broker = createApprovalBroker(feed, { timeoutMs: 20 });
    const engine = createPolicyEngine({
      policy: { limits: [{ asset: USDC, approvalAbove: 0n }], requireSimulation: false },
      approver: broker.approver,
    });
    await expect(engine.execute(action(1n), { execute: async () => "x" })).rejects.toMatchObject({ code: "approval_rejected" });
    expect(broker.pending()).toEqual([]);
  });
});
