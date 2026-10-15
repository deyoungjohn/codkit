/**
 * Transaction builders for the Sui Move escrow (`kit_escrow::escrow`).
 *
 * Each helper appends a Move call to a `Transaction` you own, so they compose
 * with splitting coins, other calls, sponsorship, etc. Sign and execute with
 * any Sui client / wallet.
 */
import { Transaction, type TransactionObjectArgument } from "@mysten/sui/transactions";
import type { Action } from "@codkit/policy";

export interface SuiEscrowIds {
  /** Published package id. */
  packageId: string;
  /** The `Reputation` shared object created on publish. */
  reputationId: string;
}

export interface SuiNewDeal {
  /** Fully-qualified coin type, e.g. `0x2::sui::SUI` or a USDC type. */
  coinType: string;
  /** Coin object id, or a coin argument (e.g. from `tx.splitCoins`). Its whole value is escrowed. */
  payment: string | TransactionObjectArgument;
  provider: string;
  arbiter?: string;
  /** Delivery deadline (Date or ms since epoch). */
  deadline: Date | number;
  /** Default 1 day. */
  reviewPeriodMs?: number;
  /** Hash / CID of the terms (bytes or UTF-8 string). */
  terms?: Uint8Array | string;
}

const bytes = (v: Uint8Array | string | undefined): Uint8Array =>
  v === undefined ? new Uint8Array() : typeof v === "string" ? new TextEncoder().encode(v) : v;

const ms = (d: Date | number) => BigInt(d instanceof Date ? d.getTime() : d);

export function suiEscrow(ids: SuiEscrowIds) {
  const target = (fn: string) => `${ids.packageId}::escrow::${fn}` as const;
  const obj = (tx: Transaction, v: string | TransactionObjectArgument) => (typeof v === "string" ? tx.object(v) : v);

  return {
    /** Lock `payment` in a new shared `Escrow<coinType>`. The deal id is in the `DealCreated` event. */
    create(tx: Transaction, d: SuiNewDeal) {
      return tx.moveCall({
        target: target("create"),
        typeArguments: [d.coinType],
        arguments: [
          tx.pure.address(d.provider),
          tx.pure.option("address", d.arbiter ?? null),
          obj(tx, d.payment),
          tx.pure.u64(ms(d.deadline)),
          tx.pure.u64(d.reviewPeriodMs ?? 86_400_000),
          tx.pure.vector("u8", Array.from(bytes(d.terms))),
          tx.object.clock(),
        ],
      });
    },
    deliver(tx: Transaction, a: { coinType: string; escrowId: string; delivery: Uint8Array | string }) {
      return tx.moveCall({
        target: target("deliver"),
        typeArguments: [a.coinType],
        arguments: [tx.object(a.escrowId), tx.pure.vector("u8", Array.from(bytes(a.delivery))), tx.object.clock()],
      });
    },
    dispute(tx: Transaction, a: { coinType: string; escrowId: string }) {
      return tx.moveCall({
        target: target("dispute"),
        typeArguments: [a.coinType],
        arguments: [tx.object(a.escrowId), tx.object(ids.reputationId), tx.object.clock()],
      });
    },
    release(tx: Transaction, a: { coinType: string; escrowId: string }) {
      return tx.moveCall({
        target: target("release"),
        typeArguments: [a.coinType],
        arguments: [tx.object(a.escrowId), tx.object(ids.reputationId)],
      });
    },
    claim(tx: Transaction, a: { coinType: string; escrowId: string }) {
      return tx.moveCall({
        target: target("claim"),
        typeArguments: [a.coinType],
        arguments: [tx.object(a.escrowId), tx.object(ids.reputationId), tx.object.clock()],
      });
    },
    refund(tx: Transaction, a: { coinType: string; escrowId: string }) {
      return tx.moveCall({
        target: target("refund"),
        typeArguments: [a.coinType],
        arguments: [tx.object(a.escrowId), tx.object(ids.reputationId), tx.object.clock()],
      });
    },
    /** Event type to filter `DealCreated` events by (e.g. to find the new escrow id). */
    eventType: (name: "DealCreated" | "Delivered" | "Disputed" | "Released" | "Refunded") =>
      `${ids.packageId}::escrow::${name}`,
  };
}

/**
 * Policy `Action` for funding a Sui escrow, so `engine.authorize()` / `execute()`
 * can gate it like any other spend. `amount` is the coin value in base units.
 */
export function suiEscrowCreateAction(
  ids: Pick<SuiEscrowIds, "packageId">,
  d: { coinType: string; provider: string; amount: bigint; network?: string },
): Action {
  return {
    chain: `sui:${d.network ?? "testnet"}`,
    kind: "escrow_fund",
    to: d.provider,
    program: ids.packageId,
    method: "escrow::create",
    spends: [{ asset: d.coinType, amount: d.amount }],
  };
}

export { Transaction };
