import type { ChainConfig } from "@codkit/config";
import type { Action, SimulationResult } from "@codkit/policy";

/** A token (or the chain's gas token) the agent may use. */
export interface AssetRef {
  /** What the agent calls it: "USDC", "ETH". */
  symbol: string;
  /** `"native"`, an ERC-20 address, or an SPL mint. */
  id: string;
  decimals: number;
}

export interface Sent {
  /** Transaction hash (EVM) or signature (Solana). */
  id: string;
  explorer?: string;
  details?: Record<string, unknown>;
}

/** A fund-moving operation, ready to run through caps, dry-run and the policy engine. */
export interface Prepared {
  /** What the policy engine judges. */
  action: Action;
  /** Human-readable facts for dry runs and approval prompts. */
  summary: Record<string, unknown>;
  simulate(): Promise<SimulationResult>;
  /** Must throw if the transaction fails onchain, so the engine releases the reserved spend. */
  send(): Promise<Sent>;
}

export interface SwapRequest {
  from: AssetRef;
  to: AssetRef;
  /** Exact input, atomic units. */
  amount: bigint;
  slippageBps: number;
}

export interface SwapQuote {
  provider: string;
  from: AssetRef & { amount: bigint };
  to: AssetRef & { expected: bigint; min: bigint };
  priceImpactPct?: number;
  /** Unix seconds after which the quote shouldn't be used. */
  expiresAt?: number;
  /** Private to the adapter that produced it. */
  plan: unknown;
}

/** One chain the tools can act on. `@codkit/agent-tools/evm` and `/solana` build these. */
export interface ChainAdapter {
  readonly chain: ChainConfig;
  /** The agent's own address on this chain. */
  readonly address: string;
  readonly assets: readonly AssetRef[];
  readonly canSwap: boolean;
  isAddress(value: string): boolean;
  /** Atomic balances by symbol. */
  balances(address: string): Promise<Record<string, bigint>>;
  prepareTransfer(req: { asset: AssetRef; to: string; amount: bigint; memo?: string }): Promise<Prepared>;
  quoteSwap(req: SwapRequest): Promise<SwapQuote>;
  prepareSwap(quote: SwapQuote): Promise<Prepared>;
}
