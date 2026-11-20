import { WalletProvider } from "@codkit/wallet";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConnectButton, sameWallet, suggestedWallets } from "../src/index.js";
import { fakeAdapter } from "./fake-adapter.js";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const link = (name: string) => suggestedWallets.find((s) => s.name === name)!;
const page = "https://shop.example/swap?pair=SOL-USDC";

describe("suggested wallet links", () => {
  it("build the documented open-in-app links", () => {
    expect(link("Phantom").openIn!(page)).toBe(
      "https://phantom.com/ul/browse/https%3A%2F%2Fshop.example%2Fswap%3Fpair%3DSOL-USDC?ref=https%3A%2F%2Fshop.example",
    );
    expect(link("Solflare").openIn!(page)).toBe(
      "https://solflare.com/ul/v1/browse/https%3A%2F%2Fshop.example%2Fswap%3Fpair%3DSOL-USDC?ref=https%3A%2F%2Fshop.example",
    );
    expect(link("Backpack").openIn!(page)).toMatch(/^https:\/\/backpack\.app\/ul\/v1\/browse\/https%3A%2F%2Fshop\.example/);
    expect(link("MetaMask").openIn!(page)).toBe("https://link.metamask.io/dapp/shop.example/swap?pair=SOL-USDC");
    // no unverified links: these only have install pages
    for (const n of ["Coinbase Wallet", "Trust Wallet", "Rabby"]) expect(link(n).openIn).toBeUndefined();
    for (const s of suggestedWallets) expect(s.install).toMatch(/^https:\/\//);
  });

  it("matches installed wallets by name, loosely", () => {
    expect(sameWallet("Rabby Wallet", "Rabby")).toBe(true);
    expect(sameWallet("Trust Wallet", "Trust Wallet")).toBe(true);
    expect(sameWallet("MetaMask", "Meta Mask")).toBe(true);
    expect(sameWallet("Phantom", "Backpack")).toBe(false);
  });
});

describe("ConnectButton suggestions", () => {
  const show = (ui: React.ReactElement, adapters: Parameters<typeof WalletProvider>[0]["adapters"]) => {
    render(<WalletProvider adapters={adapters}>{ui}</WalletProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  };

  it("lists missing wallets with install links under the installed ones (desktop)", () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    evm.set({ wallets: [{ id: "io.rabby", name: "Rabby Wallet", ecosystem: "evm" }] });
    show(<ConnectButton />, [evm.adapter]);
    expect(screen.getByText("Get a wallet")).toBeTruthy();
    const mm = screen.getByRole("link", { name: /MetaMask/ });
    expect(mm.getAttribute("href")).toBe("https://metamask.com/download/");
    expect(mm.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: /Rabby/ })).toBeNull(); // installed, so not suggested
    expect(screen.getByRole("button", { name: /Rabby Wallet/ })).toBeTruthy();
  });

  it("with no wallet installed, explains and offers install links without a heading", () => {
    const sol = fakeAdapter("solana", ["solana-devnet"]);
    sol.set({ wallets: [] });
    show(<ConnectButton />, [sol.adapter]);
    expect(screen.getByText(/No Solana wallet found in this browser\. Install one, then reload\./)).toBeTruthy();
    expect(screen.queryByText("Get a wallet")).toBeNull();
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "PPhantomInstall ↗",
      "SSolflareInstall ↗",
      "BBackpackInstall ↗",
    ]);
  });

  it("on a phone, opens the page inside the wallet app instead", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
    const sol = fakeAdapter("solana", ["solana-devnet"]);
    sol.set({ wallets: [] });
    show(<ConnectButton />, [sol.adapter]);
    await act(async () => {}); // flush the mobile-detection effect
    expect(screen.getByText("Open this page in a wallet app to connect.")).toBeTruthy();
    const phantom = screen.getByRole("link", { name: /Open in Phantom/ });
    expect(phantom.getAttribute("href")).toBe(link("Phantom").openIn!(window.location.href));
    expect(phantom.getAttribute("target")).toBeNull(); // same tab: the OS hands it to the app
  });

  it("takes custom suggestions, or none", () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    evm.set({ wallets: [] });
    show(<ConnectButton suggestions={[{ name: "Acme Wallet", ecosystems: ["evm"], install: "https://acme.example/get" }]} />, [
      evm.adapter,
    ]);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["https://acme.example/get"]);
    cleanup();
    show(<ConnectButton suggestions={[]} />, [evm.adapter]);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText(/No Ethereum & EVM wallet found in this browser\.$/)).toBeTruthy();
  });

  it("words the kept-connection note with proper spacing", () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    evm.set({ lastDisconnect: { wallet: { id: "okx", name: "OKX Wallet", ecosystem: "evm" }, revoked: false } });
    show(<ConnectButton suggestions={[]} />, [evm.adapter]);
    expect(screen.getByText(/keeps this site connected/).textContent).toContain("switch accounts in OKX Wallet first, or remove");
  });
});
