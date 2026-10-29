import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPolicyEngine, usdc } from "@codkit/policy";
import { generateKeyPairSigner, getBase58Decoder } from "@solana/kit";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBudgetedFetch, x402Client, type PaymentOutcome } from "../src/index.js";
import { paywall, type SettledPayment } from "../src/server/hono.js";
import { ExactSvmScheme, SOLANA_DEVNET, svmSchemes, USDC_DEVNET_ADDRESS } from "../src/svm.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PAY_TO = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const FEE_PAYER = "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9";

/** Minimal Solana JSON-RPC: the USDC mint account and a blockhash, which is all the exact client reads. */
function fakeRpc(): Promise<{ url: string; server: Server }> {
  const mint = new Uint8Array(82);
  mint[44] = 6; // decimals
  mint[45] = 1; // is_initialized
  const blockhash = getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)));
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method } = JSON.parse(body);
      const context = { slot: 1 };
      const result =
        method === "getLatestBlockhash"
          ? { context, value: { blockhash, lastValidBlockHeight: 1000 } }
          : method === "getAccountInfo"
            ? {
                context,
                value: { data: [Buffer.from(mint).toString("base64"), "base64"], executable: false, lamports: 1_461_600, owner: TOKEN_PROGRAM, rentEpoch: 0, space: 82 },
              }
            : undefined;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code: -32601, message: method } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server })));
}

function fakeFacilitator() {
  let n = 0;
  return {
    verify: vi.fn(async (p: PaymentPayload, r: PaymentRequirements) =>
      p.accepted.amount === r.amount && p.accepted.payTo === r.payTo && typeof (p.payload as { transaction?: unknown }).transaction === "string"
        ? { isValid: true, payer: "payer" }
        : { isValid: false, invalidReason: "mismatch" },
    ),
    settle: vi.fn(async (_p: PaymentPayload, r: PaymentRequirements) => ({ success: true, transaction: `sig${++n}`, network: r.network, payer: "payer" })),
    getSupported: vi.fn(async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: SOLANA_DEVNET, extra: { feePayer: FEE_PAYER } }],
      extensions: [],
      signers: {},
    })),
  } satisfies FacilitatorClient;
}

let rpc: Awaited<ReturnType<typeof fakeRpc>>;
beforeAll(async () => {
  rpc = await fakeRpc();
});
afterAll(() => rpc.server.close());

async function setup() {
  const facilitator = fakeFacilitator();
  const settled: SettledPayment[] = [];
  const app = new Hono();
  app.use(
    paywall({
      network: SOLANA_DEVNET,
      payTo: PAY_TO,
      facilitator,
      schemes: svmSchemes(),
      routes: { "GET /cheap": "$0.01", "GET /pricey": "$0.50" },
      onSettled: (p) => {
        settled.push(p);
      },
    }),
  );
  app.get("/cheap", (c) => c.json({ data: "cheap" }));
  app.get("/pricey", (c) => c.json({ data: "pricey" }));

  const engine = createPolicyEngine({
    policy: { chains: [SOLANA_DEVNET], limits: [{ asset: USDC_DEVNET_ADDRESS, label: "USDC", perTx: usdc("0.10") }] },
  });
  const client = new x402Client();
  client.register(SOLANA_DEVNET, new ExactSvmScheme(await generateKeyPairSigner(), { rpcUrl: rpc.url }));
  const outcomes: PaymentOutcome[] = [];
  const fetch = createBudgetedFetch({
    engine,
    client,
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    onPayment: (o) => outcomes.push(o),
  });
  return { app, facilitator, settled, engine, fetch, outcomes };
}

describe("x402 on Solana (exact SVM scheme)", () => {
  it("advertises USDC on devnet with the facilitator's fee payer", async () => {
    const { app } = await setup();
    const res = await app.request("/cheap");
    expect(res.status).toBe(402);
    const required = JSON.parse(Buffer.from(res.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: SOLANA_DEVNET,
      payTo: PAY_TO,
      asset: USDC_DEVNET_ADDRESS,
      amount: "10000",
      extra: { feePayer: FEE_PAYER },
    });
  });

  it("signs a transfer transaction within policy and commits the spend", async () => {
    const { fetch, engine, facilitator, settled, outcomes } = await setup();
    const res = await fetch("http://localhost/cheap");
    expect(res.status).toBe(200);
    expect(facilitator.verify).toHaveBeenCalledOnce();
    expect(await engine.spendStore.list()).toEqual([
      expect.objectContaining({ status: "committed", amount: usdc("0.01"), ref: "sig1", chain: SOLANA_DEVNET }),
    ]);
    expect(outcomes).toEqual([expect.objectContaining({ status: "settled", transaction: "sig1" })]);
    expect(settled).toEqual([expect.objectContaining({ transaction: "sig1", payTo: PAY_TO, asset: USDC_DEVNET_ADDRESS })]);
  });

  it("refuses to sign above the per-tx cap", async () => {
    const { fetch, facilitator, outcomes } = await setup();
    await expect(fetch("http://localhost/pricey")).rejects.toThrow(/policy: denied: .*exceeds per-tx cap/);
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(outcomes).toEqual([expect.objectContaining({ status: "blocked" })]);
  });

  it("asks for a scheme when a Solana route has none", () => {
    expect(() => paywall({ network: SOLANA_DEVNET, payTo: PAY_TO, facilitator: fakeFacilitator(), routes: { "GET /x": "$0.01" } })).toThrow(
      /svmSchemes\("solana:EtWT/,
    );
  });
});
