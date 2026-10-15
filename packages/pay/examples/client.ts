/**
 * Agent-side: pay x402 endpoints with a testnet USDC wallet, bounded by policy.
 * Fund the key with Base Sepolia USDC from https://faucet.circle.com.
 *
 *   EVM_PRIVATE_KEY=0x... pnpm --filter @iamyoungjohn-kit/pay example:client -- http://localhost:4021/weather
 */
import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";
import { privateKeyToAccount } from "viem/accounts";
import { createBudgetedFetch, registerExactEvmScheme, x402Client } from "../src/index.js";

const key = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("set EVM_PRIVATE_KEY (throwaway testnet key)");
const url = process.argv.slice(2).find((a) => a.startsWith("http")) ?? "http://localhost:4021/weather";

const engine = createPolicyEngine({
  policy: {
    chains: ["eip155:84532"],
    limits: [
      {
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
        label: "USDC",
        perTx: usdc("0.05"),
        perPeriod: { amount: usdc("0.50"), seconds: 86_400 },
      },
    ],
  },
});

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(key) });

const fetchPaid = createBudgetedFetch({
  engine,
  client,
  onPayment: (o) => console.log(`[payment] ${o.status}`, o.status === "settled" ? o.transaction : o.status === "failed" ? o.reason : o.error.message),
});

const res = await fetchPaid(url);
console.log(res.status, await res.text());
