/**
 * Payment links + QR codes, and a signed webhook round trip. No funds needed.
 *
 *   pnpm --filter @codkit/pay example:links
 *   PAY_TO=0x… pnpm --filter @codkit/pay example:links   # your own address
 */
import { usdc } from "@codkit/policy";
import { renderUnicodeCompact } from "uqr";
import { paymentLink } from "../src/links.js";
import { SIGNATURE_HEADER, verifyWebhook, webhookSender } from "../src/webhooks.js";

const evmTo = process.env.PAY_TO ?? "0x2222222222222222222222222222222222222222";
const solTo = process.env.SOL_PAY_TO ?? "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const evm = paymentLink({ chain: "eip155:84532", to: evmTo, amount: usdc("1.50") });
const sol = paymentLink({ chain: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", to: solTo, amount: usdc("1.50"), label: "codkit demo", message: "Order #1" });

console.log(`Base Sepolia (EIP-681):\n${evm}\n`);
console.log(renderUnicodeCompact(evm));
console.log(`\nSolana devnet (Solana Pay):\n${sol}\n`);
console.log(renderUnicodeCompact(sol));

// Webhook: the sender signs, the receiver verifies. Here the "receiver" is an in-process fetch.
const secret = "whsec_example_only_0123456789";
const hooks = webhookSender({
  url: "https://shop.example/webhooks/payments",
  secret,
  fetch: async (_url, init) => {
    const event = await verifyWebhook({ body: init!.body as string, signature: new Headers(init!.headers).get(SIGNATURE_HEADER), secret });
    console.log(`\nwebhook received and verified: ${event.type} ${JSON.stringify(event.data)}`);
    return new Response(null, { status: 204 });
  },
});
await hooks.send("payment.settled", { network: "eip155:84532", transaction: "0x…", amount: "1500000", payTo: evmTo });
