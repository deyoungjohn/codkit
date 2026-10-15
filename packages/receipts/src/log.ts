import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalize, normalize, type Json } from "./canonical.js";
import { fromHex, toHex } from "./hex.js";
import { defaultVerifiers } from "./signers.js";
import { MemoryReceiptStore, type ReceiptStore } from "./store.js";
import {
  GENESIS,
  type AnchorResult,
  type Anchorer,
  type Checkpoint,
  type Hash,
  type Receipt,
  type Signer,
  type Uploader,
  type Verifier,
} from "./types.js";

/** sha256 over the canonical JSON of every receipt field except `hash` and `sig`. */
export function hashReceipt(r: Omit<Receipt, "hash" | "sig">): Hash {
  const body = canonicalize({ v: r.v, seq: r.seq, prev: r.prev, ts: r.ts, type: r.type, actor: r.actor, data: r.data });
  return toHex(sha256(utf8ToBytes(body)));
}

export interface ReceiptLogOptions {
  signer: Signer;
  store?: ReceiptStore;
  now?: () => number;
}

/**
 * Append-only, hash-chained, signed log. Each receipt commits to the one before
 * it, so anchoring the latest hash onchain commits to the whole history.
 */
export class ReceiptLog {
  readonly signer: Signer;
  readonly store: ReceiptStore;
  private readonly now: () => number;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(opts: ReceiptLogOptions) {
    this.signer = opts.signer;
    this.store = opts.store ?? new MemoryReceiptStore();
    this.now = opts.now ?? Date.now;
  }

  /** Record something. `data` is normalised (bigints → strings etc.) before hashing. */
  append(type: string, data: unknown = null): Promise<Receipt> {
    const run = this.lock.then(async () => {
      const head = await this.store.head();
      const ts = Math.max(this.now(), head?.ts ?? 0); // keep timestamps monotonic
      const body = {
        v: 1 as const,
        seq: head ? head.seq + 1 : 0,
        prev: head?.hash ?? GENESIS,
        ts,
        type,
        actor: this.signer.id,
        data: normalize(data),
      };
      const hash = hashReceipt(body);
      const receipt: Receipt = { ...body, hash, sig: await this.signer.sign(fromHex(hash)) };
      await this.store.append(receipt);
      return receipt;
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  head(): Promise<Receipt | undefined> {
    return this.store.head();
  }

  list(): Promise<Receipt[]> {
    return this.store.list();
  }

  async checkpoint(): Promise<Checkpoint> {
    const head = await this.store.head();
    if (!head) throw new Error("cannot checkpoint an empty log");
    return { seq: head.seq, head: head.hash, count: head.seq + 1 };
  }

  /** The log as JSON Lines, one receipt per line — the format `upload` stores. */
  async toJsonl(): Promise<string> {
    return (await this.store.list()).map((r) => JSON.stringify(r)).join("\n") + "\n";
  }

  /**
   * Publish the current state: optionally upload the full log, then anchor the
   * head hash (with the upload URI) onchain, then record that as an `anchor` receipt.
   */
  async publish(opts: { anchorer?: Anchorer; uploader?: Uploader }): Promise<PublishResult> {
    const checkpoint = await this.checkpoint();
    const upload = opts.uploader ? await opts.uploader.upload(await this.toJsonl()) : undefined;
    const anchor = opts.anchorer
      ? await opts.anchorer.anchor({ ...checkpoint, ...(upload && { uri: upload.uri }) })
      : undefined;
    const receipt = await this.append("anchor", { checkpoint, upload, anchor });
    return { checkpoint, ...(upload && { upload }), ...(anchor && { anchor }), receipt };
  }
}

export interface PublishResult {
  checkpoint: Checkpoint;
  upload?: { uri: string; url?: string; id: string };
  anchor?: AnchorResult;
  receipt: Receipt;
}

export interface VerifyOptions {
  /** Extra signature schemes, e.g. `{ eip191: eip191Verifier }`. */
  verifiers?: Record<string, Verifier>;
  /** Require every receipt to be signed by one of these actor ids. */
  trustedActors?: string[];
  /** Require the log to contain this anchored checkpoint. */
  anchor?: { seq: number; head: string };
}

export interface VerifyResult {
  ok: boolean;
  count: number;
  head?: Hash;
  errors: { seq: number; reason: string }[];
}

/** Check chain links, hashes, signatures, ordering and (optionally) an onchain anchor. */
export async function verifyLog(receipts: Receipt[], opts: VerifyOptions = {}): Promise<VerifyResult> {
  const verifiers = { ...defaultVerifiers, ...opts.verifiers };
  const errors: VerifyResult["errors"] = [];
  let prev: Receipt | undefined;
  for (const [i, r] of receipts.entries()) {
    const err = (reason: string) => errors.push({ seq: r.seq ?? i, reason });
    if (r.v !== 1) err(`unsupported version ${String(r.v)}`);
    if (r.seq !== i) err(`expected seq ${i}, got ${r.seq}`);
    if (r.prev !== (prev?.hash ?? GENESIS)) err("prev does not match previous receipt hash");
    if (prev && r.ts < prev.ts) err("timestamp goes backwards");
    const expected = hashReceipt(r);
    if (r.hash !== expected) err("hash mismatch (receipt was modified)");
    const sep = r.actor.indexOf(":");
    const scheme = r.actor.slice(0, sep);
    const verifier = verifiers[scheme];
    if (!verifier) err(`no verifier for scheme "${scheme}"`);
    else if (!(await verifier(r.actor.slice(sep + 1), fromHex(expected), r.sig))) err("bad signature");
    if (opts.trustedActors && !opts.trustedActors.includes(r.actor)) err(`untrusted actor ${r.actor}`);
    prev = r;
  }
  if (opts.anchor) {
    const at = receipts[opts.anchor.seq];
    if (!at || at.hash.toLowerCase() !== opts.anchor.head.toLowerCase()) {
      errors.push({ seq: opts.anchor.seq, reason: "log does not match the anchored head" });
    }
  }
  return { ok: errors.length === 0, count: receipts.length, ...(prev && { head: prev.hash }), errors };
}

/** Parse JSON Lines produced by `toJsonl()`. */
export function parseJsonl(text: string): Receipt[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Receipt);
}

export type { Json };
