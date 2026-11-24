import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createPublicClient, http, parseEther, verifyMessage } from "viem";
import { mock } from "wagmi/connectors";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { evmAdapter } from "../src/evm.js";
import { useWallet, useWallets, WalletProvider } from "../src/index.js";
import { solanaAdapter } from "../src/solana.js";
import { generateKeyPairSigner } from "@solana/kit";
import { fakeSolanaWallet, registerWallet, startAnvil } from "./helpers.js";

// Anvil's first two dev accounts (public, local only)
const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB = "0x70997970C51812dC3A010c7d01b54e0aEA6e9Cc8";

let anvil: Awaited<ReturnType<typeof startAnvil>>;
beforeAll(async () => {
  anvil = await startAnvil();
});
afterAll(() => anvil.stop());

const adapter = () => evmAdapter({ chains: ["anvil"], env: { ANVIL_RPC_URL: anvil.url }, connectors: [mock({ accounts: [ALICE] })] });

describe("evmAdapter wallet list", () => {
  const ids = (a: ReturnType<typeof evmAdapter>) => a.getSnapshot().wallets.map((w) => w.id);
  afterEach(() => {
    Reflect.deleteProperty(window, "ethereum");
  });

  it("lists no wallet when the browser has none (no phantom 'Injected' option)", () => {
    expect(ids(evmAdapter({ chains: ["anvil"], env: {} }))).toEqual([]);
  });

  it("lists the generic injected wallet only for wallets that predate EIP-6963", () => {
    Object.assign(window, { ethereum: { request: async () => [] } });
    expect(evmAdapter({ chains: ["anvil"], env: {} }).getSnapshot().wallets).toEqual([
      { id: "injected", name: "Injected", ecosystem: "evm" },
    ]);
  });
});

describe("evmAdapter", () => {
  it("lists connectors, connects, signs, sends and confirms on a real node", async () => {
    const a = adapter();
    const off = a.mount();
    expect(a.getSnapshot().wallets.map((w) => w.id)).toEqual(expect.arrayContaining(["mock"]));
    expect(a.getSnapshot()).toMatchObject({ status: "disconnected", chain: { key: "anvil" } });

    await a.connect("mock");
    expect(a.getSnapshot()).toMatchObject({ status: "connected", address: ALICE, wallet: { id: "mock", ecosystem: "evm" } });

    const signature = (await a.signMessage("hello codkit")) as `0x${string}`;
    expect(await verifyMessage({ address: ALICE, message: "hello codkit", signature })).toBe(true);

    const client = createPublicClient({ transport: http(anvil.url) });
    const before = await client.getBalance({ address: BOB });
    const hash = await a.sendTransaction({ to: BOB, value: parseEther("1") });
    expect(await a.waitForTransaction(hash)).toEqual({ ok: true });
    expect((await client.getBalance({ address: BOB })) - before).toBe(parseEther("1"));

    await a.disconnect();
    expect(a.getSnapshot()).toMatchObject({ status: "disconnected", address: undefined, wallet: undefined });
    off();
  });

  it("rejects chains it wasn't configured with", async () => {
    const a = adapter();
    await expect(a.switchChain("base")).rejects.toThrow(/not one of this adapter's chains/);
    expect(() => evmAdapter({ chains: ["solana-devnet"] })).toThrow(/not an EVM chain/);
  });
});

describe("useWallet across ecosystems", () => {
  it("returns each ecosystem's wallet, and the connected one by default", async () => {
    const adapters = [adapter(), solanaAdapter({ chains: ["solana-devnet"] })];
    const wrapper = ({ children }: { children: ReactNode }) => <WalletProvider adapters={adapters}>{children}</WalletProvider>;
    const { result } = renderHook(() => ({ evm: useWallet("evm"), any: useWallet(), all: useWallets() }), { wrapper });
    expect(result.current.all.map((w) => w.ecosystem)).toEqual(["evm", "solana"]);
    await act(() => result.current.evm.connect("mock"));
    expect(result.current.evm).toMatchObject({ status: "connected", address: ALICE });
    expect(result.current.any.ecosystem).toBe("evm");
    await act(() => result.current.evm.disconnect());
  });

  it("explains a missing provider or adapter", () => {
    expect(() => renderHook(() => useWallet())).toThrow(/inside <WalletProvider>/);
    const adapters = [solanaAdapter({ chains: ["solana-devnet"] })];
    const wrapper = ({ children }: { children: ReactNode }) => <WalletProvider adapters={adapters}>{children}</WalletProvider>;
    expect(() => renderHook(() => useWallet("evm"), { wrapper })).toThrow(/no evm adapter/);
  });
});

describe("useWallet with the Solana adapter", () => {
  it("re-renders on connect", async () => {
    const signer = await generateKeyPairSigner();
    registerWallet(fakeSolanaWallet(signer, { name: "Hooked" }).wallet);
    const adapters = [solanaAdapter({ chains: ["solana-devnet"] })];
    const wrapper = ({ children }: { children: ReactNode }) => <WalletProvider adapters={adapters}>{children}</WalletProvider>;
    const { result } = renderHook(() => useWallet("solana"), { wrapper });
    expect(result.current.status).toBe("disconnected");
    await act(() => result.current.connect("Hooked"));
    expect(result.current).toMatchObject({ ecosystem: "solana", status: "connected", address: signer.address });
  });
});
