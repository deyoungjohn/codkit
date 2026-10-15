/**
 * Claude as a shopping agent with a budget: it buys data from x402 paywalls,
 * the policy engine bounds what it can spend, and every step lands in a signed
 * receipt log. Paywall + facilitator run in-process, so no wallet funds needed —
 * only Anthropic API access (ANTHROPIC_API_KEY or `ant auth login`).
 *
 *   pnpm --filter @iamyoungjohn-kit/mcp example:agent
 */
import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";
import { createBudgetedFetch, registerExactEvmScheme, x402Client } from "@iamyoungjohn-kit/pay";
import { paywall } from "@iamyoungjohn-kit/pay/hono";
import { ed25519Signer, ReceiptLog, recordPolicyEvents, verifyLog } from "@iamyoungjohn-kit/receipts";
import type { FacilitatorClient } from "@x402/core/server";
import { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { instrument } from "../src/index.js";
import { runAgent } from "../src/claude.js";
import { payTools } from "../src/tools/pay.js";
import { policyTools } from "../src/tools/policy.js";
import { receiptTools } from "../src/tools/receipts.js";

// --- a data vendor with three paid endpoints (local, fake settlement) -------
let txs = 0;
const facilitator: FacilitatorClient = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true }),
  settle: async (_p, r) => ({ success: true, network: r.network, transaction: `0x${(++txs).toString(16).padStart(64, "0")}` }),
};
const vendor = new Hono();
vendor.use(
  paywall({
    payTo: "0x2222222222222222222222222222222222222222",
    facilitator,
    routes: { "GET /price/eth": "$0.01", "GET /price/sol": "$0.01", "GET /report/full": "$2.00" },
  }),
);
vendor.get("/", (c) => c.json({ endpoints: { "/price/eth": "$0.01", "/price/sol": "$0.01", "/report/full": "$2.00 deep market report" } }));
vendor.get("/price/eth", (c) => c.json({ asset: "ETH", usd: 3120.55 }));
vendor.get("/price/sol", (c) => c.json({ asset: "SOL", usd: 182.1 }));
vendor.get("/report/full", (c) => c.json({ report: "…" }));

// --- the agent's guardrails, wallet and receipts ----------------------------
const engine = createPolicyEngine({
  policy: {
    limits: [{ asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", label: "USDC", perTx: usdc("0.50"), perPeriod: { amount: usdc("1"), seconds: 3600 } }],
  },
});
const receipts = new ReceiptLog({ signer: ed25519Signer() });
recordPolicyEvents(engine, receipts, { include: ["decision", "committed"] });
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
const fetchPaid = createBudgetedFetch({ engine, client, fetch: async (i, init) => vendor.fetch(new Request(i, init)) });

const tools = instrument([...payTools({ fetch: fetchPaid, allowedHosts: ["vendor.local"] }), ...policyTools(engine), ...receiptTools(receipts)], {
  onEvent: (e) => console.log(e.type === "tool_call" ? `  → ${e.name} ${JSON.stringify(e.input)}` : `  ← ${e.name} ${e.ok ? "ok" : `ERROR ${e.output}`} (${e.ms}ms)`),
});

// --- run -------------------------------------------------------------------
const res = await runAgent({
  tools,
  system:
    "You are a research agent with a small USDC budget, paying for data via x402. Check your budget before buying, never try to evade the spending policy, and note the rationale for purchasing decisions with receipts_note. Be concise.",
  prompt:
    "The data vendor is at http://vendor.local/. Get me current ETH and SOL prices. If the full market report fits the budget, buy it too; otherwise explain why not.",
  onEvent: (e) => {
    if (e.type === "thinking") console.log(`  💭 ${e.text.replace(/\s+/g, " ").slice(0, 200)}`);
    if (e.type === "turn") console.log(`  [turn: ${e.stopReason}, ${e.usage.input_tokens} in / ${e.usage.output_tokens} out]`);
  },
});

console.log(`\n${res.text}\n`);
const log = await receipts.list();
console.log(`receipts: ${log.length} entries, ${log.map((r) => r.type).join(", ")}`);
console.log(`log verifies: ${(await verifyLog(log)).ok}; settled payments: ${txs}`);
