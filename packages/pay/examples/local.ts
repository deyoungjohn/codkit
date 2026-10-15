/**
 * Whole loop in one process, no funds or network needed: a Hono paywall with an
 * in-memory facilitator and an agent with a $0.03/hour budget hitting it until
 * the policy says stop. Good for the first 30 seconds of a demo video.
 *
 *   pnpm --filter @codkit/pay example:local
 */
import { createPolicyEngine, fromAtomic, usdc } from "@codkit/policy";
import type { FacilitatorClient } from "@x402/core/server";
import { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createBudgetedFetch, registerExactEvmScheme, x402Client } from "../src/index.js";
import { paywall } from "../src/server/hono.js";

const NETWORK = "eip155:84532";
let txs = 0;
const facilitator: FacilitatorClient = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true }),
  settle: async (_p, r) => ({ success: true, network: r.network, transaction: `0xfake${(++txs).toString().padStart(60, "0")}` }),
};

const app = new Hono();
app.use(paywall({ payTo: "0x2222222222222222222222222222222222222222", facilitator, routes: { "GET /quote": "$0.01" } }));
app.get("/quote", (c) => c.json({ quote: "Ship the demo, not the roadmap." }));

const engine = createPolicyEngine({
  policy: {
    limits: [{ asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", label: "USDC", perTx: usdc("0.05"), perPeriod: { amount: usdc("0.03"), seconds: 3600 } }],
  },
  onEvent: (e) => {
    if (e.type === "decision") console.log(`  policy: ${e.decision.verdict}${e.decision.reasons.length ? ` (${e.decision.reasons.join("; ")})` : ""}`);
  },
});
const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(generatePrivateKey()) });
const fetchPaid = createBudgetedFetch({
  engine,
  client,
  fetch: async (input, init) => app.fetch(new Request(input, init)),
});

for (let i = 1; i <= 4; i++) {
  console.log(`request #${i}`);
  try {
    const res = await fetchPaid("http://local/quote");
    console.log(`  ${res.status}`, await res.json());
  } catch (e) {
    console.log(`  blocked: ${(e as Error).message}`);
  }
}
const spent = (await engine.spendStore.list()).reduce((s, r) => s + r.amount, 0n);
console.log(`\nspent ${fromAtomic(spent, 6)} USDC in ${txs} settled payments`);
