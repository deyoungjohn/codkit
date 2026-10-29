import { usdc, type PolicyInput } from "@codkit/policy";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { PaymentOutcome } from "../src/index.js";
import { mcpPaywall, withPaidTools } from "../src/mcp.js";
import type { SettledPayment } from "../src/server/core.js";
import { agent, fakeFacilitator, NETWORK, PAY_TO, USDC } from "./helpers.js";

const policy: PolicyInput = {
  limits: [{ asset: USDC, label: "USDC", perTx: usdc("0.10"), perPeriod: { amount: usdc("0.20"), seconds: 3600 } }],
};

async function setup(opts: { onBeforeExecution?: () => boolean } = {}) {
  const facilitator = fakeFacilitator();
  const settled: SettledPayment[] = [];
  const paywall = mcpPaywall({
    payTo: PAY_TO,
    facilitator,
    tools: {
      report: { price: "$0.05", description: "premium report" },
      flaky: "$0.05",
      whale: "$0.50",
    },
    onSettled: (p) => {
      settled.push(p);
    },
    ...(opts.onBeforeExecution && { onBeforeExecution: opts.onBeforeExecution }),
  });

  let ran = 0;
  const server = new McpServer({ name: "shop", version: "1.0.0" });
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  server.registerTool("echo", { inputSchema: { msg: z.string() } }, paywall.wrap("echo", async ({ msg }) => text(msg)));
  server.registerTool(
    "report",
    { inputSchema: { topic: z.string() } },
    paywall.wrap("report", async ({ topic }) => {
      ran++;
      return text(`report on ${topic}`);
    }),
  );
  server.registerTool("flaky", { inputSchema: {} }, paywall.wrap("flaky", async () => ({ ...text("upstream down"), isError: true })));
  server.registerTool("whale", { inputSchema: {} }, paywall.wrap("whale", async () => text("expensive")));

  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const raw = new Client({ name: "agent", version: "1.0.0" });

  const { engine, client, account } = agent(policy);
  const outcomes: PaymentOutcome[] = [];
  const mcp = withPaidTools(raw, { client, engine, onPayment: (o) => outcomes.push(o) });
  await mcp.connect(clientSide);
  return { paywall, facilitator, settled, engine, account, mcp, raw, outcomes, ran: () => ran };
}

describe("paid MCP tools + policy-bound MCP client", () => {
  it("leaves unpriced tools free", async () => {
    const { mcp, paywall, facilitator } = await setup();
    expect(paywall.isPaid("echo")).toBe(false);
    const res = await mcp.callTool("echo", { msg: "hi" });
    expect(res).toMatchObject({ paymentMade: false, content: [{ type: "text", text: "hi" }] });
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it("answers an unpaid call with x402 PaymentRequired", async () => {
    const { raw } = await setup();
    const res = (await raw.callTool({ name: "report", arguments: { topic: "sol" } })) as {
      isError?: boolean;
      structuredContent?: { accepts?: unknown[] };
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    const required = res.structuredContent ?? JSON.parse(res.content[0]!.text);
    expect(required.accepts[0]).toMatchObject({ scheme: "exact", network: NETWORK, payTo: PAY_TO, asset: USDC, amount: "50000" });
  });

  it("pays within policy, runs the tool, settles and commits the spend", async () => {
    const { mcp, engine, settled, outcomes, account, ran } = await setup();
    const res = await mcp.callTool("report", { topic: "sol" });
    expect(res.content).toEqual([{ type: "text", text: "report on sol" }]);
    expect(res.paymentMade).toBe(true);
    const tx = `0x${"1".padStart(64, "0")}`;
    expect(res.paymentResponse).toMatchObject({ success: true, transaction: tx });
    expect(ran()).toBe(1);
    expect(await engine.spendStore.list()).toEqual([expect.objectContaining({ status: "committed", amount: usdc("0.05"), ref: tx })]);
    expect(outcomes).toEqual([expect.objectContaining({ status: "settled", transaction: tx })]);
    expect(settled).toEqual([
      expect.objectContaining({ transaction: tx, amount: "50000", payer: account.address, resource: "mcp://tool/report" }),
    ]);
  });

  it("refuses to sign above the per-tx cap; the server never sees a payment", async () => {
    const { mcp, engine, facilitator, outcomes } = await setup();
    await expect(mcp.callTool("whale", {})).rejects.toThrow(/policy: denied: .*exceeds per-tx cap/);
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(await engine.spendStore.list()).toEqual([]);
    expect(outcomes).toEqual([expect.objectContaining({ status: "blocked" })]);
  });

  it("does not charge for a tool that fails, and returns the budget", async () => {
    const { mcp, engine, facilitator, settled, outcomes } = await setup();
    const res = await mcp.callTool("flaky", {});
    expect(res.isError).toBe(true);
    expect(facilitator.settle).not.toHaveBeenCalled();
    expect(settled).toEqual([]);
    expect(outcomes).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("lets the server refuse after verification without charging", async () => {
    const { mcp, facilitator, ran } = await setup({ onBeforeExecution: () => false });
    const res = await mcp.callTool("report", { topic: "sol" });
    expect(res.isError).toBe(true);
    expect(ran()).toBe(0);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
});
