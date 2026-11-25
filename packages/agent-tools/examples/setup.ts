/** Shared by the examples: one Base Sepolia agent wallet, Uniswap v3, tiny per-call caps, a policy engine. */
import { getRpcUrl } from "@codkit/config";
import { createPolicyEngine, toAtomic } from "@codkit/policy";
import { createPublicClient, createWalletClient, type Hex, http, nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { agentTools } from "../src/index.js";
import { evmChain } from "../src/evm.js";
import { uniswapV3 } from "../src/uniswap.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CHAIN = "eip155:84532";

export function setup(opts: { dryRun: boolean }) {
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("set AGENT_PRIVATE_KEY (a Base Sepolia TEST key) in the repo-root .env");
  const account = privateKeyToAccount(key, { nonceManager });
  const transport = http(getRpcUrl("base-sepolia"));
  const chain = evmChain({
    chain: "base-sepolia",
    publicClient: createPublicClient({ chain: baseSepolia, transport }),
    walletClient: createWalletClient({ account, chain: baseSepolia, transport }),
    tokens: { USDC: { address: USDC, decimals: 6 } },
    swap: [uniswapV3()],
  });
  // The engine is the second line of defence behind the per-call caps: hourly budgets, and a kill switch you can flip.
  const engine = createPolicyEngine({
    policy: {
      chains: [CHAIN],
      limits: [
        {
          asset: "native",
          chain: CHAIN,
          label: "ETH",
          perTx: toAtomic("0.0005", 18),
          perPeriod: { amount: toAtomic("0.002", 18), seconds: 3600 },
        },
        { asset: USDC, chain: CHAIN, label: "USDC", perTx: toAtomic("0.5", 6), perPeriod: { amount: toAtomic("1", 6), seconds: 3600 } },
      ],
    },
  });
  const tools = agentTools({ engine, chains: [chain], maxPerCall: { ETH: "0.0005", USDC: "0.5" }, dryRun: opts.dryRun });
  return { tools, engine, address: account.address };
}
