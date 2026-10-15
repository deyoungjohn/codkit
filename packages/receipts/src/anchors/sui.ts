/**
 * Sui anchoring via `kit_escrow::anchor::anchor` (published with the contracts
 * package). Import from `@codkit/receipts/sui`.
 */
import { Transaction } from "@mysten/sui/transactions";
import { explorerTxUrl } from "../explorer.js";
import { fromHex } from "../hex.js";
import type { Anchorer, Checkpoint } from "../types.js";

/** Append the anchor call to a transaction you own. */
export function suiAnchorCall(tx: Transaction, packageId: string, cp: Pick<Checkpoint, "seq" | "head"> & { uri?: string }) {
  return tx.moveCall({
    target: `${packageId}::anchor::anchor`,
    arguments: [
      tx.pure.vector("u8", Array.from(fromHex(cp.head))),
      tx.pure.u64(cp.seq),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(cp.uri ?? ""))),
    ],
  });
}

export interface SuiAnchorOptions {
  packageId: string;
  /** `testnet` | `devnet` | `mainnet` | `localnet` */
  network: string;
  /** Sign + execute; e.g. `(tx) => client.signAndExecuteTransaction({ transaction: tx, signer }).then(r => r.Transaction!.digest)`. */
  execute: (tx: Transaction) => Promise<string>;
}

export function suiAnchorer(opts: SuiAnchorOptions): Anchorer {
  const chain = `sui:${opts.network}`;
  return {
    chain,
    async anchor(cp) {
      const tx = new Transaction();
      suiAnchorCall(tx, opts.packageId, cp);
      const digest = await opts.execute(tx);
      const url = explorerTxUrl(chain, digest);
      return { chain, tx: digest, ...(url && { url }) };
    },
  };
}
