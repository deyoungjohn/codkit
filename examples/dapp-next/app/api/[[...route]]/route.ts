import { paywall } from "@codkit/pay/hono";
import { Hono } from "hono";
import { handle } from "hono/vercel";

export const runtime = "nodejs";

// A paid endpoint: x402 on Base Sepolia, settled by the public testnet facilitator (x402.org).
// Unpaid requests get HTTP 402 and the price; <PayButton> on the page pays it from the connected wallet.
const app = new Hono().basePath("/api");
app.use(
  paywall({
    payTo: (process.env.PAY_TO as `0x${string}` | undefined) ?? "0x000000000000000000000000000000000000dEaD",
    routes: { "GET /api/paid/price": { price: "$0.001", description: "ETH price" } },
  }),
);
app.get("/paid/price", (c) => c.json({ asset: "ETH", usd: 3120.55, at: new Date().toISOString() }));

export const GET = handle(app);
