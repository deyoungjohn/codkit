/**
 * codkit x402 end-to-end on Solana devnet, settled by the public facilitator.
 *
 *   pnpm e2e:x402-solana
 *
 * Agent: SOLANA_AGENT_KEYPAIR (a solana-keygen JSON file) holding devnet USDC
 * (https://faucet.circle.com) and a little SOL for the merchant's token account.
 * The merchant is a fresh keypair per run; the facilitator pays the payment fees.
 *
 * Steps: preflight → merchant USDC account (agent pays rent) → paywall answers 402
 * with the facilitator's fee payer → budgeted fetch pays $0.01, checked onchain →
 * paid MCP tool call pays $0.01, checked onchain → $0.50 purchase blocked by policy
 * before signing → receipts verify → merchant returns the USDC and closes its account.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createBudgetedFetch, x402Client, type PaymentOutcome } from "@codkit/pay";
import { paywall } from "@codkit/pay/hono";
import { mcpPaywall, withPaidTools } from "@codkit/pay/mcp";
import { registerExactSvmScheme, SOLANA_DEVNET, svmSchemes, USDC_DEVNET_ADDRESS } from "@codkit/pay/svm";
import { createPolicyEngine, usdc } from "@codkit/policy";
import { ed25519Signer, ReceiptLog, recordPolicyEvents, verifyLog } from "@codkit/receipts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
} from "@solana/kit";
import { Hono } from "hono";
import { z } from "zod";
import { Report } from "./report.js";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WS_URL = process.env.SOLANA_WS_URL || RPC_URL.replace(/^http/, "ws");
const FACILITATOR = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const MINT = address(USDC_DEVNET_ADDRESS);
const DECIMALS = 6;

const keyPath = (process.env.SOLANA_AGENT_KEYPAIR ?? "").replace(/^~/, homedir());
if (!keyPath || !existsSync(keyPath)) throw new Error("set SOLANA_AGENT_KEYPAIR to a solana-keygen JSON file (a testnet-only agent key)");
const agent = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(keyPath, "utf8"))));
const merchant = await generateKeyPairSigner();

const rpc = createSolanaRpc(RPC_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL) });

/** Agent pays the fee; other signers ride along on the instructions' account metas. */
async function send(instructions: Instruction[]): Promise<string> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(agent, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  assertIsTransactionWithBlockhashLifetime(tx);
  await sendAndConfirm(tx, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}

const tokenBalance = async (account: Address): Promise<bigint | null> => {
  const { value } = await rpc.getAccountInfo(account, { encoding: "base64", commitment: "confirmed" }).send();
  if (!value) return null;
  const bytes = Uint8Array.from(atob((value.data as [string, string])[0]), (c) => c.charCodeAt(0));
  return new DataView(bytes.buffer).getBigUint64(64, true);
};

/** Public RPCs are load-balanced: wait until the node we hit has seen the settlement. */
async function waitForBalance(account: Address, atLeast: bigint, timeoutMs = 60_000): Promise<bigint> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const b = (await tokenBalance(account)) ?? 0n;
    if (b >= atLeast || Date.now() > until) return b;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const [agentAta] = await findAssociatedTokenPda({ owner: agent.address, mint: MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const [merchantAta] = await findAssociatedTokenPda({ owner: merchant.address, mint: MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const report = new Report("x402-solana-devnet", { agent: agent.address, merchant: merchant.address, facilitator: FACILITATOR, asset: MINT });

// Guardrails: $0.10 per payment, $0.05 per hour.
const engine = createPolicyEngine({
  policy: { chains: [SOLANA_DEVNET], limits: [{ asset: MINT, label: "USDC", perTx: usdc("0.10"), perPeriod: { amount: usdc("0.05"), seconds: 3600 } }] },
});
const receipts = new ReceiptLog({ signer: ed25519Signer() });
recordPolicyEvents(engine, receipts, { include: ["decision", "committed"] });
const outcomes: PaymentOutcome[] = [];
const newClient = () => registerExactSvmScheme(new x402Client(), { signer: agent, networks: [SOLANA_DEVNET] });

// The merchant: an HTTP paywall and a paid MCP tool, both settling through the public facilitator.
const app = new Hono();
app.use(paywall({ network: SOLANA_DEVNET, payTo: merchant.address, schemes: svmSchemes(), facilitator: FACILITATOR, routes: { "GET /price": "$0.01", "GET /report": "$0.50" } }));
app.get("/price", (c) => c.json({ asset: "SOL", usd: 182.1 }));
app.get("/report", (c) => c.json({ report: "…" }));
const fetchPaid = createBudgetedFetch({
  engine,
  client: newClient(),
  fetch: async (i, init) => app.fetch(new Request(i, init)),
  onPayment: (o) => outcomes.push(o),
});

let ataCreated = false;
try {
  await report.step(
    "preflight balances",
    async () => {
      const { value: lamports } = await rpc.getBalance(agent.address, { commitment: "confirmed" }).send();
      const usdcBal = (await tokenBalance(agentAta)) ?? 0n;
      if (lamports < 5_000_000n) throw new Error(`agent has ${Number(lamports) / 1e9} SOL; needs ≥ 0.005 for the merchant's token account`);
      if (usdcBal < usdc("0.05")) throw new Error(`agent has ${Number(usdcBal) / 1e6} USDC; get devnet USDC from https://faucet.circle.com`);
      return { detail: `${Number(lamports) / 1e9} SOL, ${Number(usdcBal) / 1e6} USDC` };
    },
    { critical: true },
  );

  await report.step(
    "merchant USDC account (agent pays rent)",
    async () => {
      const ix = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: agent, owner: merchant.address, mint: MINT });
      const sig = await send([ix]);
      ataCreated = true;
      return { detail: merchantAta, links: [explorer(sig)] };
    },
    { critical: true },
  );

  await report.step("paywall answers 402 with the facilitator's fee payer", async () => {
    const res = await app.request("/price");
    if (res.status !== 402) throw new Error(`expected 402, got ${res.status}`);
    const req = JSON.parse(Buffer.from(res.headers.get("PAYMENT-REQUIRED")!, "base64").toString()).accepts[0];
    if (req.network !== SOLANA_DEVNET || req.asset !== MINT || req.amount !== "10000" || !req.extra?.feePayer) {
      throw new Error(`unexpected requirements ${JSON.stringify(req)}`);
    }
    return { detail: `$0.01 USDC to ${req.payTo.slice(0, 4)}…, fee payer ${req.extra.feePayer}` };
  });

  await report.step("budgeted fetch pays $0.01 (HTTP x402)", async () => {
    const res = await fetchPaid("http://merchant.local/price");
    if (res.status !== 200) throw new Error(`status ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const o = outcomes.at(-1);
    if (o?.status !== "settled") throw new Error(`payment ${o?.status ?? "missing"}`);
    const bal = await waitForBalance(merchantAta, usdc("0.01"));
    if (bal < usdc("0.01")) throw new Error(`merchant balance ${bal} after settlement`);
    return { detail: `settled; merchant holds ${Number(bal) / 1e6} USDC`, links: [explorer(o.transaction)] };
  });

  await report.step("paid MCP tool call pays $0.01 (x402 over MCP)", async () => {
    const tools = mcpPaywall({ network: SOLANA_DEVNET, payTo: merchant.address, schemes: svmSchemes(), facilitator: FACILITATOR, tools: { premium_quote: "$0.01" } });
    const server = new McpServer({ name: "merchant", version: "1.0.0" });
    server.registerTool(
      "premium_quote",
      { inputSchema: { asset: z.string() } },
      tools.wrap("premium_quote", async ({ asset }) => ({ content: [{ type: "text" as const, text: `${asset}: 182.10 USD` }] })),
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const mcp = withPaidTools(new Client({ name: "agent", version: "1.0.0" }), { engine, client: newClient(), onPayment: (o) => outcomes.push(o) });
    await mcp.connect(b);
    const res = await mcp.callTool("premium_quote", { asset: "SOL" });
    await mcp.close();
    if (res.isError || !res.paymentResponse?.success) throw new Error(`tool result ${JSON.stringify(res).slice(0, 300)}`);
    const bal = await waitForBalance(merchantAta, usdc("0.02"));
    if (bal < usdc("0.02")) throw new Error(`merchant balance ${bal} after settlement`);
    return { detail: `"${(res.content[0] as unknown as { text: string }).text}"; merchant holds ${Number(bal) / 1e6} USDC`, links: [explorer(res.paymentResponse.transaction)] };
  });

  await report.step("$0.50 report blocked by policy before signing", async () => {
    const before = await tokenBalance(merchantAta);
    try {
      await fetchPaid("http://merchant.local/report");
      throw new Error("payment was not blocked");
    } catch (e) {
      if (!/policy: denied: .*per-tx cap/.test(String(e))) throw e;
    }
    if ((await tokenBalance(merchantAta)) !== before) throw new Error("merchant balance changed");
    return { detail: "denied: exceeds the $0.10 per-tx cap; nothing signed" };
  });

  await report.step("spend ledger and receipts", async () => {
    const spends = await engine.spendStore.list();
    if (spends.length !== 2 || spends.some((s) => s.status !== "committed")) throw new Error(`ledger ${JSON.stringify(spends, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    const log = await receipts.list();
    const v = await verifyLog(log);
    if (!v.ok) throw new Error(`receipt log does not verify: ${JSON.stringify(v)}`);
    return { detail: `2 committed spends ($0.02 of $0.05/h); ${log.length} signed receipts verify` };
  });
} finally {
  if (ataCreated) {
    await report.step("merchant returns the USDC and closes its account", async () => {
      const bal = (await tokenBalance(merchantAta)) ?? 0n;
      const ixs: Instruction[] = [];
      if (bal > 0n) {
        ixs.push(getTransferCheckedInstruction({ source: merchantAta, mint: MINT, destination: agentAta, authority: merchant, amount: bal, decimals: DECIMALS }));
      }
      ixs.push(getCloseAccountInstruction({ account: merchantAta, destination: agent.address, owner: merchant }));
      const sig = await send(ixs);
      return { detail: `${Number(bal) / 1e6} USDC back to the agent, rent refunded`, links: [explorer(sig)] };
    });
  }
  const file = report.save();
  console.log(`\n${report.ok ? "PASS" : "FAIL"} — report: ${file}`);
  process.exitCode = report.ok ? 0 : 1;
}
