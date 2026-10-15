import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { receiptAnchorBytecode } from "@iamyoungjohn-kit/contracts";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calldataAnchor,
  eip191Signer,
  eip191Verifier,
  evmAnchorer,
  parseCalldataAnchor,
  readEvmAnchors,
} from "../src/anchors/evm.js";
import { ed25519Signer, ReceiptLog, verifyLog } from "../src/index.js";

// anvil dev key #0 — public, local chain only
const KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(KEY);
let stop = () => {};
let pc: ReturnType<typeof createPublicClient>;
let wallet: ReturnType<typeof createWalletClient<ReturnType<typeof http>, typeof foundry, typeof account>>;
let contract: Address;

beforeAll(async () => {
  const port = await new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
  const proc = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  stop = () => proc.kill();
  const url = `http://127.0.0.1:${port}`;
  pc = createPublicClient({ chain: foundry, transport: http(url), pollingInterval: 50 });
  wallet = createWalletClient({ account, chain: foundry, transport: http(url), pollingInterval: 50 });
  for (let i = 0; i < 100; i++) {
    try {
      await pc.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const hash = await wallet.sendTransaction({ data: receiptAnchorBytecode });
  contract = (await pc.waitForTransactionReceipt({ hash })).contractAddress!;
}, 30_000);

afterAll(() => stop());

describe("EIP-191 receipts", () => {
  it("signs with an EVM account and verifies with the eip191 verifier", async () => {
    const log = new ReceiptLog({ signer: eip191Signer(account) });
    await log.append("tx.sent", { hash: "0x01" });
    await log.append("tx.sent", { hash: "0x02" });
    const rs = await log.list();
    expect(rs[0]!.actor).toBe(`eip191:${account.address}`);
    expect((await verifyLog(rs)).errors[0]!.reason).toMatch(/no verifier/);
    expect((await verifyLog(rs, { verifiers: { eip191: eip191Verifier } })).ok).toBe(true);

    const forged = JSON.parse(JSON.stringify(rs));
    forged[1].actor = "eip191:0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    expect((await verifyLog(forged, { verifiers: { eip191: eip191Verifier } })).ok).toBe(false);
  });
});

describe("EVM anchoring on anvil", () => {
  it("anchors via the ReceiptAnchor contract and reads it back", async () => {
    const log = new ReceiptLog({ signer: ed25519Signer() });
    for (let i = 0; i < 3; i++) await log.append("step", { i });
    const anchorer = evmAnchorer({ chainId: 31337, wallet, contract, waitFor: pc });
    const res = await log.publish({ anchorer, uploader: { upload: async () => ({ id: "b", uri: "walrus://b" }) } });
    expect(res.anchor).toMatchObject({ chain: "eip155:31337" });

    const anchors = await readEvmAnchors(pc, { contract, logger: account.address });
    expect(anchors).toEqual([
      expect.objectContaining({ logger: account.address, head: res.checkpoint.head, seq: 2, uri: "walrus://b", tx: res.anchor!.tx }),
    ]);
    // the published log (incl. the later anchor receipt) still proves the anchored head
    const a = anchors[0]!;
    expect((await verifyLog(await log.list(), { anchor: a })).ok).toBe(true);
  });

  it("anchors in calldata with zero deployment", async () => {
    const log = new ReceiptLog({ signer: ed25519Signer() });
    await log.append("only", {});
    const res = await log.publish({ anchorer: evmAnchorer({ chainId: 31337, wallet, waitFor: pc }) });
    const tx = await pc.getTransaction({ hash: res.anchor!.tx as Hex });
    expect(tx.to?.toLowerCase()).toBe(account.address.toLowerCase());
    expect(parseCalldataAnchor(tx.input)).toEqual({ head: res.checkpoint.head, seq: 0 });
    expect(parseCalldataAnchor(calldataAnchor(res.checkpoint.head, 5))?.seq).toBe(5);
    expect(parseCalldataAnchor("0xdeadbeef")).toBeUndefined();
  });
});
