import { evmChains } from "./evm-chains.js";
import type { ChainConfig } from "./types.js";

const SOL = { name: "Solana", symbol: "SOL", decimals: 9 } as const;
const SUI = { name: "Sui", symbol: "SUI", decimals: 9 } as const;
const solanaExplorer = (cluster?: string) => ({
  name: "Solana Explorer",
  url: "https://explorer.solana.com",
  tx: `/tx/{hash}${cluster ? `?cluster=${cluster}` : ""}`,
  address: `/address/{address}${cluster ? `?cluster=${cluster}` : ""}`,
});
const suiscan = (net: string) => ({ name: "Suiscan", url: `https://suiscan.xyz/${net}`, tx: "/tx/{hash}", address: "/account/{address}" });

export const solanaChains = [
  {
    key: "solana",
    id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    walletChain: "solana:mainnet",
    ecosystem: "solana",
    name: "Solana",
    testnet: false,
    cluster: "mainnet-beta",
    nativeCurrency: SOL,
    rpcUrls: ["https://api.mainnet-beta.solana.com"],
    wsUrls: ["wss://api.mainnet-beta.solana.com"],
    explorer: solanaExplorer(),
    providers: { alchemy: "solana-mainnet", helius: "mainnet" },
  },
  {
    key: "solana-devnet",
    id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    walletChain: "solana:devnet",
    ecosystem: "solana",
    name: "Solana Devnet",
    testnet: true,
    cluster: "devnet",
    nativeCurrency: SOL,
    rpcUrls: ["https://api.devnet.solana.com"],
    wsUrls: ["wss://api.devnet.solana.com"],
    explorer: solanaExplorer("devnet"),
    providers: { alchemy: "solana-devnet", helius: "devnet" },
  },
  {
    key: "solana-testnet",
    id: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
    walletChain: "solana:testnet",
    ecosystem: "solana",
    name: "Solana Testnet",
    testnet: true,
    cluster: "testnet",
    nativeCurrency: SOL,
    rpcUrls: ["https://api.testnet.solana.com"],
    wsUrls: ["wss://api.testnet.solana.com"],
    explorer: solanaExplorer("testnet"),
  },
  {
    key: "solana-localnet",
    id: "solana:localnet",
    walletChain: "solana:localnet",
    ecosystem: "solana",
    name: "Solana Localnet",
    testnet: true,
    cluster: "localnet",
    nativeCurrency: SOL,
    rpcUrls: ["http://127.0.0.1:8899"],
    wsUrls: ["ws://127.0.0.1:8900"],
    explorer: { ...solanaExplorer("custom"), tx: "/tx/{hash}?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899" },
  },
] as const satisfies readonly ChainConfig[];

export const suiChains = [
  {
    key: "sui",
    id: "sui:mainnet",
    ecosystem: "sui",
    name: "Sui",
    testnet: false,
    nativeCurrency: SUI,
    rpcUrls: ["https://fullnode.mainnet.sui.io:443"],
    graphqlUrl: "https://graphql.mainnet.sui.io/graphql",
    explorer: suiscan("mainnet"),
  },
  {
    key: "sui-testnet",
    id: "sui:testnet",
    ecosystem: "sui",
    name: "Sui Testnet",
    testnet: true,
    nativeCurrency: SUI,
    rpcUrls: ["https://fullnode.testnet.sui.io:443"],
    graphqlUrl: "https://graphql.testnet.sui.io/graphql",
    explorer: suiscan("testnet"),
  },
  {
    key: "sui-devnet",
    id: "sui:devnet",
    ecosystem: "sui",
    name: "Sui Devnet",
    testnet: true,
    nativeCurrency: SUI,
    rpcUrls: ["https://fullnode.devnet.sui.io:443"],
    graphqlUrl: "https://graphql.devnet.sui.io/graphql",
    explorer: suiscan("devnet"),
  },
  {
    key: "sui-localnet",
    id: "sui:localnet",
    ecosystem: "sui",
    name: "Sui Localnet",
    testnet: true,
    nativeCurrency: SUI,
    rpcUrls: ["http://127.0.0.1:9000"],
  },
] as const satisfies readonly ChainConfig[];

const all = [...evmChains, ...solanaChains, ...suiChains];

export type ChainKey = (typeof all)[number]["key"];

/** Every built-in chain by key: `chains["base-sepolia"]`. */
export const chains = Object.fromEntries(all.map((c) => [c.key, c])) as { [K in ChainKey]: Extract<(typeof all)[number], { key: K }> };

/** A chain key, CAIP-2 id, Wallet Standard id (`solana:devnet`), EVM chain id, or a `ChainConfig` (for custom chains). */
export type ChainRef = ChainKey | (string & {}) | number | ChainConfig;

const index = new Map<string | number, ChainConfig>();
for (const c of all as readonly ChainConfig[]) {
  index.set(c.key, c);
  index.set(c.id, c);
  if (c.walletChain) index.set(c.walletChain, c);
  if (c.chainId !== undefined) index.set(c.chainId, c);
}

export function findChain(ref: ChainRef): ChainConfig | undefined {
  return typeof ref === "object" ? ref : index.get(ref);
}

export function getChain(ref: ChainRef): ChainConfig {
  const c = findChain(ref);
  if (!c) throw new Error(`unknown chain ${JSON.stringify(ref)}; pass a ChainConfig from defineChain() for custom chains`);
  return c;
}

/** Built-in chains, optionally filtered: `listChains({ ecosystem: "evm", testnet: true })`. */
export function listChains(filter: { ecosystem?: ChainConfig["ecosystem"]; testnet?: boolean } = {}): ChainConfig[] {
  return (all as readonly ChainConfig[]).filter(
    (c) =>
      (filter.ecosystem === undefined || c.ecosystem === filter.ecosystem) &&
      (filter.testnet === undefined || c.testnet === filter.testnet),
  );
}

/** Declare a chain that isn't built in. Validates the shape; use the result anywhere a `ChainRef` is accepted. */
export function defineChain<const C extends ChainConfig>(chain: C): C {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(chain.key)) throw new Error(`defineChain: key "${chain.key}" must be kebab-case`);
  if (!/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(chain.id)) throw new Error(`defineChain: id "${chain.id}" is not CAIP-2`);
  if (chain.ecosystem === "evm" && chain.id !== `eip155:${chain.chainId}`) throw new Error("defineChain: EVM id must be eip155:<chainId>");
  if (!chain.rpcUrls.length) throw new Error("defineChain: at least one rpcUrl is required");
  return chain;
}
