/** Explorer links for anchors and receipts, keyed by CAIP-2 chain id. */

const EVM: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
  10: "https://optimistic.etherscan.io",
  11155420: "https://sepolia-optimism.etherscan.io",
  42161: "https://arbiscan.io",
  421614: "https://sepolia.arbiscan.io",
  137: "https://polygonscan.com",
  80002: "https://amoy.polygonscan.com",
};

// Solana CAIP-2 ids are genesis-hash prefixes; also accept the friendly names.
const SOLANA: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "",
  mainnet: "",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: "?cluster=devnet",
  devnet: "?cluster=devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": "?cluster=testnet",
  testnet: "?cluster=testnet",
};

/** Transaction link for `eip155:*`, `solana:*` and `sui:*` chains; undefined when unknown. */
export function explorerTxUrl(chain: string, tx: string, overrides: Record<string, string> = {}): string | undefined {
  const override = overrides[chain];
  if (override) return `${override.replace(/\/$/, "")}/tx/${tx}`;
  const [ns, ref = ""] = chain.split(":");
  if (ns === "eip155") {
    const base = EVM[Number(ref)];
    return base ? `${base}/tx/${tx}` : undefined;
  }
  if (ns === "solana") {
    const cluster = SOLANA[ref];
    return cluster === undefined ? undefined : `https://explorer.solana.com/tx/${tx}${cluster}`;
  }
  if (ns === "sui") {
    return ["mainnet", "testnet", "devnet"].includes(ref) ? `https://suiscan.xyz/${ref}/tx/${tx}` : undefined;
  }
  return undefined;
}

export function walrusBlobUrl(blobId: string, network: "testnet" | "mainnet" = "testnet"): string {
  return `https://walruscan.com/${network}/blob/${blobId}`;
}
