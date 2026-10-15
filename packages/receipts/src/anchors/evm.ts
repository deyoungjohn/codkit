/**
 * EVM anchoring + EIP-191 signing. Import from `@iamyoungjohn-kit/receipts/evm`.
 *
 * Two anchoring modes:
 * - `contract`: call `ReceiptAnchor.anchor(head, seq, uri)` (from `@iamyoungjohn-kit/contracts`),
 *   which emits an indexed `Anchored` event — easy to query with `readEvmAnchors`.
 * - no contract: a 0-value tx to yourself whose calldata is `KIT_RECEIPTS_TAG ‖ head ‖ seq`.
 *   Zero deployment; look it up by tx hash.
 */
import {
  bytesToHex,
  concat,
  encodeFunctionData,
  numberToHex,
  parseAbi,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import { explorerTxUrl } from "../explorer.js";
import type { Anchorer, Signer, Verifier } from "../types.js";

export const receiptAnchorAbi = parseAbi([
  "function anchor(bytes32 head, uint64 seq, string uri)",
  "event Anchored(address indexed logger, bytes32 indexed head, uint64 seq, string uri)",
]);

/** `"kitrcpt1"` — prefix of calldata anchors. */
export const KIT_RECEIPTS_TAG: Hex = "0x6b69747263707431";

/** Sign receipts with an EVM account (viem `LocalAccount` or anything with `signMessage`). */
export function eip191Signer(account: { address: Address; signMessage(args: { message: { raw: Uint8Array } }): Promise<Hex> }): Signer {
  return {
    id: `eip191:${account.address}`,
    sign: (hash) => account.signMessage({ message: { raw: hash } }),
  };
}

export const eip191Verifier: Verifier = async (identity, hash, sig) => {
  try {
    const addr = await recoverMessageAddress({ message: { raw: bytesToHex(hash) }, signature: sig as Hex });
    return addr.toLowerCase() === identity.toLowerCase();
  } catch {
    return false;
  }
};

export interface EvmAnchorOptions {
  chainId: number;
  /** viem `WalletClient` created with `account` and `chain`. */
  wallet: { account: { address: Address }; sendTransaction(args: { to: Address; data: Hex }): Promise<Hex> };
  /** Deployed `ReceiptAnchor`. Omit to use calldata mode. */
  contract?: Address;
  /** Wait for inclusion before returning (pass a `PublicClient`). */
  waitFor?: { waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: "success" | "reverted" }> };
}

export function evmAnchorer(opts: EvmAnchorOptions): Anchorer {
  const chain = `eip155:${opts.chainId}`;
  return {
    chain,
    async anchor({ head, seq, uri }) {
      const tx = opts.contract
        ? {
            to: opts.contract,
            data: encodeFunctionData({ abi: receiptAnchorAbi, functionName: "anchor", args: [head, BigInt(seq), uri ?? ""] }),
          }
        : { to: opts.wallet.account.address, data: calldataAnchor(head, seq) };
      const hash = await opts.wallet.sendTransaction(tx);
      if (opts.waitFor) {
        const r = await opts.waitFor.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error(`anchor tx ${hash} reverted`);
      }
      const url = explorerTxUrl(chain, hash);
      return { chain, tx: hash, ...(url && { url }) };
    },
  };
}

export function calldataAnchor(head: Hex, seq: number): Hex {
  return concat([KIT_RECEIPTS_TAG, head, numberToHex(seq, { size: 8 })]);
}

export function parseCalldataAnchor(data: Hex): { head: Hex; seq: number } | undefined {
  if (!data.toLowerCase().startsWith(KIT_RECEIPTS_TAG) || data.length !== 2 + 16 + 64 + 16) return undefined;
  return { head: `0x${data.slice(18, 82)}`, seq: Number(BigInt(`0x${data.slice(82)}`)) };
}

/** Anchors emitted by a `ReceiptAnchor` contract, oldest first. */
export async function readEvmAnchors(
  reader: { getContractEvents(args: object): Promise<unknown[]> },
  args: { contract: Address; logger?: Address; fromBlock?: bigint },
): Promise<{ logger: Address; head: Hex; seq: number; uri: string; tx: Hex; blockNumber: bigint }[]> {
  const logs = (await reader.getContractEvents({
    address: args.contract,
    abi: receiptAnchorAbi,
    eventName: "Anchored",
    ...(args.logger && { args: { logger: args.logger } }),
    fromBlock: args.fromBlock ?? 0n,
  })) as { args: { logger: Address; head: Hex; seq: bigint; uri: string }; transactionHash: Hex; blockNumber: bigint }[];
  return logs.map((l) => ({
    logger: l.args.logger,
    head: l.args.head,
    seq: Number(l.args.seq),
    uri: l.args.uri,
    tx: l.transactionHash,
    blockNumber: l.blockNumber,
  }));
}
