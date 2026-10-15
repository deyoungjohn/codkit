import { usdc, type PolicyInput } from "@iamyoungjohn-kit/policy";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createBudgetedFetch, type PaymentOutcome } from "../src/index.js";
import { paywall, type SettledPayment } from "../src/server/hono.js";
import { agent, fakeFacilitator, NETWORK, PAY_TO, USDC } from "./helpers.js";

function setup(policy: PolicyInput, opts: { settleFails?: boolean; approver?: () => Promise<boolean> } = {}) {
  const facilitator = fakeFacilitator(opts);
  const settled: SettledPayment[] = [];
  const app = new Hono();
  app.use(
    paywall({
      payTo: PAY_TO,
      facilitator,
      routes: {
        "GET /cheap": { price: "$0.01", description: "cheap data" },
        "GET /pricey": "$0.50",
      },
      onSettled: (p) => {
        settled.push(p);
      },
    }),
  );
  app.get("/cheap", (c) => c.json({ data: "cheap" }));
  app.get("/pricey", (c) => c.json({ data: "pricey" }));
  app.get("/free", (c) => c.json({ data: "free" }));

  const { engine, client, account } = agent(policy, opts.approver);
  const outcomes: PaymentOutcome[] = [];
  const fetch = createBudgetedFetch({
    engine,
    client,
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    onPayment: (o) => outcomes.push(o),
  });
  return { app, facilitator, settled, engine, account, fetch, outcomes };
}

const policy: PolicyInput = {
  limits: [{ asset: USDC, label: "USDC", perTx: usdc("0.10"), perPeriod: { amount: usdc("0.03"), seconds: 3600 } }],
};

describe("paywall + budgeted fetch (end to end)", () => {
  it("returns 402 with x402 v2 requirements to a plain client", async () => {
    const { app } = setup(policy);
    const res = await app.request("/cheap");
    expect(res.status).toBe(402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header).toBeTruthy();
    const required = JSON.parse(Buffer.from(header!, "base64").toString());
    expect(required.accepts[0]).toMatchObject({ scheme: "exact", network: NETWORK, payTo: PAY_TO, asset: USDC, amount: "10000" });
    expect((await app.request("/free")).status).toBe(200);
  });

  it("pays within policy, commits the spend with the settlement tx, and notifies both sides", async () => {
    const { fetch, engine, settled, outcomes, account } = setup(policy);
    const res = await fetch("http://localhost/cheap");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "cheap" });

    const tx = `0x${"1".padStart(64, "0")}`;
    expect(await engine.spendStore.list()).toEqual([
      expect.objectContaining({ status: "committed", amount: usdc("0.01"), ref: tx, chain: NETWORK }),
    ]);
    expect(outcomes).toEqual([expect.objectContaining({ status: "settled", transaction: tx, network: NETWORK })]);
    expect(settled).toEqual([
      expect.objectContaining({ transaction: tx, amount: "10000", asset: USDC, payTo: PAY_TO, payer: account.address }),
    ]);
  });

  it("refuses to sign above the per-tx cap; the server never sees a payment", async () => {
    const { fetch, engine, facilitator, outcomes } = setup(policy);
    await expect(fetch("http://localhost/pricey")).rejects.toThrow(/policy: denied: .*exceeds per-tx cap/);
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(await engine.spendStore.list()).toEqual([]);
    expect(outcomes).toEqual([expect.objectContaining({ status: "blocked" })]);
  });

  it("stops paying once the period budget is used up", async () => {
    const { fetch, facilitator } = setup(policy);
    for (let i = 0; i < 3; i++) expect((await fetch("http://localhost/cheap")).status).toBe(200);
    await expect(fetch("http://localhost/cheap")).rejects.toThrow(/exceeds 30000 per 3600s/);
    expect(facilitator.settle).toHaveBeenCalledTimes(3);
  });

  it("releases the reservation when settlement fails", async () => {
    const { fetch, engine, outcomes } = setup(policy, { settleFails: true });
    const res = await fetch("http://localhost/cheap");
    expect(res.status).not.toBe(200);
    expect(await engine.spendStore.list()).toEqual([]);
    expect(outcomes).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("asks a human above the approval threshold", async () => {
    const approver = vi.fn(async () => true);
    const { fetch } = setup({ limits: [{ asset: USDC, perTx: usdc(1), approvalAbove: usdc("0.10") }] }, { approver });
    expect((await fetch("http://localhost/cheap")).status).toBe(200);
    expect(approver).not.toHaveBeenCalled();
    expect((await fetch("http://localhost/pricey")).status).toBe(200);
    expect(approver).toHaveBeenCalledOnce();
  });

  it("honours the kill switch", async () => {
    const { fetch, engine } = setup(policy);
    engine.kill("demo");
    await expect(fetch("http://localhost/cheap")).rejects.toThrow(/kill switch/);
  });

  it("denies payees outside the allow list", async () => {
    const { fetch } = setup({ ...policy, allow: { addresses: ["0x3333333333333333333333333333333333333333"] } });
    await expect(fetch("http://localhost/cheap")).rejects.toThrow(/not in allow list/);
  });
});
