/**
 * Typed viem bindings for Escrow + Reputation.
 *
 * Write helpers return plain `{ to, data }` transactions on purpose: hand them to
 * `createEvmGuard(...).send(tx)` from `@codkit/policy/evm` so every
 * escrow action goes through policy + simulation, or send them with any wallet client.
 */
import {
  encodeDeployData,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { escrowAbi, escrowBytecode, receiptAnchorAbi, receiptAnchorBytecode, reputationAbi, reputationBytecode } from "./abi.js";

export { escrowAbi, escrowBytecode, receiptAnchorAbi, receiptAnchorBytecode, reputationAbi, reputationBytecode };

export interface EvmTx {
  to: Address;
  data: Hex;
  value?: bigint;
}

/** Mirrors `Escrow.Status`. */
export const DealStatus = ["None", "Created", "Funded", "Delivered", "Disputed", "Released", "Refunded", "Cancelled"] as const;
export type DealStatus = (typeof DealStatus)[number];

/** Mirrors `Reputation.Outcome`. */
export const Outcome = { Completed: 0, Refunded: 1, Disputed: 2 } as const;

export interface Deal {
  id: bigint;
  client: Address;
  provider: Address;
  arbiter: Address | null;
  token: Address;
  amount: bigint;
  deadline: Date;
  reviewPeriodSeconds: number;
  deliveredAt: Date | null;
  status: DealStatus;
  termsHash: Hex;
  deliveryHash: Hex | null;
}

export interface NewDeal {
  provider: Address;
  token: Address;
  amount: bigint;
  /** Delivery deadline (Date or unix seconds). */
  deadline: Date | number | bigint;
  /** Optional dispute resolver. Without one, disputes are impossible. */
  arbiter?: Address;
  /** Seconds the client has to dispute after delivery. Default 1 day. */
  reviewPeriodSeconds?: number;
  /** Hash of what was agreed; pass text/JSON to `hashText`, or an IPFS digest. */
  termsHash?: Hex;
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";
const ZERO32: Hex = `0x${"0".repeat(64)}`;

/** keccak256 of a UTF-8 string, for `termsHash` / `deliveryHash`. */
export const hashText = (text: string): Hex => keccak256(toHex(text));

function toSeconds(d: Date | number | bigint): bigint {
  if (d instanceof Date) return BigInt(Math.floor(d.getTime() / 1000));
  return BigInt(d);
}

function dealArgs(d: NewDeal) {
  return [
    d.provider,
    d.arbiter ?? ZERO,
    d.token,
    d.amount,
    toSeconds(d.deadline),
    d.reviewPeriodSeconds ?? 86_400,
    d.termsHash ?? ZERO32,
  ] as const;
}

/** Transaction builders for one deployed Escrow. */
export function escrowTxs(escrow: Address) {
  const call = (data: Hex): EvmTx => ({ to: escrow, data });
  return {
    /** ERC20 approval the client must send before funding. The policy EVM adapter counts it as spend. */
    approve: (token: Address, amount: bigint): EvmTx => ({
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, amount] }),
    }),
    createDeal: (d: NewDeal) => call(encodeFunctionData({ abi: escrowAbi, functionName: "createDeal", args: dealArgs(d) })),
    createAndFund: (d: NewDeal) =>
      call(encodeFunctionData({ abi: escrowAbi, functionName: "createAndFund", args: dealArgs(d) })),
    fund: (id: bigint) => call(encodeFunctionData({ abi: escrowAbi, functionName: "fund", args: [id] })),
    cancel: (id: bigint) => call(encodeFunctionData({ abi: escrowAbi, functionName: "cancel", args: [id] })),
    deliver: (id: bigint, deliveryHash: Hex) =>
      call(encodeFunctionData({ abi: escrowAbi, functionName: "deliver", args: [id, deliveryHash] })),
    dispute: (id: bigint) => call(encodeFunctionData({ abi: escrowAbi, functionName: "dispute", args: [id] })),
    release: (id: bigint) => call(encodeFunctionData({ abi: escrowAbi, functionName: "release", args: [id] })),
    claim: (id: bigint) => call(encodeFunctionData({ abi: escrowAbi, functionName: "claim", args: [id] })),
    refund: (id: bigint) => call(encodeFunctionData({ abi: escrowAbi, functionName: "refund", args: [id] })),
  };
}

/** The subset of a viem `PublicClient` needed for reads. */
export interface ContractReader {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

interface RawDeal {
  client: Address;
  deadline: bigint;
  status: number;
  provider: Address;
  deliveredAt: bigint;
  arbiter: Address;
  reviewPeriod: number;
  token: Address;
  amount: bigint;
  termsHash: Hex;
  deliveryHash: Hex;
}

export async function readDeal(reader: ContractReader, escrow: Address, id: bigint): Promise<Deal> {
  const d = (await reader.readContract({ address: escrow, abi: escrowAbi, functionName: "getDeal", args: [id] })) as RawDeal;
  return {
    id,
    client: d.client,
    provider: d.provider,
    arbiter: d.arbiter === ZERO ? null : d.arbiter,
    token: d.token,
    amount: d.amount,
    deadline: new Date(Number(d.deadline) * 1000),
    reviewPeriodSeconds: Number(d.reviewPeriod),
    deliveredAt: d.deliveredAt === 0n ? null : new Date(Number(d.deliveredAt) * 1000),
    status: DealStatus[d.status] ?? "None",
    termsHash: d.termsHash,
    deliveryHash: d.deliveryHash === ZERO32 ? null : d.deliveryHash,
  };
}

export interface ReputationStats {
  completed: number;
  refunded: number;
  disputed: number;
  volume: bigint;
  /** Completion rate 0..1 (0 when there is no history). */
  score: number;
}

export async function readReputation(reader: ContractReader, reputation: Address, subject: Address): Promise<ReputationStats> {
  const s = (await reader.readContract({ address: reputation, abi: reputationAbi, functionName: "stats", args: [subject] })) as {
    completed: bigint;
    refunded: bigint;
    disputed: bigint;
    volume: bigint;
  };
  const bps = (await reader.readContract({ address: reputation, abi: reputationAbi, functionName: "score", args: [subject] })) as bigint;
  return {
    completed: Number(s.completed),
    refunded: Number(s.refunded),
    disputed: Number(s.disputed),
    volume: s.volume,
    score: Number(bps) / 10_000,
  };
}

/** Decode Escrow events from a receipt's logs (e.g. to get the new deal id). */
export function parseEscrowLogs(logs: Log[]) {
  return parseEventLogs({ abi: escrowAbi, logs });
}

/** Deal id created in a transaction, from its receipt logs. */
export function dealIdFromLogs(logs: Log[]): bigint | undefined {
  const ev = parseEscrowLogs(logs).find((l) => l.eventName === "DealCreated");
  return ev?.eventName === "DealCreated" ? ev.args.id : undefined;
}

/** Deploy data for a viem `sendTransaction({ data })` — deployments are run by a human, on testnets. */
export const deployData = {
  reputation: (owner: Address): Hex => encodeDeployData({ abi: reputationAbi, bytecode: reputationBytecode, args: [owner] }),
  escrow: (reputation: Address | null): Hex =>
    encodeDeployData({ abi: escrowAbi, bytecode: escrowBytecode, args: [reputation ?? ZERO] }),
  setWriter: (reputation: Address, writer: Address, allowed = true): EvmTx => ({
    to: reputation,
    data: encodeFunctionData({ abi: reputationAbi, functionName: "setWriter", args: [writer, allowed] }),
  }),
};

