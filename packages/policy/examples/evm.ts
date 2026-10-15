/**
 * Guarded EVM sends on Base Sepolia with viem.
 *
 *   pnpm --filter @iamyoungjohn-kit/policy example:evm            # dry run: policy + simulation only
 *   EVM_PRIVATE_KEY=0x... pnpm --filter @iamyoungjohn-kit/policy example:evm -- --send
 *
 * Without a key a throwaway account is used, so the simulation fails with
 * "insufficient funds" and the guard refuses to send — which is the point.
 */
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createEvmGuard, evmExplorerTxUrl } from "../src/adapters/evm.js";
import { createPolicyEngine, isPolicyError, usdc } from "../src/index.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const send = process.argv.includes("--send");
const key = (process.env.EVM_PRIVATE_KEY as Hex | undefined) ?? generatePrivateKey();
const account = privateKeyToAccount(key);
const transport = http(process.env.EVM_RPC_URL);

const reader = createPublicClient({ chain: baseSepolia, transport });
const wallet = createWalletClient({ account, chain: baseSepolia, transport });

const engine = createPolicyEngine({
  policy: {
    chains: [`eip155:${baseSepolia.id}`],
    allow: { programs: [USDC] },
    limits: [{ asset: USDC, label: "USDC", perTx: usdc("0.10"), perPeriod: { amount: usdc(1), seconds: 3600 } }],
  },
  onEvent: (e) => {
    if (e.type === "decision") console.log(`[policy] ${e.decision.verdict} ${e.decision.reasons.join("; ")}`);
    if (e.type === "simulation") console.log(`[simulate] ${e.result.ok ? "ok" : `failed: ${e.result.error}`}`);
  },
});

const guard = createEvmGuard({
  engine,
  chainId: baseSepolia.id,
  account: account.address,
  reader,
  ...(send && { sender: wallet }),
});

const tx = {
  to: USDC,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account.address, usdc("0.01")] }),
} as const;

console.log(`agent ${account.address}${process.env.EVM_PRIVATE_KEY ? "" : " (throwaway)"}`);
console.log("action:", guard.toAction(tx));

try {
  if (send) {
    const { result: hash } = await guard.send(tx);
    console.log("sent:", evmExplorerTxUrl(baseSepolia.id, hash));
  } else {
    console.log("decision:", (await engine.evaluate(guard.toAction(tx))).verdict);
    console.log("simulation:", await guard.simulate(tx));
    console.log("\n(dry run — pass --send with a funded EVM_PRIVATE_KEY to broadcast)");
  }
} catch (e) {
  if (isPolicyError(e)) console.log(`blocked: ${e.code} — ${e.message}`);
  else throw e;
}
