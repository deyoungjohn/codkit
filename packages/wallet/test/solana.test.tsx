// @vitest-environment node
// Node, not happy-dom: @solana/kit's fetch needs Node's own AbortSignal. Wallet Standard only needs a window to talk over.
import "./node-window.js";
import { getTransferSolInstruction } from "@solana-program/system";
import { address, createNoopSigner, generateKeyPairSigner, getBase58Encoder, getPublicKeyFromAddress, verifySignature } from "@solana/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { solanaAdapter } from "../src/solana.js";
import { fakeSolanaRpc, fakeSolanaWallet, registerWallet } from "./helpers.js";

const waitFor = async (check: () => void, ms = 2000) => {
  const until = Date.now() + ms;
  for (;;) {
    try {
      return check();
    } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
};

let rpc: Awaited<ReturnType<typeof fakeSolanaRpc>>;
beforeAll(async () => {
  rpc = await fakeSolanaRpc({ failed: new Set() });
});
afterAll(() => rpc.close());
beforeEach(() => localStorage.clear());

const adapter = () =>
  solanaAdapter({ chains: ["solana-devnet", "solana"], env: { SOLANA_DEVNET_RPC_URL: rpc.url, SOLANA_RPC_URL: rpc.url } });

describe("solanaAdapter", () => {
  it("discovers Wallet Standard wallets as they register", async () => {
    const a = adapter();
    const off = a.mount();
    const { wallet } = fakeSolanaWallet(await generateKeyPairSigner(), { name: "Discovered" });
    registerWallet(wallet);
    expect(a.getSnapshot().wallets.map((w) => w.name)).toContain("Discovered");
    expect(a.getSnapshot()).toMatchObject({ status: "disconnected", chain: { key: "solana-devnet" } });
    off();
  });

  it("connects, signs a message verifiably, and disconnects", async () => {
    const signer = await generateKeyPairSigner();
    const fake = fakeSolanaWallet(signer, { name: "Signer" });
    registerWallet(fake.wallet);
    const a = adapter();
    const off = a.mount();
    await a.connect("Signer");
    expect(a.getSnapshot()).toMatchObject({
      status: "connected",
      address: signer.address,
      wallet: { name: "Signer", ecosystem: "solana" },
    });

    const sig = await a.signMessage("hello codkit");
    const key = await getPublicKeyFromAddress(address(signer.address));
    expect(await verifySignature(key, getBase58Encoder().encode(sig) as never, new TextEncoder().encode("hello codkit"))).toBe(true);

    await a.disconnect();
    expect(a.getSnapshot()).toMatchObject({ status: "disconnected", address: undefined, wallet: undefined });
    off();
  });

  it("builds the transaction with the wallet as fee payer and sends it on the selected cluster", async () => {
    const signer = await generateKeyPairSigner();
    const fake = fakeSolanaWallet(signer, { name: "Sender" });
    registerWallet(fake.wallet);
    const a = adapter();
    const off = a.mount();
    await a.connect("Sender");
    const to = (await generateKeyPairSigner()).address;
    const ix = getTransferSolInstruction({ source: createNoopSigner(address(signer.address)), destination: to, amount: 1_000n });

    const signature = await a.sendTransaction({ instructions: [ix] });
    expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(fake.sent).toEqual([
      { feePayer: signer.address, blockhash: rpc.blockhash, programs: ["11111111111111111111111111111111"], chain: "solana:devnet" },
    ]);
    expect(await a.waitForTransaction(signature)).toEqual({ ok: true });

    await a.switchChain("solana");
    await a.sendTransaction({ instructions: [ix] });
    expect(fake.sent[1]!.chain).toBe("solana:mainnet");
    await expect(a.switchChain("base-sepolia")).rejects.toThrow(/not one of this adapter's chains/);
    off();
  });

  it("reconnects the last wallet silently on the next page load", async () => {
    const fake = fakeSolanaWallet(await generateKeyPairSigner(), { name: "Remembered" });
    registerWallet(fake.wallet);
    const first = adapter();
    const off1 = first.mount();
    await first.connect("Remembered");
    off1();

    const second = adapter();
    const off2 = second.mount();
    await waitFor(() => expect(second.getSnapshot().status).toBe("connected"));
    expect(fake.connects.at(-1)).toEqual({ silent: true });
    off2();
  });

  it("follows account changes and disconnects made inside the wallet", async () => {
    const signer = await generateKeyPairSigner();
    const fake = fakeSolanaWallet(signer, { name: "Evented" });
    registerWallet(fake.wallet);
    const a = adapter();
    const off = a.mount();
    await a.connect("Evented");
    fake.emit([]);
    expect(a.getSnapshot().status).toBe("disconnected");
    off();
  });

  it("explains what is missing", async () => {
    const a = adapter();
    await expect(a.signMessage("x")).rejects.toThrow(/no Solana wallet connected/);
    await expect(a.connect("Nope")).rejects.toThrow(/no Solana wallet "Nope"/);
    expect(a.getSnapshot().error?.message).toMatch(/Nope/);
    expect(() => solanaAdapter({ chains: ["base-sepolia"] })).toThrow(/not a Solana chain/);
  });
});
