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
  it("lists wallets per ecosystem, connects, shows the address and disconnects", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    const sol = fakeAdapter("solana", ["solana-devnet"]);
    withWallets([evm.adapter, sol.adapter], <ConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(screen.getByText("Ethereum & EVM")).toBeTruthy();
    expect(screen.getByText("Solana")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /evm Wallet/ })));
    expect(evm.calls).toEqual(["connect:w1"]);
    expect(screen.getByText("0x1234…5678")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View on explorer" }).getAttribute("href")).toBe(
      "https://sepolia.basescan.org/address/0x1234567890abcdef1234567890abcdef12345678",
    );
    // the other ecosystem can still be added
    expect(screen.getByRole("button", { name: "Add wallet" })).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Disconnect Ethereum & EVM" })));
    expect(evm.calls).toEqual(["connect:w1", "disconnect"]);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy();
  });

  it("shows the wallet's error and keeps the picker open", async () => {
    const evm = fakeAdapter("evm", ["base-sepolia"]);
    evm.set({ wallets: [{ id: "broken", name: "Broken", ecosystem: "evm" }] });
    withWallets([evm.adapter], <ConnectButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Broken/ })));
    expect(screen.getByRole("alert").textContent).toBe("User rejected the request");
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

describe("AddressPill", () => {
  it("copies the full address", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void (copied = t) }, configurable: true });
    render(<AddressPill address="0x1234567890abcdef1234567890abcdef12345678" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Copy/ })));
    expect(copied).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(screen.getByText("Copied")).toBeTruthy();
  });
});
