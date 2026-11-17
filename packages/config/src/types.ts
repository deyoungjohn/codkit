export type Ecosystem = "evm" | "solana" | "sui";

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

/** One chain: plain data, no SDK objects, so it works on servers, in browsers and in build scripts. */
export interface ChainConfig {
  /** Stable slug, also the env-var stem: `base-sepolia` → `BASE_SEPOLIA_RPC_URL`. */
  key: string;
  /** CAIP-2: `eip155:84532`, `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, `sui:testnet`. */
  id: string;
  ecosystem: Ecosystem;
  name: string;
  testnet: boolean;
  /** EVM only: the numeric chain id. */
  chainId?: number;
  /** Solana only: the cluster name used by explorers and CLIs. */
  cluster?: string;
  /** Wallet Standard chain id, where it differs from `id` (Solana wallets use `solana:devnet`, not the genesis hash). */
  walletChain?: string;
  nativeCurrency: NativeCurrency;
  /**
   * Public endpoints, in fallback order. On Sui these are fullnode base URLs for gRPC
   * (`SuiGrpcClient`): public fullnodes no longer serve JSON-RPC.
   */
  rpcUrls: readonly string[];
  /** Sui only: the public GraphQL endpoint. */
  graphqlUrl?: string;
  wsUrls?: readonly string[];
  explorer?: {
    name: string;
    url: string;
    /** `{base}`-relative templates; defaults suit Etherscan/Blockscout-style explorers. */
    tx?: string;
    address?: string;
  };
  /** Network slugs for keyed RPC providers. */
  providers?: { alchemy?: string; helius?: string };
}
