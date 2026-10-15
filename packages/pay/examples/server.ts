/**
 * Paid API on Base Sepolia via the public x402 facilitator.
 *
 *   PAY_TO=0xYourAddress pnpm --filter @codkit/pay example:server
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { paywall } from "../src/server/hono.js";

const payTo = process.env.PAY_TO;
if (!payTo) throw new Error("set PAY_TO to the address that should receive payments");

const app = new Hono();
app.use(
  paywall({
    payTo,
    ...(process.env.X402_FACILITATOR_URL && { facilitator: process.env.X402_FACILITATOR_URL }),
    routes: {
      "GET /weather": { price: "$0.001", description: "Current weather", mimeType: "application/json" },
      "GET /premium/*": "$0.01",
    },
    onSettled: (p) => console.log(`[paid] ${p.amount} from ${p.payer} → https://sepolia.basescan.org/tx/${p.transaction}`),
  }),
);
app.get("/weather", (c) => c.json({ city: "Lisbon", tempC: 21, sky: "clear" }));
app.get("/premium/report", (c) => c.json({ report: "alpha" }));
app.get("/", (c) => c.text("free route — try /weather"));

const port = Number(process.env.PORT ?? 4021);
serve({ fetch: app.fetch, port });
console.log(`listening on http://localhost:${port}  (payTo ${payTo})`);
