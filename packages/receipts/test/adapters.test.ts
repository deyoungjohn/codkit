import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";
import { describe, expect, it, vi } from "vitest";
import { ed25519Signer, explorerTxUrl, ReceiptLog, recordPolicyEvents, verifyLog, walrusBlobUrl } from "../src/index.js";
import { anchorMemo, anchorMemoInstruction, MEMO_PROGRAM_ADDRESS, parseAnchorMemo } from "../src/anchors/solana.js";
import { suiAnchorCall } from "../src/anchors/sui.js";
import { readWalrusUri, walrusStore, walrusUploader } from "../src/anchors/walrus.js";
import { Transaction } from "@mysten/sui/transactions";

const HEAD = `0x${"ab".repeat(32)}` as const;

describe("recordPolicyEvents", () => {
  it("turns the policy pipeline into a verifiable audit trail", async () => {
    const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const engine = createPolicyEngine({ policy: { limits: [{ asset: USDC, perTx: usdc(5) }] } });
    const log = new ReceiptLog({ signer: ed25519Signer() });
    const rec = recordPolicyEvents(engine, log);
    const action = { chain: "eip155:84532", kind: "transfer", to: "0x1111111111111111111111111111111111111111", spends: [{ asset: USDC, amount: usdc(1) }] };

    await engine.execute(action, { simulate: async () => ({ ok: true }), execute: async () => "0xtx", ref: (h) => h });
    await engine.execute({ ...action, spends: [{ asset: USDC, amount: usdc(9) }] }, { simulate: async () => ({ ok: true }), execute: async () => "0x" }).catch(() => {});
    engine.kill("demo");
    await rec.flush();

    const rs = await log.list();
    expect(rs.map((r) => r.type)).toEqual([
      "policy.decision",
      "policy.simulation",
      "policy.executed",
      "policy.committed",
      "policy.decision",
      "policy.kill_switch",
    ]);
    expect(rs[4]!.data).toMatchObject({ decision: { verdict: "deny", action: { spends: [{ amount: "9000000" }] } } });
    expect(rs[3]!.data).toMatchObject({ ref: "0xtx" });
    expect((await verifyLog(rs)).ok).toBe(true);

    rec.stop();
    engine.resume();
    await rec.flush();
    expect(await log.list()).toHaveLength(6);
  });

  it("can filter event types", async () => {
    const engine = createPolicyEngine({ policy: { unknownAssets: "allow", requireSimulation: false } });
    const log = new ReceiptLog({ signer: ed25519Signer() });
    const rec = recordPolicyEvents(engine, log, { include: ["executed"] });
    await engine.execute({ chain: "x", kind: "k", to: "y", spends: [] }, { execute: async () => 1 });
    await rec.flush();
    expect((await log.list()).map((r) => r.type)).toEqual(["policy.executed"]);
  });
});

describe("solana memo anchor", () => {
  it("round-trips the memo text", () => {
    const memo = anchorMemo({ seq: 7, head: HEAD, uri: "walrus://abc" });
    expect(memo).toBe(`kit-receipts:v1:7:${HEAD}:walrus://abc`);
    expect(parseAnchorMemo(memo)).toEqual({ seq: 7, head: HEAD, uri: "walrus://abc" });
    expect(parseAnchorMemo(`kit-receipts:v1:7:${HEAD}`)).toEqual({ seq: 7, head: HEAD });
    expect(parseAnchorMemo("hello")).toBeUndefined();
  });

  it("builds a @solana/kit-shaped memo instruction", () => {
    const signer = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const ix = anchorMemoInstruction({ seq: 1, head: HEAD }, signer);
    expect(ix.programAddress).toBe(MEMO_PROGRAM_ADDRESS);
    expect(ix.accounts).toEqual([{ address: signer, role: 2 }]);
    expect(new TextDecoder().decode(ix.data)).toBe(`kit-receipts:v1:1:${HEAD}`);
    expect(() => anchorMemoInstruction({ seq: 1, head: HEAD, uri: "x".repeat(600) })).toThrow(/too long/);
  });
});

describe("sui anchor call", () => {
  it("targets <pkg>::anchor::anchor with head bytes, seq and uri", () => {
    const tx = new Transaction();
    suiAnchorCall(tx, "0x2a", { seq: 3, head: HEAD, uri: "walrus://x" });
    const call = tx.getData().commands[0]!.MoveCall!;
    expect(call).toMatchObject({ module: "anchor", function: "anchor" });
    expect(call.arguments).toHaveLength(3);
  });
});

describe("walrus", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("stores a new blob", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      ok({ newlyCreated: { blobObject: { id: "0xobj", blobId: "BLOB", storage: { endEpoch: 12 } } } }),
    );
    const res = await walrusStore("hello", { fetch: fetch as typeof globalThis.fetch, epochs: 3, sendObjectTo: "0xme" });
    expect(res).toEqual({ blobId: "BLOB", objectId: "0xobj", newlyCreated: true, endEpoch: 12 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=3&send_object_to=0xme");
    expect(init).toMatchObject({ method: "PUT", body: "hello" });
  });

  it("handles already-certified blobs and errors", async () => {
    const f1 = (async () => ok({ alreadyCertified: { blobId: "B2", endEpoch: 9 } })) as unknown as typeof globalThis.fetch;
    expect(await walrusStore("x", { fetch: f1 })).toEqual({ blobId: "B2", newlyCreated: false, endEpoch: 9 });
    const f2 = (async () => new Response("nope", { status: 500 })) as unknown as typeof globalThis.fetch;
    await expect(walrusStore("x", { fetch: f2 })).rejects.toThrow(/500/);
  });

  it("uploader returns a walrus:// uri and reads it back", async () => {
    const store = new Map<string, string>();
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PUT") {
        store.set("ID1", String(init.body));
        return ok({ newlyCreated: { blobObject: { id: "0x1", blobId: "ID1" } } });
      }
      return new Response(store.get(String(url).split("/").pop()!) ?? "", { status: 200 });
    }) as typeof globalThis.fetch;
    const up = await walrusUploader({ fetch }).upload("log-content");
    expect(up).toEqual({ id: "ID1", uri: "walrus://ID1", url: walrusBlobUrl("ID1") });
    expect(await readWalrusUri(up.uri, { fetch })).toBe("log-content");
  });
});

describe("explorer links", () => {
  it("covers evm, solana and sui", () => {
    expect(explorerTxUrl("eip155:84532", "0x1")).toBe("https://sepolia.basescan.org/tx/0x1");
    expect(explorerTxUrl("solana:devnet", "sig")).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
    expect(explorerTxUrl("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "sig")).toBe("https://explorer.solana.com/tx/sig");
    expect(explorerTxUrl("sui:testnet", "D")).toBe("https://suiscan.xyz/testnet/tx/D");
    expect(explorerTxUrl("eip155:31337", "0x1")).toBeUndefined();
    expect(explorerTxUrl("eip155:31337", "0x1", { "eip155:31337": "http://localhost:8080" })).toBe("http://localhost:8080/tx/0x1");
  });
});
