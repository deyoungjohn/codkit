/**
 * Demo mode (no API key): a scripted agent that calls the *real* tools — real
 * policy engine, real x402 signing against the in-process paywall, real
 * receipts — so every decision, block and approval on screen is genuine.
 * Only the "reasoning" text is canned.
 */
import { callTool } from "@codkit/mcp";
import type { Runtime } from "./runtime";
import { VENDOR_HOST } from "./runtime";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScenario(rt: Runtime, opts: { stepMs?: number } = {}) {
  const step = opts.stepMs ?? Number(process.env.DEMO_STEP_MS ?? 700);
  const tool = (name: string) => {
    const t = rt.tools.find((x) => x.name === name);
    if (!t) throw new Error(`missing tool ${name}`);
    return t;
  };
  const think = async (text: string) => {
    rt.feed.push({ kind: "thinking", text });
    await pause(step);
  };
  const say = async (text: string) => {
    rt.feed.push({ kind: "message", text });
    await pause(step);
  };
  const call = async (name: string, args: unknown) => {
    const res = await callTool(tool(name), args);
    await pause(step);
    return res;
  };
  const base = `http://${VENDOR_HOST}`;

  await think("Before buying anything I should check my spending limits and what I've spent today.");
  await call("policy_status", {});
  await think("Per-payment cap is 0.50 USDC, 1.00 USDC per day, and anything above 0.10 needs a human. Let me see the vendor's prices.");
  await call("pay_fetch", { url: `${base}/` });

  await think("ETH and SOL quotes are $0.01 each — well inside policy. Buying both.");
  await call("pay_fetch", { url: `${base}/price/eth` });
  await call("pay_fetch", { url: `${base}/price/sol` });

  await think("The market summary is $0.25: within the per-payment cap but above the approval threshold, so a human has to OK it.");
  const summary = await call("pay_fetch", { url: `${base}/report/summary` });
  if (!summary.ok) await call("receipts_note", { note: "Market summary not purchased: approval was declined or timed out." });

  await think("The full report is $2.00. Dry-run it against the policy first.");
  const check = await call("policy_check", {
    chain: "eip155:84532",
    kind: "x402_payment",
    to: "0x2222222222222222222222222222222222222222",
    spends: [{ asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "2000000" }],
  });
  await think("Denied: $2.00 exceeds the 0.50 USDC per-payment cap. To show the guardrail holds, I'll attempt it anyway — the payment must be refused before anything is signed.");
  await call("pay_fetch", { url: `${base}/report/full` });
  await call("receipts_note", { note: "Declined full report ($2.00): over per-payment cap. Bought ETH + SOL quotes and the summary instead.", tags: ["budget"] });

  const verify = await call("receipts_verify", {});
  await say(
    [
      "ETH: $3,120.55 · SOL: $182.10.",
      summary.ok ? "Market summary: risk-on week — ETH +4.2%, SOL +7.9%." : "Market summary: not purchased (no approval).",
      `Full report: not purchased — ${check.ok ? "it exceeds my per-payment cap" : "policy check failed"}.`,
      `Every step is in a signed, hash-chained receipt log (${verify.ok ? "verified" : "check failed"}).`,
    ].join("\n"),
  );
}
