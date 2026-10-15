/**
 * Kit tools as a local MCP server (stdio) for Claude Code / Claude Desktop / Cursor.
 *
 * Always: policy_check, policy_status, policy_halt, receipts_note/recent/verify.
 * With EVM_PRIVATE_KEY (Base Sepolia, throwaway key!): wallet_balance,
 * token_transfer and pay_fetch (x402), all bounded by the policy below.
 *
 *   claude mcp add kit -- pnpm --silent --dir /path/to/kit/packages/mcp example:server
 *
 * stdout is the MCP protocol — log to stderr only.
 */
import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";
import { createEvmGuard } from "@iamyoungjohn-kit/policy/evm";
import { createBudgetedFetch, registerExactEvmScheme, x402Client } from "@iamyoungjohn-kit/pay";
import { ed25519Signer, ReceiptLog, recordPolicyEvents } from "@iamyoungjohn-kit/receipts";
import { JsonlFileStore } from "@iamyoungjohn-kit/receipts/node";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { instrument, type AnyKitTool } from "../src/index.js";
import { serveStdio } from "../src/server.js";
import { evmTools } from "../src/tools/evm.js";
import { payTools } from "../src/tools/pay.js";
import { policyTools } from "../src/tools/policy.js";
import { receiptTools } from "../src/tools/receipts.js";

const log = (...a: unknown[]) => console.error("[kit-mcp]", ...a);
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia

const engine = createPolicyEngine({
  policy: {
    chains: ["eip155:84532"],
    allow: { programs: [USDC] },
    limits: [{ asset: USDC, label: "USDC", perTx: usdc("1"), perPeriod: { amount: usdc("5"), seconds: 86_400 } }],
  },
});

if (!process.env.RECEIPT_KEY) log("RECEIPT_KEY not set — using a throwaway receipt signing key");
const receipts = new ReceiptLog({
  signer: ed25519Signer(process.env.RECEIPT_KEY),
  store: new JsonlFileStore(process.env.RECEIPTS_FILE ?? ".agent/receipts.jsonl"),
});
recordPolicyEvents(engine, receipts);

const tools: AnyKitTool[] = [...policyTools(engine), ...receiptTools(receipts)];

const key = process.env.EVM_PRIVATE_KEY as Hex | undefined;
if (key) {
  const account = privateKeyToAccount(key);
  const transport = http(process.env.EVM_RPC_URL);
  const reader = createPublicClient({ chain: baseSepolia, transport });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const guard = createEvmGuard({ engine, chainId: baseSepolia.id, account: account.address, reader, sender: wallet });
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  tools.push(
    ...evmTools({ chainId: baseSepolia.id, account: account.address, guard, reader, tokens: { USDC: { address: USDC, decimals: 6 } } }),
    ...payTools({ fetch: createBudgetedFetch({ engine, client }) }),
  );
  log(`wallet ${account.address} on Base Sepolia`);
}

await serveStdio(instrument(tools, { receipts }), {
  name: "hackathon-kit",
  instructions:
    "Tools for an agent that spends testnet USDC under a policy. Check policy_status before spending, record rationale with receipts_note, and call policy_halt if anything looks wrong.",
});
log(`serving ${tools.length} tools over stdio`);
