import { paywall } from "@codkit/pay/hono";
import { WalletProvider } from "@codkit/wallet";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Hono } from "hono";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayButton } from "../src/pay.js";
import { fakeAdapter } from "./fake-adapter.js";

const account = privateKeyToAccount(generatePrivateKey());
const PAY_TO = "0x2222222222222222222222222222222222222222";

/**
 * A facilitator that only settles what the payer really signed: it recovers the EIP-3009 authorization's
 * signer from the EIP-712 signature (USDC's own domain) and checks it is the wallet that paid.
 */
function strictFacilitator() {
  let n = 0;
  const recover = async (p: PaymentPayload, r: PaymentRequirements) => {
    const { signature, authorization: a } = p.payload as {
      signature: `0x${string}`;
      authorization: {
        from: `0x${string}`;
        to: `0x${string}`;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: `0x${string}`;
      };
    };
    const extra = r.extra as { name: string; version: string };
    const signer = await recoverTypedDataAddress({
      domain: {
        name: extra.name,
        version: extra.version,
        chainId: Number(r.network.split(":")[1]),
        verifyingContract: r.asset as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
      signature,
    });
    return { signer, a };
  };
  const f = {
    verify: vi.fn(async (p: PaymentPayload, r: PaymentRequirements) => {
      const { signer, a } = await recover(p, r);
      const ok = signer === a.from && a.to === r.payTo && a.value === r.amount;
      return ok ? { isValid: true, payer: signer } : { isValid: false, invalidReason: "bad_signature" };
    }),
    settle: vi.fn(async (p: PaymentPayload, r: PaymentRequirements) => ({
      success: true,
      transaction: `0x${(++n).toString(16).padStart(64, "0")}`,
      network: r.network,
      payer: (await recover(p, r)).signer,
    })),
    getSupported: vi.fn(async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" as const }],
      extensions: [],
      signers: {},
    })),
  } satisfies FacilitatorClient;
  return f;
}

let facilitator: ReturnType<typeof strictFacilitator>;
let signed: number;

function wallet() {
  const { adapter, set } = fakeAdapter("evm", ["base-sepolia"]);
  set({ status: "connected", address: account.address, wallet: { id: "w1", name: "Test", ecosystem: "evm" } });
  return Object.assign(adapter, {
    signTypedData: async (data: Parameters<typeof account.signTypedData>[0]) => {
      signed++;
      return account.signTypedData(data);
    },
  });
}

beforeEach(() => {
  signed = 0;
  facilitator = strictFacilitator();
  const shop = new Hono();
  shop.use(paywall({ payTo: PAY_TO, facilitator, routes: { "GET /price": "$0.001", "GET /report": "$0.05" } }));
  shop.get("/price", (c) => c.json({ eth: 3120.55 }));
  shop.get("/report", (c) => c.json({ report: "…" }));
  shop.get("/free", (c) => c.json({ ok: true }));
  // the button calls fetch("http://shop.test/…"); route those to the in-memory shop
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    return req.url.startsWith("http://shop.test/") ? shop.request(req) : real(input, init);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PayButton", () => {
  it("pays the 402 price with the connected wallet and shows the settlement", async () => {
    const got: unknown[] = [];
    render(
      <WalletProvider adapters={[wallet()]}>
        <PayButton url="http://shop.test/price" label="Test payment" onResponse={async (r) => void got.push(await r.json())} />
      </WalletProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test payment" })));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Paid 0\.001 USDC/));
    expect(screen.getByRole("link", { name: /View/ }).getAttribute("href")).toBe(
      `https://sepolia.basescan.org/tx/0x${"1".padStart(64, "0")}`,
    );
    expect(got).toEqual([{ eth: 3120.55 }]);
    expect(signed).toBe(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
    expect((await facilitator.settle.mock.results[0]!.value).payer).toBe(account.address);
  });

  it("refuses a price above the cap before the wallet is asked to sign", async () => {
    render(
      <WalletProvider adapters={[wallet()]}>
        <PayButton url="http://shop.test/report" label="Buy report" maxPerPayment="0.01" />
      </WalletProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Buy report" })));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Refused before signing/));
    expect(signed).toBe(0);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("stops at the session total", async () => {
    render(
      <WalletProvider adapters={[wallet()]}>
        <PayButton url="http://shop.test/price" label="Again" maxPerPayment="0.001" maxTotal="0.002" />
      </WalletProvider>,
    );
    for (let i = 0; i < 2; i++) {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Again" })));
      await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Paid/));
    }
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Again" })));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Refused before signing/));
    expect(signed).toBe(2);
  });

  it("asks for a wallet when none is connected, and says so when nothing was charged", async () => {
    const { adapter } = fakeAdapter("evm", ["base-sepolia"]);
    const { unmount } = render(
      <WalletProvider adapters={[adapter]}>
        <PayButton url="http://shop.test/price" label="Pay" />
      </WalletProvider>,
    );
    expect((screen.getByRole("button", { name: "Pay" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Connect a wallet to pay")).toBeTruthy();
    unmount();

    render(
      <WalletProvider adapters={[wallet()]}>
        <PayButton url="http://shop.test/free" label="Free" />
      </WalletProvider>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Free" })));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/no payment was asked for/));
    expect(signed).toBe(0);
  });
});
