import type { Json } from "./canonical.js";

/** `0x` + 64 lowercase hex chars (fits an EVM bytes32). */
export type Hash = `0x${string}`;

export const GENESIS: Hash = `0x${"0".repeat(64)}`;

export interface Receipt {
  v: 1;
  /** 0-based position in the log. */
  seq: number;
  /** Hash of the previous receipt (`GENESIS` for seq 0). */
  prev: Hash;
  /** Unix ms. */
  ts: number;
  /** What happened, e.g. `policy.decision`, `tx.sent`, `x402.settled`, `anchor`. */
  type: string;
  /** Signer identity, `<scheme>:<id>` — e.g. `ed25519:<pubkey hex>`, `eip191:<address>`. */
  actor: string;
  data: Json;
  /** sha256 of the canonical JSON of every field above. */
  hash: Hash;
  /** Signature by `actor` over the 32 hash bytes (hex). */
  sig: string;
}

export interface Checkpoint {
  /** seq of the head receipt. */
  seq: number;
  head: Hash;
  count: number;
}

export interface Signer {
  /** `<scheme>:<id>`; the scheme selects the verifier. */
  id: string;
  sign(hash: Uint8Array): Promise<string>;
}

/** Checks `sig` over `hash` for the identity part of `actor` (after the scheme prefix). */
export type Verifier = (identity: string, hash: Uint8Array, sig: string) => Promise<boolean>;

export interface AnchorResult {
  /** CAIP-2 chain id. */
  chain: string;
  /** Tx hash / signature / digest. */
  tx: string;
  url?: string;
}

/** Anything that can publish a checkpoint (EVM tx, Solana memo, Sui event ...). */
export interface Anchorer {
  chain: string;
  anchor(checkpoint: Checkpoint & { uri?: string }): Promise<AnchorResult>;
}

/** Anything that can store the full log and return a URI (Walrus, IPFS, S3 ...). */
export interface Uploader {
  upload(content: string): Promise<{ uri: string; url?: string; id: string }>;
}
