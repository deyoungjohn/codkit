import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  ed25519Signer,
  GENESIS,
  hashReceipt,
  normalize,
  parseJsonl,
  ReceiptLog,
  verifyLog,
  type Anchorer,
  type Receipt,
  type Uploader,
} from "../src/index.js";
import { JsonlFileStore } from "../src/node.js";

async function sampleLog(n = 4) {
  const signer = ed25519Signer();
  const log = new ReceiptLog({ signer });
  for (let i = 0; i < n; i++) await log.append("tx.sent", { i, amount: BigInt(i) * 10n ** 18n });
  return { log, signer, receipts: await log.list() };
}

const clone = (rs: Receipt[]) => JSON.parse(JSON.stringify(rs)) as Receipt[];

describe("canonical JSON", () => {
  it("is independent of key order and normalises app values", () => {
    expect(canonicalize(normalize({ b: 1, a: { d: [1, 2], c: "x" } }))).toBe(canonicalize(normalize({ a: { c: "x", d: [1, 2] }, b: 1 })));
    expect(
      normalize({ big: 2n ** 70n, when: new Date(0), bytes: new Uint8Array([1, 255]), skip: undefined, arr: [undefined], err: new Error("boom") }),
    ).toEqual({ big: "1180591620717411303424", when: "1970-01-01T00:00:00.000Z", bytes: "0x01ff", arr: [null], err: { name: "Error", message: "boom" } });
  });

  it("rejects values that cannot round-trip", () => {
    expect(() => normalize({ x: NaN })).toThrow(/non-finite/);
    expect(() => normalize({ m: new Map() })).toThrow(/Map/);
    expect(() => normalize(Symbol("s"))).toThrow();
  });
});

describe("ReceiptLog", () => {
  it("builds a signed hash chain that verifies", async () => {
    const { receipts, signer } = await sampleLog();
    expect(receipts.map((r) => r.seq)).toEqual([0, 1, 2, 3]);
    expect(receipts[0]!.prev).toBe(GENESIS);
    expect(receipts[2]!.prev).toBe(receipts[1]!.hash);
    expect(receipts[1]!.data).toEqual({ i: 1, amount: "1000000000000000000" });
    expect(receipts[0]!.actor).toBe(signer.id);
    expect(await verifyLog(receipts, { trustedActors: [signer.id] })).toEqual({ ok: true, count: 4, head: receipts[3]!.hash, errors: [] });
  });

  it("detects edited data", async () => {
    const rs = clone((await sampleLog()).receipts);
    (rs[1]!.data as { i: number }).i = 99;
    const res = await verifyLog(rs);
    expect(res.ok).toBe(false);
    expect(res.errors).toContainEqual({ seq: 1, reason: "hash mismatch (receipt was modified)" });
  });

  it("detects a re-hashed edit (breaks the chain and the signature)", async () => {
    const rs = clone((await sampleLog()).receipts);
    rs[1]!.data = { i: 1, amount: "0" };
    rs[1]!.hash = hashReceipt(rs[1]!);
    const reasons = (await verifyLog(rs)).errors.map((e) => `${e.seq}:${e.reason}`);
    expect(reasons).toEqual(expect.arrayContaining(["1:bad signature", "2:prev does not match previous receipt hash"]));
  });

  it("detects deletion and reordering", async () => {
    const rs = (await sampleLog()).receipts;
    expect((await verifyLog([rs[0]!, rs[2]!, rs[3]!])).ok).toBe(false);
    expect((await verifyLog([rs[1]!, rs[0]!, rs[2]!, rs[3]!])).ok).toBe(false);
  });

  it("detects a forged log by another key, and untrusted actors", async () => {
    const real = await sampleLog();
    const forged = clone(real.receipts);
    forged[0]!.sig = (await ed25519Signer().sign(new Uint8Array(32))) as string;
    expect((await verifyLog(forged)).errors[0]).toEqual({ seq: 0, reason: "bad signature" });

    const other = await sampleLog(1);
    expect((await verifyLog(other.receipts, { trustedActors: [real.signer.id] })).errors[0]!.reason).toMatch(/untrusted actor/);
  });

  it("rejects unknown signature schemes unless a verifier is supplied", async () => {
    const log = new ReceiptLog({ signer: { id: "test:me", sign: async () => "ok" } });
    await log.append("x");
    const rs = await log.list();
    expect((await verifyLog(rs)).errors[0]!.reason).toBe('no verifier for scheme "test"');
    expect((await verifyLog(rs, { verifiers: { test: async (id, _h, sig) => id === "me" && sig === "ok" } })).ok).toBe(true);
  });

  it("serialises concurrent appends into one chain with monotonic time", async () => {
    let t = 1000;
    const log = new ReceiptLog({ signer: ed25519Signer(), now: () => (t -= 7) }); // clock going backwards
    await Promise.all(Array.from({ length: 20 }, (_, i) => log.append("e", { i })));
    const rs = await log.list();
    expect(rs.map((r) => r.seq)).toEqual([...Array(20).keys()]);
    expect((await verifyLog(rs)).ok).toBe(true);
  });

  it("publishes: upload, anchor with the uri, then records the anchor", async () => {
    const { log } = await sampleLog(3);
    let uploaded = "";
    const uploader: Uploader = { upload: async (c) => ((uploaded = c), { id: "blob1", uri: "walrus://blob1" }) };
    const seen: unknown[] = [];
    const anchorer: Anchorer = { chain: "eip155:31337", anchor: async (cp) => (seen.push(cp), { chain: "eip155:31337", tx: "0xabc" }) };

    const res = await log.publish({ uploader, anchorer });
    expect(res.checkpoint).toMatchObject({ seq: 2, count: 3 });
    expect(seen).toEqual([{ ...res.checkpoint, uri: "walrus://blob1" }]);
    expect(parseJsonl(uploaded)).toHaveLength(3);
    expect(res.receipt).toMatchObject({ seq: 3, type: "anchor", data: { anchor: { tx: "0xabc" }, upload: { uri: "walrus://blob1" } } });

    // Anyone holding the uploaded log can check it against the onchain anchor
    expect((await verifyLog(parseJsonl(uploaded), { anchor: res.checkpoint })).ok).toBe(true);
    const tampered = parseJsonl(uploaded);
    tampered.pop();
    expect((await verifyLog(tampered, { anchor: res.checkpoint })).errors.at(-1)!.reason).toBe("log does not match the anchored head");
  });

  it("refuses to checkpoint an empty log", async () => {
    await expect(new ReceiptLog({ signer: ed25519Signer() }).checkpoint()).rejects.toThrow(/empty/);
  });

  it("restores a signer from its secret key", async () => {
    const a = ed25519Signer();
    expect(ed25519Signer(a.secretKey).id).toBe(a.id);
  });
});

describe("JsonlFileStore", () => {
  it("persists across restarts and the file verifies on its own", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "receipts-")), "agent", "log.jsonl");
    const signer = ed25519Signer();
    const a = new ReceiptLog({ signer, store: new JsonlFileStore(path) });
    await a.append("one", { n: 1 });
    await a.append("two", { n: 2 });

    const b = new ReceiptLog({ signer, store: new JsonlFileStore(path) });
    await b.append("three", { n: 3 });
    const fromDisk = parseJsonl(readFileSync(path, "utf8"));
    expect(fromDisk.map((r) => r.type)).toEqual(["one", "two", "three"]);
    expect((await verifyLog(fromDisk)).ok).toBe(true);

    writeFileSync(path, readFileSync(path, "utf8").replace('"n":2', '"n":20'));
    expect((await verifyLog(parseJsonl(readFileSync(path, "utf8")))).ok).toBe(false);
  });
});
