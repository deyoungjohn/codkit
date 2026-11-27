import type { ChainConfig, ChainRef } from "@codkit/config";
import type { ComponentType, ReactNode } from "react";
import type { WalletError } from "./errors.js";

export type WalletEcosystem = "evm" | "solana";

export type WalletStatus = "disconnected" | "connecting" | "reconnecting" | "connected";

/** A wallet the user can pick: an EIP-6963 browser wallet, WalletConnect, a Wallet Standard wallet … */
export interface WalletInfo {
  id: string;
  name: string;
  /** Usually a data URI. */
  icon?: string;
  ecosystem: WalletEcosystem;
}

export interface WalletSnapshot {
  ecosystem: WalletEcosystem;
  status: WalletStatus;
  address?: string;
  /** The chain transactions go to. */
  chain: ChainConfig;
  /** The connected wallet. */
  wallet?: WalletInfo;
  /** Wallets discovered so far (they register asynchronously after page load). */
  wallets: readonly WalletInfo[];
  /** The chains this adapter was configured with. */
  chains: readonly ChainConfig[];
  /** The last failure, normalised (`error.code`: "rejected", "pending", "unsupported", …). */
  error?: WalletError;
  /**
   * Set after a disconnect the wallet couldn't fully honour: some wallets (no `wallet_revokePermissions`)
   * keep the site approved, so connecting again returns the same account until the user switches it there.
   */
  lastDisconnect?: { wallet: WalletInfo; revoked: boolean };
}

export interface EvmTransaction {
  to: `0x${string}`;
  value?: bigint;
  data?: `0x${string}`;
}

/** Structurally a `@solana/kit` `Instruction`, so the core never imports kit. */
export interface SolanaInstructionLike {
  programAddress: string;
  accounts?: readonly { address: string; role: number }[];
  data?: { readonly length: number; readonly [i: number]: number };
}

export interface SolanaTransaction {
  /** Instructions to run; the connected wallet pays the fee and is the only signer. */
  instructions: readonly SolanaInstructionLike[];
}

export interface WalletTransactions {
  evm: EvmTransaction;
  solana: SolanaTransaction;
}

export interface WalletActions<E extends WalletEcosystem = WalletEcosystem> {
  /** Connect a wallet by `WalletInfo.id`; with no id, the first discovered one. */
  connect(walletId?: string): Promise<void>;
  disconnect(): Promise<void>;
  /** EVM: 0x signature (EIP-191). Solana: base58 signature. */
  signMessage(message: string | Uint8Array): Promise<string>;
  /** EVM: tx hash. Solana: base58 signature. */
  sendTransaction(tx: WalletTransactions[E]): Promise<string>;
  switchChain(chain: ChainRef): Promise<void>;
  /** Resolves once the transaction is confirmed (`ok: true`) or failed onchain (`ok: false`). */
  waitForTransaction(id: string, opts?: { timeoutMs?: number }): Promise<{ ok: boolean }>;
}

/**
 * One ecosystem's wallet layer. Framework-agnostic store (`getSnapshot` / `subscribe`)
 * plus actions; `@codkit/wallet`'s React hooks sit on top.
 */
export interface WalletAdapter<E extends WalletEcosystem = WalletEcosystem> extends WalletActions<E> {
  readonly ecosystem: E;
  getSnapshot(): WalletSnapshot;
  subscribe(listener: () => void): () => void;
  /** Start client-only work (wallet discovery, auto-reconnect). Returns a cleanup. */
  mount(): () => void;
  /** Context the adapter needs around the app (wagmi's providers for EVM). */
  Provider?: ComponentType<{ children: ReactNode }>;
}

/** EIP-712 typed data, as `eth_signTypedData_v4` takes it (an x402 payment authorization, a permit, a login …). */
export interface EvmTypedData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** What only EVM wallets can do. */
export interface EvmWalletActions {
  /**
   * EIP-712 sign. If the domain names another chain this adapter knows, the wallet switches to it first
   * (MetaMask and others refuse a domain `chainId` that isn't the active chain).
   */
  signTypedData(data: EvmTypedData): Promise<`0x${string}`>;
}

export type Wallet<E extends WalletEcosystem = WalletEcosystem> = WalletSnapshot & { ecosystem: E } & WalletActions<E> &
  ([E] extends ["evm"] ? EvmWalletActions : unknown);
