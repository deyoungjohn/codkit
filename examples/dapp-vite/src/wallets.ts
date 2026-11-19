// The one file a project edits to change chains or wallet vendors.
import { evmAdapter } from "@codkit/wallet/evm";
import { solanaAdapter } from "@codkit/wallet/solana";

const env = import.meta.env as Record<string, string | undefined>;
const list = (v: string | undefined, fallback: string[]) => (v ? v.split(",").map((s) => s.trim()) : fallback);

export const adapters = [
  evmAdapter({
    chains: list(env.VITE_EVM_CHAINS, ["base-sepolia", "sepolia"]),
    env,
    ...(env.VITE_WALLETCONNECT_PROJECT_ID && { walletConnectProjectId: env.VITE_WALLETCONNECT_PROJECT_ID, app: { name: "codkit dapp" } }),
  }),
  solanaAdapter({ chains: list(env.VITE_SOLANA_CHAINS, ["solana-devnet"]), env }),
];
