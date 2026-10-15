/**
 * No chain needed: shows how decisions, reservations, approval and the kill
 * switch behave for a toy "agent pays a vendor in USDC" flow.
 *
 *   pnpm --filter @codkit/policy example
 */
import { createPolicyEngine, fromAtomic, isPolicyError, usdc, type Action } from "../src/index.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia
const VENDOR = "0x1111111111111111111111111111111111111111";
const SCAMMER = "0x6666666666666666666666666666666666666666";

const engine = createPolicyEngine({
  policy: {
    chains: ["eip155:84532"],
    deny: { addresses: [SCAMMER] },
    limits: [
      { asset: USDC, label: "USDC", perTx: usdc(5), perPeriod: { amount: usdc(8), seconds: 86_400 }, approvalAbove: usdc(3) },
    ],
  },
  // Swap for a Telegram button / dashboard click in a real project.
  approver: async ({ action, decision }) => {
    console.log(`  [approver] asked about ${fmt(action)} because: ${decision.reasons.join("; ")} → approving`);
    return { approved: true, by: "demo-human" };
  },
  onEvent: (e) => {
    if (e.type === "decision") console.log(`  [policy] ${e.decision.verdict}${e.decision.reasons.length ? ` — ${e.decision.reasons.join("; ")}` : ""}`);
  },
});

const pay = (amount: bigint, to = VENDOR): Action => ({
  chain: "eip155:84532",
  kind: "token_transfer",
  to,
  program: USDC,
  method: "transfer",
  spends: [{ asset: USDC, amount }],
});

function fmt(a: Action) {
  return `${fromAtomic(a.spends[0]!.amount, 6)} USDC → ${a.to.slice(0, 8)}…`;
}

async function attempt(label: string, action: Action) {
  console.log(`\n${label}: ${fmt(action)}`);
  try {
    const { result } = await engine.execute(action, {
      simulate: async () => ({ ok: true, details: { note: "pretend eth_call succeeded" } }),
      execute: async () => `0x${Math.random().toString(16).slice(2).padEnd(64, "0")}`,
      ref: (hash) => hash,
    });
    console.log(`  ✓ sent ${result.slice(0, 18)}…`);
  } catch (e) {
    if (isPolicyError(e)) console.log(`  ✗ blocked (${e.code})`);
    else throw e;
  }
}

await attempt("small payment", pay(usdc(2)));
await attempt("needs approval", pay(usdc(4)));
await attempt("over daily budget", pay(usdc(3)));
await attempt("denied address", pay(usdc(1), SCAMMER));
engine.kill("operator hit the big red button");
await attempt("after kill switch", pay(usdc(1)));
