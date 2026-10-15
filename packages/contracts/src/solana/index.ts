/**
 * Client for the Solana escrow program (`kit_escrow`, Anchor). Builds
 * `@solana/kit` instructions (signers attached, so `signTransactionMessageWithSigners`
 * just works), derives the deal / vault / reputation addresses, and decodes accounts.
 *
 * Import from `@codkit/contracts/solana`. Needs `@solana/kit` (peer dependency).
 */
import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import type { Action } from "@codkit/policy";

/** Program ID (devnet). Override per call if you deploy your own copy. */
export const KIT_ESCROW_PROGRAM_ID = "8kQBzMWRWAEssN4wtBzrH4G8fHtbhrbHs9e24V2jWMkX" as Address;
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111" as Address;

/** Longest review period a deal may set (seconds). */
export const MAX_REVIEW_PERIOD = 30 * 24 * 60 * 60;
/** How long an arbiter has to resolve a dispute after the review period (seconds). */
export const ARBITER_TIMEOUT = 30 * 24 * 60 * 60;

// Anchor discriminators, from idl/kit_escrow.json
const IX = {
  create: [24, 30, 200, 40, 5, 28, 7, 119],
  deliver: [250, 131, 222, 57, 211, 229, 209, 147],
  dispute: [216, 92, 128, 146, 202, 85, 135, 73],
  release: [253, 249, 15, 206, 28, 127, 193, 241],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  refund: [2, 96, 183, 251, 63, 208, 46, 46],
} as const;
const DEAL_DISCRIMINATOR = [125, 223, 160, 234, 71, 162, 182, 219];
const REPUTATION_DISCRIMINATOR = [55, 148, 90, 71, 68, 183, 193, 28];

export type DealStatus = "Funded" | "Delivered" | "Disputed" | "Released" | "Refunded";
const STATUSES: DealStatus[] = ["Funded", "Delivered", "Disputed", "Released", "Refunded"];

export interface SolanaDeal {
  client: Address;
  provider: Address;
  arbiter: Address | null;
  mint: Address;
  dealId: bigint;
  amount: bigint;
  /** Unix seconds. */
  deadline: bigint;
  reviewPeriod: bigint;
  /** Unix seconds; 0 until delivered. */
  deliveredAt: bigint;
  status: DealStatus;
  termsHash: Uint8Array;
  deliveryHash: Uint8Array;
  bump: number;
}

export interface SolanaReputation {
  subject: Address;
  completed: bigint;
  refunded: bigint;
  disputed: bigint;
  volume: bigint;
  /** Completion rate in basis points (0..10000). */
  score: number;
}

// --------------------------------------------------------------- addresses

const enc = getAddressEncoder();
const u64le = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, v), true);
  return b;
};

/** Deal PDA: ["deal", client, deal_id (u64 LE)]. */
export async function findDealAddress(client: Address, dealId: bigint, programId = KIT_ESCROW_PROGRAM_ID): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: programId, seeds: ["deal", enc.encode(client), u64le(dealId)] });
  return pda;
}

/** Reputation PDA: ["reputation", subject]. */
export async function findReputationAddress(subject: Address, programId = KIT_ESCROW_PROGRAM_ID): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: programId, seeds: ["reputation", enc.encode(subject)] });
  return pda;
}

/** Associated token account of `owner` for `mint`. */
export async function findAssociatedTokenAddress(owner: Address, mint: Address, tokenProgram = TOKEN_PROGRAM_ID): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [enc.encode(owner), enc.encode(tokenProgram), enc.encode(mint)],
  });
  return ata;
}

// ------------------------------------------------------------ instructions

type Who = TransactionSigner | Address;
const addr = (w: Who): Address => (typeof w === "string" ? w : w.address);
const signer = (w: Who, writable: boolean) =>
  typeof w === "string"
    ? { address: w, role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER }
    : { address: w.address, role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER, signer: w };
const w = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const r = (address: Address) => ({ address, role: AccountRole.READONLY });

const concat = (...parts: ArrayLike<number>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const hash32 = (v: Uint8Array | string | undefined): Uint8Array => {
  const b = v === undefined ? new Uint8Array(32) : typeof v === "string" ? new TextEncoder().encode(v) : v;
  if (b.length > 32) throw new Error("hash must be at most 32 bytes (pass a digest, e.g. sha256 of the terms)");
  const out = new Uint8Array(32);
  out.set(b);
  return out;
};
const seconds = (d: Date | number | bigint) => BigInt(d instanceof Date ? Math.floor(d.getTime() / 1000) : d);

export interface SolanaNewDeal {
  client: Who;
  /** Per-client unique id; becomes part of the deal address. */
  dealId: bigint;
  provider: Address;
  arbiter?: Address;
  mint: Address;
  /** Base units. */
  amount: bigint;
  /** Delivery deadline (Date or unix seconds). */
  deadline: Date | number | bigint;
  /** Seconds; default 1 day, at most `MAX_REVIEW_PERIOD`, and > 0 when there's an arbiter. */
  reviewPeriod?: number;
  /** Up to 32 bytes: a hash / CID digest of the terms. */
  termsHash?: Uint8Array | string;
  tokenProgram?: Address;
  programId?: Address;
}

/** Lock `amount` of `mint` from the client's associated token account in a new deal. */
export async function createDealInstruction(d: SolanaNewDeal): Promise<Instruction & { deal: Address }> {
  const programId = d.programId ?? KIT_ESCROW_PROGRAM_ID;
  const tokenProgram = d.tokenProgram ?? TOKEN_PROGRAM_ID;
  const client = addr(d.client);
  const deal = await findDealAddress(client, d.dealId, programId);
  const data = concat(
    IX.create,
    u64le(d.dealId),
    enc.encode(d.provider),
    d.arbiter ? concat([1], enc.encode(d.arbiter)) : [0],
    u64le(d.amount),
    u64le(seconds(d.deadline)),
    u64le(BigInt(d.reviewPeriod ?? 86_400)),
    hash32(d.termsHash),
  );
  return {
    deal,
    programAddress: programId,
    accounts: [
      signer(d.client, true),
      w(deal),
      r(d.mint),
      w(await findAssociatedTokenAddress(client, d.mint, tokenProgram)),
      w(await findAssociatedTokenAddress(deal, d.mint, tokenProgram)),
      r(tokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
    ],
    data,
  };
}

export function deliverInstruction(a: { provider: Who; deal: Address; deliveryHash?: Uint8Array | string; programId?: Address }): Instruction {
  return {
    programAddress: a.programId ?? KIT_ESCROW_PROGRAM_ID,
    accounts: [signer(a.provider, false), w(a.deal)],
    data: concat(IX.deliver, hash32(a.deliveryHash)),
  };
}

export async function disputeInstruction(a: { client: Who; deal: Address; provider: Address; programId?: Address }): Promise<Instruction> {
  const programId = a.programId ?? KIT_ESCROW_PROGRAM_ID;
  return {
    programAddress: programId,
    accounts: [signer(a.client, true), w(a.deal), w(await findReputationAddress(a.provider, programId)), r(SYSTEM_PROGRAM_ID)],
    data: new Uint8Array(IX.dispute),
  };
}

/** Accounts a settlement needs from the deal: pass a fetched `SolanaDeal` or the fields. */
type DealRef = Pick<SolanaDeal, "client" | "provider" | "mint"> & { address: Address };

async function payout(kind: "release" | "claim", a: { signer: Who; deal: DealRef; tokenProgram?: Address; programId?: Address }): Promise<Instruction> {
  const programId = a.programId ?? KIT_ESCROW_PROGRAM_ID;
  const tp = a.tokenProgram ?? TOKEN_PROGRAM_ID;
  const { address: deal, client, provider, mint } = a.deal;
  return {
    programAddress: programId,
    accounts: [
      signer(a.signer, true),
      w(deal),
      r(mint),
      w(await findAssociatedTokenAddress(deal, mint, tp)),
      r(provider),
      w(await findAssociatedTokenAddress(provider, mint, tp)),
      w(client),
      w(await findReputationAddress(provider, programId)),
      r(tp),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
    ],
    data: new Uint8Array(IX[kind]),
  };
}

/** Pay the provider. Client: when Funded/Delivered. Arbiter: also when Disputed. */
export const releaseInstruction = (a: Parameters<typeof payout>[1]) => payout("release", a);
/** Provider collects once the review period after delivery has passed without a dispute. */
export const claimInstruction = (a: Parameters<typeof payout>[1]) => payout("claim", a);

/** Return the funds to the client (provider / arbiter any time; client after the deadline or an arbiter timeout). */
export async function refundInstruction(a: { signer: Who; deal: DealRef; tokenProgram?: Address; programId?: Address }): Promise<Instruction> {
  const programId = a.programId ?? KIT_ESCROW_PROGRAM_ID;
  const tp = a.tokenProgram ?? TOKEN_PROGRAM_ID;
  const { address: deal, client, provider, mint } = a.deal;
  return {
    programAddress: programId,
    accounts: [
      signer(a.signer, true),
      w(deal),
      r(mint),
      w(await findAssociatedTokenAddress(deal, mint, tp)),
      w(client),
      w(await findAssociatedTokenAddress(client, mint, tp)),
      w(await findReputationAddress(provider, programId)),
      r(tp),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
    ],
    data: new Uint8Array(IX.refund),
  };
}

// ------------------------------------------------------------------ decode

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): Address {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s as Address;
}

class Reader {
  o = 0;
  constructor(private b: Uint8Array) {}
  private dv = () => new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
  bytes(n: number) {
    if (this.o + n > this.b.length) throw new Error("account data too short");
    const v = this.b.slice(this.o, this.o + n);
    this.o += n;
    return v;
  }
  u8() {
    return this.bytes(1)[0]!;
  }
  u64() {
    const v = this.dv().getBigUint64(this.o, true);
    this.o += 8;
    return v;
  }
  i64() {
    const v = this.dv().getBigInt64(this.o, true);
    this.o += 8;
    return v;
  }
  u128() {
    const lo = this.u64();
    return (this.u64() << 64n) | lo;
  }
  pubkey() {
    return base58(this.bytes(32));
  }
}

function expectDiscriminator(rd: Reader, d: number[], what: string) {
  const got = rd.bytes(8);
  if (!d.every((x, i) => got[i] === x)) throw new Error(`not a ${what} account`);
}

export function decodeDeal(data: Uint8Array): SolanaDeal {
  const rd = new Reader(data);
  expectDiscriminator(rd, DEAL_DISCRIMINATOR, "kit_escrow Deal");
  const client = rd.pubkey();
  const provider = rd.pubkey();
  const arbiter = rd.u8() === 1 ? rd.pubkey() : null;
  const mint = rd.pubkey();
  const dealId = rd.u64();
  const amount = rd.u64();
  const deadline = rd.i64();
  const reviewPeriod = rd.i64();
  const deliveredAt = rd.i64();
  const status = STATUSES[rd.u8()];
  if (!status) throw new Error("unknown deal status");
  const termsHash = rd.bytes(32);
  const deliveryHash = rd.bytes(32);
  const bump = rd.u8();
  return { client, provider, arbiter, mint, dealId, amount, deadline, reviewPeriod, deliveredAt, status, termsHash, deliveryHash, bump };
}

export function decodeReputation(data: Uint8Array): SolanaReputation {
  const rd = new Reader(data);
  expectDiscriminator(rd, REPUTATION_DISCRIMINATOR, "kit_escrow Reputation");
  const subject = rd.pubkey();
  const completed = rd.u64();
  const refunded = rd.u64();
  const disputed = rd.u64();
  const volume = rd.u128();
  const total = completed + refunded + disputed;
  return { subject, completed, refunded, disputed, volume, score: total === 0n ? 0 : Number((completed * 10_000n) / total) };
}

/** The slice of a `@solana/kit` RPC these readers use. */
export interface AccountReader {
  getAccountInfo(
    address: Address,
    config: { encoding: "base64"; commitment?: "processed" | "confirmed" | "finalized" },
  ): { send(): Promise<{ value: { data: readonly [string, string] | unknown } | null }> };
}

async function fetchData(rpc: AccountReader, address: Address, commitment: "processed" | "confirmed" | "finalized"): Promise<Uint8Array | null> {
  const { value } = await rpc.getAccountInfo(address, { encoding: "base64", commitment }).send();
  if (!value) return null;
  const [b64] = value.data as [string, string];
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function fetchDeal(rpc: AccountReader, deal: Address, commitment: "processed" | "confirmed" | "finalized" = "confirmed") {
  const data = await fetchData(rpc, deal, commitment);
  return data ? { address: deal, ...decodeDeal(data) } : null;
}

export async function fetchReputation(
  rpc: AccountReader,
  subject: Address,
  opts: { programId?: Address; commitment?: "processed" | "confirmed" | "finalized" } = {},
): Promise<SolanaReputation> {
  const data = await fetchData(rpc, await findReputationAddress(subject, opts.programId), opts.commitment ?? "confirmed");
  return data ? decodeReputation(data) : { subject, completed: 0n, refunded: 0n, disputed: 0n, volume: 0n, score: 0 };
}

// ------------------------------------------------------------------ policy

/**
 * Policy `Action` for funding a Solana escrow, so `engine.authorize()` /
 * `execute()` can gate it like any other spend. `amount` is in base units.
 */
export function solanaEscrowCreateAction(d: { mint: Address; provider: Address; amount: bigint; cluster?: string; programId?: Address }): Action {
  return {
    chain: `solana:${d.cluster ?? "devnet"}`,
    kind: "escrow_fund",
    to: d.provider,
    program: d.programId ?? KIT_ESCROW_PROGRAM_ID,
    method: "create",
    spends: [{ asset: d.mint, amount: d.amount }],
  };
}
