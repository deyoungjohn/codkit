# @codkit/pay

x402 payments for agents. This package is a thin layer over the official [`@x402/*` v2 SDK](https://github.com/x402-foundation/x402) and adds two things:

1. **`paywall()`**: one-call Hono / Express middleware. It defaults to Base Sepolia and the public testnet facilitator, accepts a `"$0.01"` route shorthand, and has an `onSettled` hook for receipts and live feeds.
2. **`createBudgetedFetch()` / `withPolicy()`**: an x402 client that won't sign a payment unless [`@codkit/policy`](https://github.com/deyoungjohn/codkit/tree/main/packages/policy) authorizes it. Spend is reserved first, then committed with the settlement tx hash, or released if the payment fails.

## Install

```bash
npm install @codkit/pay @codkit/policy
npm install hono @x402/hono                                 # for @codkit/pay/hono
npm install express @x402/express && npm i -D @types/express # for @codkit/pay/express
npm install @x402/mcp @modelcontextprotocol/sdk               # for @codkit/pay/mcp
```

The server frameworks are optional peer dependencies, so install only the one you use.

## Server

```ts
import { Hono } from "hono";
import { paywall } from "@codkit/pay/hono"; // or "@codkit/pay/express"

const app = new Hono();
app.use(paywall({
  payTo: "0xYourAddress",
  routes: {
    "GET /weather": "$0.001",
    "GET /report": { price: "$0.05", description: "Deep research report" },
  },
  onSettled: (p) => feed.push(p), // { network, transaction, payer, amount, asset, payTo, resource }
}));
```

Options: `network` (default `eip155:84532`), `facilitator` (URL or `FacilitatorClient`), `schemes` (add `ExactSvmScheme` from `@x402/svm` for Solana), and full x402 route configs, which are passed through unchanged.

## Client (agent side)

```ts
import { createPolicyEngine, usdc } from "@codkit/policy";
import { createBudgetedFetch, registerExactEvmScheme, x402Client } from "@codkit/pay";

const engine = createPolicyEngine({ policy: { limits: [{ asset: USDC, perTx: usdc("0.05"), perPeriod: { amount: usdc(1), seconds: 86_400 } }] } });
const client = new x402Client();
registerExactEvmScheme(client, { signer: account }); // viem account

const fetchPaid = createBudgetedFetch({ engine, client, onPayment: (o) => console.log(o.status) });
const res = await fetchPaid("https://api.example.com/weather");
```

Blocked payments throw before anything is signed, with a message like `policy: denied: USDC: … exceeds per-tx cap …`. They also emit `onPayment({ status: "blocked", error })`. To guard other transports (axios, MCP) built on the same `x402Client`, call `withPolicy(client, { engine })` directly.

x402's own client-side `spendControls` (default: known stablecoins only, $1 per payment) remain active as a second layer.

## Paid MCP tools

`@codkit/pay/mcp` charges per tool call over MCP. It's a thin layer over [`@x402/mcp`](https://www.npmjs.com/package/@x402/mcp): the payment travels in `_meta["x402/payment"]`, and an unpaid call gets a 402 result carrying x402 `PaymentRequired`.

```ts
import { mcpPaywall } from "@codkit/pay/mcp";
import { createMcpServer } from "@codkit/mcp/server";

const paywall = mcpPaywall({
  payTo: "0xYourAddress",
  tools: { premium_report: { price: "$0.05", description: "Deep research report" } }, // unlisted tools stay free
  onSettled: (p) => receipts.append("payment.settled", p),                         // resource: "mcp://tool/premium_report"
});
createMcpServer(tools, { name: "data-shop", wrapHandler: paywall.wrap });
// or with a plain McpServer: server.registerTool("premium_report", config, paywall.wrap("premium_report", handler))
```

The tool runs only after the payment is verified, and the payment is settled only if the tool succeeds, so a tool error costs the caller nothing. `onBeforeExecution` can refuse a verified call (rate limits, say) without charging.

On the agent side, `withPaidTools` puts an MCP client behind the same policy engine as `createBudgetedFetch`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { withPaidTools } from "@codkit/pay/mcp";

const mcp = withPaidTools(new Client({ name: "agent", version: "1.0.0" }), { client, engine });
await mcp.connect(transport);
const res = await mcp.callTool("premium_report", { topic: "SOL" }); // { content, paymentMade, paymentResponse }
```

## Examples

```bash
pnpm --filter @codkit/pay example:local                                  # whole loop in-process, no funds
PAY_TO=0x… pnpm --filter @codkit/pay example:server                      # real paywall on Base Sepolia
EVM_PRIVATE_KEY=0x… pnpm --filter @codkit/pay example:client -- http://localhost:4021/weather
```

The client example needs Base Sepolia USDC, which you can get from https://faucet.circle.com.

## Not yet

FastAPI middleware, plain USDC transfers, payment links / QR, and webhooks are planned for this package.
