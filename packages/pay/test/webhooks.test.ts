import { describe, expect, it, vi } from "vitest";
import { SIGNATURE_HEADER, signWebhook, verifyWebhook, webhookSender } from "../src/webhooks.js";

const SECRET = "whsec_0123456789abcdef";

function receiver(statuses: number[]) {
  const seen: { body: string; signature: string | null }[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push({ body: init!.body as string, signature: new Headers(init!.headers).get(SIGNATURE_HEADER) });
    return new Response(null, { status: statuses.shift() ?? 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen, calls: fetch };
}

describe("webhooks", () => {
  it("signs and verifies; rejects tampering, wrong secrets and stale timestamps", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "payment.settled", created: 1, data: { amount: "10000" } });
    const signature = await signWebhook(body, SECRET, 1_000);
    await expect(verifyWebhook({ body, signature, secret: SECRET, now: 1_100 })).resolves.toMatchObject({ type: "payment.settled" });
    await expect(verifyWebhook({ body: body.replace("10000", "99999"), signature, secret: SECRET, now: 1_100 })).rejects.toThrow(/mismatch/);
    await expect(verifyWebhook({ body, signature, secret: "another_secret_value", now: 1_100 })).rejects.toThrow(/mismatch/);
    await expect(verifyWebhook({ body, signature, secret: SECRET, now: 2_000 })).rejects.toThrow(/tolerance/);
    await expect(verifyWebhook({ body, signature: null, secret: SECRET })).rejects.toThrow(/malformed/);
  });

  it("delivers a signed payment.settled event the receiver can verify", async () => {
    const r = receiver([200]);
    const hooks = webhookSender({ url: "https://shop.example/hooks", secret: SECRET, fetch: r.fetch });
    const { delivered, event } = await hooks.send("payment.settled", { transaction: "0xabc", amount: 10_000n });
    expect(delivered).toBe(true);
    const got = await verifyWebhook({ body: r.seen[0]!.body, signature: r.seen[0]!.signature, secret: SECRET });
    expect(got).toEqual({ ...event, data: { transaction: "0xabc", amount: "10000" } });
  });

  it("retries 5xx and network errors with backoff, then reports failure", async () => {
    const ok = receiver([503, 500, 200]);
    const a = webhookSender({ url: "https://x", secret: SECRET, fetch: ok.fetch, backoffMs: 1 });
    expect((await a.send("t", {})).delivered).toBe(true);
    expect(ok.calls).toHaveBeenCalledTimes(3);

    const onError = vi.fn();
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const b = webhookSender({ url: "https://x", secret: SECRET, fetch: down, attempts: 2, backoffMs: 1, onError });
    expect((await b.send("t", {})).delivered).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "fetch failed" }), expect.objectContaining({ type: "t" }));
  });

  it("does not retry a 4xx the receiver will keep rejecting", async () => {
    const r = receiver([400, 200]);
    const s = webhookSender({ url: "https://x", secret: SECRET, fetch: r.fetch, backoffMs: 1 });
    expect((await s.send("t", {})).delivered).toBe(false);
    expect(r.calls).toHaveBeenCalledOnce();
  });

  it("refuses short secrets", () => {
    expect(() => webhookSender({ url: "https://x", secret: "short" })).toThrow(/16 characters/);
  });
});
