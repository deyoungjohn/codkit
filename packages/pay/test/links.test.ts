import { usdc } from "@codkit/policy";
import { decodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { paymentLink, paymentQrSvg, usdcAddress, usdcTransferTx } from "../src/links.js";

const EVM_TO = "0x2222222222222222222222222222222222222222";
const SOL_TO = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

describe("payment links", () => {
  it("builds EIP-681 links for USDC and native on EVM", () => {
    expect(paymentLink({ chain: "eip155:84532", to: EVM_TO, amount: usdc("1.5") })).toBe(
      `ethereum:0x036CbD53842c5426634e7929541eC2318f3dCF7e@84532/transfer?address=${EVM_TO}&uint256=1500000`,
    );
    expect(paymentLink({ chain: "eip155:1", to: EVM_TO, amount: 10n ** 18n, asset: "native" })).toBe(`ethereum:${EVM_TO}@1?value=1000000000000000000`);
  });

  it("builds Solana Pay transfer requests with decimal amounts", () => {
    const link = paymentLink({
      chain: DEVNET,
      to: SOL_TO,
      amount: usdc("0.05"),
      reference: ["11111111111111111111111111111112", "11111111111111111111111111111113"],
      label: "Data Shop",
      message: "Report #42",
    });
    const url = new URL(link);
    expect(url.protocol).toBe("solana:");
    expect(url.pathname).toBe(SOL_TO);
    expect(url.searchParams.get("amount")).toBe("0.05");
    expect(url.searchParams.get("spl-token")).toBe(usdcAddress(DEVNET));
    expect(url.searchParams.getAll("reference")).toHaveLength(2);
    expect(url.searchParams.get("label")).toBe("Data Shop");
    expect(link).toContain("message=Report%20%2342"); // spaces as %20, as Solana Pay wallets expect
    expect(paymentLink({ chain: DEVNET, to: SOL_TO, amount: 3n, asset: "native" })).toBe(`solana:${SOL_TO}?amount=0.000000003`);
    expect(paymentLink({ chain: DEVNET, to: SOL_TO, amount: usdc(2) })).toContain("amount=2&");
  });

  it("refuses chains it doesn't know", () => {
    expect(() => paymentLink({ chain: "sui:testnet", to: "0x1", amount: 1n })).toThrow(/no known USDC/);
    expect(() => paymentLink({ chain: "sui:testnet", to: "0x1", amount: 1n, asset: "0x2::sui::SUI" })).toThrow(/not supported/);
  });

  it("renders a QR code as SVG", () => {
    const svg = paymentQrSvg({ chain: "eip155:84532", to: EVM_TO, amount: usdc(1) });
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it("encodes a USDC transfer that the policy EVM adapter reads as a token transfer", () => {
    const tx = usdcTransferTx({ chain: "eip155:84532", to: EVM_TO, amount: usdc("2.5") });
    expect(tx.to).toBe(usdcAddress("eip155:84532"));
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toEqual({ functionName: "transfer", args: [EVM_TO, 2_500_000n] });
    expect(() => usdcTransferTx({ chain: DEVNET, to: SOL_TO, amount: 1n })).toThrow(/EVM-only/);
  });
});
