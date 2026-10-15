import { ed25519 } from "@noble/curves/ed25519.js";
import { fromHex, toHex } from "./hex.js";
import type { Signer, Verifier } from "./types.js";

/**
 * Ed25519 signer, no chain SDK needed. Pass a 32-byte secret key (hex or bytes)
 * or omit it to generate a throwaway one (then persist `secretKey` yourself).
 */
export function ed25519Signer(secretKey?: Uint8Array | string): Signer & { secretKey: `0x${string}`; publicKey: `0x${string}` } {
  const sk = secretKey === undefined ? ed25519.utils.randomSecretKey() : typeof secretKey === "string" ? fromHex(secretKey) : secretKey;
  const pk = ed25519.getPublicKey(sk);
  return {
    id: `ed25519:${toHex(pk)}`,
    secretKey: toHex(sk),
    publicKey: toHex(pk),
    sign: async (hash) => toHex(ed25519.sign(hash, sk)),
  };
}

export const ed25519Verifier: Verifier = async (identity, hash, sig) => {
  try {
    return ed25519.verify(fromHex(sig), hash, fromHex(identity));
  } catch {
    return false;
  }
};

/** Built-in verifiers by scheme. Add more (e.g. `eip191` from `/evm`) via `verifyLog(…, { verifiers })`. */
export const defaultVerifiers: Record<string, Verifier> = { ed25519: ed25519Verifier };
