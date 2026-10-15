# @codkit/pay

x402 payments for agents. This package is a thin layer over the official [`@x402/*` v2 SDK](https://github.com/x402-foundation/x402) and adds two things:

1. **`paywall()`**: one-call Hono / Express middleware. It defaults to Base Sepolia and the public testnet facilitator, accepts a `"$0.01"` route shorthand, and has an `onSettled` hook for receipts and live feeds.
2. **`createBudgetedFetch()` / `withPolicy()`**: an x402 client that won't sign a payment unless [`@codkit/policy`](../policy) authorizes it. Spend is reserved first, then committed with the settlement tx hash, or released if the payment fails.

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

## Examples

```bash
pnpm --filter @codkit/pay example:local                                  # whole loop in-process, no funds
PAY_TO=0x… pnpm --filter @codkit/pay example:server                      # real paywall on Base Sepolia
EVM_PRIVATE_KEY=0x… pnpm --filter @codkit/pay example:client -- http://localhost:4021/weather
```

The client example needs Base Sepolia USDC, which you can get from https://faucet.circle.com.

## Not yet

MCP paid-tool wrapper, FastAPI middleware, plain USDC transfers, payment links / QR, and webhooks are planned for this package.
