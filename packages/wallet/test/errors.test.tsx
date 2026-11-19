import { UnknownRpcError, UserRejectedRequestError, verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { injected } from "wagmi/connectors";
import { beforeEach, describe, expect, it } from "vitest";
import { toWalletError, WalletError } from "../src/errors.js";
import { evmAdapter } from "../src/evm.js";

describe("toWalletError", () => {
  it("turns viem's rejection into one plain sentence", () => {
    const viem = new UserRejectedRequestError(new Error("User rejected the request."));
    expect(viem.message).toMatch(/Version: viem@/); // what the UI used to show
    const e = toWalletError(viem, { wallet: "OKX Wallet", action: "connect" });
    expect(e).toBeInstanceOf(WalletError);
    expect(e).toMatchObject({ code: "rejected", message: "You rejected the request in OKX Wallet." });
    expect(e.cause).toBe(viem);
  });

  it("recognises Wallet Standard rejections (Phantom-style objects and messages)", () => {
    expect(toWalletError({ code: 4001, message: "User rejected the request." }, { wallet: "Phantom" }).code).toBe("rejected");
    expect(toWalletError(new Error("Transaction cancelled"), { wallet: "Backpack" }).code).toBe("rejected");
  });

  it("keeps the wallet's own reason instead of 'An unknown RPC error occurred'", () => {
    const viem = new UnknownRpcError(Object.assign(new Error("invalid message encoding"), { code: -32099 }));
    const e = toWalletError(viem, { wallet: "HOT Wallet", action: "sign the message" });
    expect(e.code).toBe("wallet");
    expect(e.message).toContain("HOT Wallet couldn't sign the message");
    expect(e.message).toContain("invalid message encoding");
    expect(e.message).not.toMatch(/viem@/);
  });

  it("maps pending and unsupported requests", () => {
    expect(toWalletError({ code: -32002, message: "already pending" }, { wallet: "MetaMask" })).toMatchObject({
      code: "pending",
      message: "MetaMask already has a request open. Check the extension.",
    });
    expect(toWalletError({ code: 4200, message: "nope" }, { wallet: "X", action: "sign the message" }).code).toBe("unsupported");
  });
});

type Req = { method: string; params?: unknown[] };

/** An EIP-1193 wallet with a real key, behind wagmi's own injected() connector. */
function fakeWallet(opts: { textOnlySign?: boolean; revoke?: boolean; reject?: boolean; rejectSign?: boolean; failSign?: string } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  let approved = false;
  const calls: Req[] = [];
  const provider = {
    request: async ({ method, params = [] }: Req) => {
      calls.push({ method, params });
      const deny = () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      };
      switch (method) {
        case "wallet_requestPermissions":
        case "eth_requestAccounts":
          if (opts.reject) deny();
          approved = true;
          return method === "eth_requestAccounts"
            ? [account.address]
            : [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [account.address] }] }];
        case "eth_accounts":
          return approved ? [account.address] : [];
        case "eth_chainId":
          return "0x14a34"; // Base Sepolia
        case "wallet_revokePermissions":
          if (!opts.revoke) throw Object.assign(new Error("Method not supported"), { code: 4200 });
          approved = false;
          return null;
        case "personal_sign": {
          const message = params[0] as string;
          if (opts.reject || opts.rejectSign) deny();
          if (opts.failSign) throw Object.assign(new Error(opts.failSign), { code: -32603 });
          if (opts.textOnlySign && message.startsWith("0x"))
            throw Object.assign(new Error("Internal error: invalid message"), { code: -32603 });
          return account.signMessage({ message: opts.textOnlySign ? message : { raw: message as `0x${string}` } });
        }
        default:
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      }
    },
    on: () => {},
    removeListener: () => {},
  };
  const connector = injected({ target: () => ({ id: "fake", name: "Fake Wallet", provider: provider as never }) });
  const adapter = evmAdapter({ chains: ["base-sepolia"], env: {}, connectors: [connector] });
  return { account, calls, adapter };
}

describe("evmAdapter against real wallet quirks", () => {
  // wagmi persists its connection in localStorage; start each test from a fresh browser
  beforeEach(() => localStorage.clear());

  it("signs with wallets that only accept plain-text personal_sign", async () => {
    const { adapter, account, calls } = fakeWallet({ textOnlySign: true });
    const off = adapter.mount();
    await adapter.connect("fake");
    const sig = await adapter.signMessage("Hello from codkit");
    expect(await verifyMessage({ address: account.address, message: "Hello from codkit", signature: sig as `0x${string}` })).toBe(true);
    expect(calls.filter((c) => c.method === "personal_sign").map((c) => (c.params![0] as string).startsWith("0x"))).toEqual([true, false]);
    off();
  });

  it("does not retry a rejected signature, and says so plainly", async () => {
    const { adapter, calls } = fakeWallet({ rejectSign: true });
    const off = adapter.mount();
    await adapter.connect("fake");
    const err = await adapter.signMessage("hi").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "rejected", message: "You rejected the request in Fake Wallet." });
    expect(calls.filter((c) => c.method === "personal_sign")).toHaveLength(1); // one prompt, no second one
    off();
  });

  it("reports a wallet's own signing error, without the viem footer", async () => {
    const { adapter } = fakeWallet({ failSign: "signing is disabled for this account" });
    const off = adapter.mount();
    await adapter.connect("fake");
    const err = await adapter.signMessage("hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WalletError);
    expect((err as WalletError).message).toMatch(/^Fake Wallet couldn't sign the message\. .*signing is disabled for this account/);
    expect((err as WalletError).message).not.toMatch(/viem@/);
    expect(adapter.getSnapshot().error).toBe(err);
    off();
  });

  it("turns a rejected connection into a WalletError the UI can show as is", async () => {
    const { adapter } = fakeWallet({ reject: true });
    const off = adapter.mount();
    const err = await adapter.connect("fake").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "rejected", message: "You rejected the request in Fake Wallet." });
    off();
  });

  it("records whether disconnect really revoked the site", async () => {
    const keeps = fakeWallet({ revoke: false });
    let off = keeps.adapter.mount();
    await keeps.adapter.connect("fake");
    await keeps.adapter.disconnect();
    expect(keeps.adapter.getSnapshot()).toMatchObject({
      status: "disconnected",
      lastDisconnect: { wallet: { name: "Fake Wallet" }, revoked: false },
    });
    await keeps.adapter.connect("fake");
    expect(keeps.adapter.getSnapshot().lastDisconnect).toBeUndefined();
    off();

    const forgets = fakeWallet({ revoke: true });
    off = forgets.adapter.mount();
    await forgets.adapter.connect("fake");
    await forgets.adapter.disconnect();
    expect(forgets.adapter.getSnapshot().lastDisconnect).toMatchObject({ revoked: true });
    // connecting again asks for permissions (the account picker), not a silent reuse
    await forgets.adapter.connect("fake");
    expect(forgets.calls.filter((c) => c.method === "wallet_requestPermissions")).toHaveLength(2);
    off();
  });
});
