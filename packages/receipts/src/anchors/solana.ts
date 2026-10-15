/**
 * Solana anchoring via the SPL Memo program. Dependency-free: returns an
 * instruction object compatible with `@solana/kit`'s `Instruction` — append it
 * to any transaction message you already build and sign.
 *
 * Import from `@iamyoungjohn-kit/receipts/solana`.
 */
import type { Checkpoint } from "../types.js";

export const MEMO_PROGRAM_ADDRESS = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Mirrors `@solana/kit` `AccountRole.READONLY_SIGNER`. */
const READONLY_SIGNER = 2;

const PREFIX = "kit-receipts:v1";

/** `kit-receipts:v1:<seq>:<head>[:<uri>]` */
export function anchorMemo(cp: Pick<Checkpoint, "seq" | "head"> & { uri?: string }): string {
  return `${PREFIX}:${cp.seq}:${cp.head}${cp.uri ? `:${cp.uri}` : ""}`;
}

export function parseAnchorMemo(memo: string): { seq: number; head: `0x${string}`; uri?: string } | undefined {
  const m = /^kit-receipts:v1:(\d+):(0x[0-9a-f]{64})(?::(.+))?$/.exec(memo.trim());
  if (!m) return undefined;
  return { seq: Number(m[1]), head: m[2] as `0x${string}`, ...(m[3] && { uri: m[3] }) };
}

/**
 * Memo instruction carrying the checkpoint. If `signer` is given it is listed
 * as a read-only signer, so the memo is attributable to that wallet.
 */
export function anchorMemoInstruction(cp: Pick<Checkpoint, "seq" | "head"> & { uri?: string }, signer?: string) {
  const text = anchorMemo(cp);
  if (new TextEncoder().encode(text).length > 566) throw new Error("memo too long; shorten the uri");
  return {
    programAddress: MEMO_PROGRAM_ADDRESS,
    accounts: signer ? [{ address: signer, role: READONLY_SIGNER }] : [],
    data: new TextEncoder().encode(text),
  } as const;
}
