import { WalletProvider } from "@codkit/wallet";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AddressPill,
  ChainSwitcher,
  ConnectButton,
  formatAmount,
  parseAmount,
  shortAddress,
  TokenAmountInput,
  TxToastProvider,
  useTxToast,
} from "../src/index.js";
import { fakeAdapter } from "./fake-adapter.js";

beforeAll(() => {
  // happy-dom's <dialog> lacks showModal/close
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(cleanup);

const withWallets = (adapters: Parameters<typeof WalletProvider>[0]["adapters"], ui: ReactNode) =>
  render(<WalletProvider adapters={adapters}>{ui}</WalletProvider>);

function Harness({ max }: { max?: bigint }) {
  const [v, setV] = useState<bigint | undefined>();
  return (
    <>
      <TokenAmountInput value={v} onChange={setV} decimals={6} symbol="USDC" {...(max !== undefined && { max })} />
      <output>{v === undefined ? "none" : v.toString()}</output>
      <button type="button" onClick={() => setV(undefined)}>
        reset
      </button>
    </>
  );
}

function Sender() {
  const track = useTxToast();
  return (
    <button type="button" onClick={() => void track("evm", "0xabc", "Send 1 USDC")}>
      send
    </button>
  );
}

describe("units", () => {
  it("parses and formats exactly", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount(".25", 6)).toBe(250_000n);
    expect(parseAmount("1.", 6)).toBe(1_000_000n);
    expect(parseAmount("0.1234567", 6)).toBeUndefined();
    expect(parseAmount("", 6)).toBeUndefined();
    expect(parseAmount(".", 6)).toBeUndefined();
    expect(parseAmount("123456789012345678.123456789012345678", 18)).toBe(123456789012345678123456789012345678n);
    expect(formatAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatAmount(5n, 6)).toBe("0.000005");
    expect(formatAmount(10n ** 18n, 18)).toBe("1");
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddress("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("7xKX…gAsU");
  });
});

describe("ConnectButton", () => {
  it("shows one tab per ecosystem, closes after connecting, reopens on the next ecosystem, and disconnects", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    const sol = fakeAdapter("solana", ["solana-devnet"]);
    withWallets([evm.adapter, sol.adapter], <ConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getAllByRole("tab").map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([
      ["EVM", "true"],
      ["Solana", "false"],
    ]);
    // only the selected ecosystem's wallets are listed
    expect(screen.queryByRole("button", { name: /solana Wallet/ })).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /evm Wallet/ })));
    expect(evm.calls).toEqual(["connect:w1"]);
    expect(dialog.hasAttribute("open")).toBe(false); // closes on success
    expect(screen.getAllByText("0x1234…5678").length).toBeGreaterThan(0);

    // reopening starts on the ecosystem still to connect
    fireEvent.click(screen.getByRole("button", { name: "Add wallet" }));
    expect(screen.getByRole("tab", { name: "Solana" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /EVM/ }).querySelector(".ck-dot")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /solana Wallet/ })));
    expect(dialog.hasAttribute("open")).toBe(false);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Disconnect Ethereum & EVM" })));
    expect(evm.calls).toEqual(["connect:w1", "disconnect"]);
    expect(screen.getByRole("button", { name: "Add wallet" })).toBeTruthy();
  });

  it("moves between tabs with the arrow keys", () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    const sol = fakeAdapter("solana", ["solana-devnet"]);
    withWallets([evm.adapter, sol.adapter], <ConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "EVM" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Solana" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /solana Wallet/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Solana" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "EVM" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows the wallet's error in plain words and keeps the picker open", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    evm.set({ wallets: [{ id: "broken", name: "Broken", ecosystem: "evm" }] });
    withWallets([evm.adapter], <ConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.queryByRole("tablist")).toBeNull(); // a single ecosystem needs no tabs
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Broken/ })));
    expect(screen.getByRole("alert").textContent).toBe("User rejected the request");
    expect(screen.getByRole("dialog", { hidden: true }).hasAttribute("open")).toBe(true); // stays open on failure
  });

  it("explains a wallet that kept the site connected after a disconnect", () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    evm.set({ lastDisconnect: { wallet: { id: "okx", name: "OKX Wallet", ecosystem: "evm" }, revoked: false } });
    withWallets([evm.adapter], <ConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByText(/OKX Wallet keeps this site connected/).textContent).toMatch(/switch accounts in OKX Wallet/);
  });

  it("explains when no wallet is installed", () => {
    const sol = fakeAdapter("solana", ["solana-devnet"]);
    sol.set({ wallets: [] });
    withWallets([sol.adapter], <ConnectButton />);
    expect(screen.getByText(/No Solana wallet found/)).toBeTruthy();
  });
});

describe("ChainSwitcher", () => {
  it("switches between configured chains and hides itself with one chain", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia", "sepolia"]);
    withWallets([evm.adapter], <ChainSwitcher ecosystem="evm" />);
    const select = screen.getByRole("combobox", { name: "evm network" }) as HTMLSelectElement;
    expect(select.value).toBe("base-sepolia");
    await act(async () => fireEvent.change(select, { target: { value: "sepolia" } }));
    expect(evm.calls).toEqual(["switch:sepolia"]);
    expect(select.value).toBe("sepolia");
    cleanup();
    const one = fakeAdapter("evm", ["base-sepolia"]);
    const { container } = withWallets([one.adapter], <ChainSwitcher ecosystem="evm" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("TokenAmountInput", () => {
  it("emits atomic units, rejects extra decimals and non-numbers, supports Max and resets", () => {
    render(<Harness max={2_500_000n} />);
    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1.25" } });
    expect(screen.getByText("1250000")).toBeTruthy();
    fireEvent.change(input, { target: { value: "1.1234567" } });
    expect(screen.getByRole("alert").textContent).toMatch(/at most 6 decimals/);
    expect(screen.getByText("none")).toBeTruthy();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.value).toBe("1.1234567"); // non-numeric input is ignored
    fireEvent.change(input, { target: { value: "3" } });
    expect(screen.getByRole("alert").textContent).toMatch(/More than the 2.5 available/);
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(input.value).toBe("2.5");
    expect(screen.getByText("2500000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(input.value).toBe("");
  });
});

describe("TxToastProvider", () => {
  it("tracks a transaction from pending to confirmed with an explorer link", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    withWallets(
      [evm.adapter],
      <TxToastProvider autoDismissMs={0}>
        <Sender />
      </TxToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(screen.getByText("Waiting for confirmation…")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View" }).getAttribute("href")).toBe("https://sepolia.basescan.org/tx/0xabc");
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeTruthy());
  });

  it("shows a failure", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia"], { confirm: false });
    withWallets(
      [evm.adapter],
      <TxToastProvider>
        <Sender />
      </TxToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Reverted onchain"));
  });
});

describe("picker dismissal", () => {
  it("is labelled by its title and closes on a click outside its box when the browser has no closedby", () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    withWallets([evm.adapter], <ConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    const dialog = screen.getByRole("dialog", { name: "Connect a wallet", hidden: true });
    expect(dialog.hasAttribute("open")).toBe(true);
    dialog.getBoundingClientRect = () => ({ top: 100, bottom: 300, left: 100, right: 300 }) as DOMRect;
    fireEvent.click(screen.getByText("Connect a wallet")); // inside the dialog: stays
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent.click(dialog, { clientX: 50, clientY: 50 }); // the backdrop
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});

describe("TxToastProvider stack", () => {
  it("is a labelled notifications region that holds the toasts", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    withWallets(
      [evm.adapter],
      <TxToastProvider autoDismissMs={0}>
        <Sender />
      </TxToastProvider>,
    );
    const region = screen.getByRole("region", { name: "Notifications", hidden: true });
    expect(region.hasAttribute("popover")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(region.querySelectorAll(".ck-toast").length).toBe(1);
    await waitFor(() => expect(screen.getByText("Confirmed")).toBeTruthy());
  });
});

describe("AddressPill", () => {
  it("does not claim a copy that the browser refused", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    render(<AddressPill address="0x1234567890abcdef1234567890abcdef12345678" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Copy/ })));
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("copies the full address", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void (copied = t) }, configurable: true });
    render(<AddressPill address="0x1234567890abcdef1234567890abcdef12345678" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Copy/ })));
    expect(copied).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(screen.getByText("Copied")).toBeTruthy();
  });
});
