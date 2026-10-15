import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";
import { createEvmGuard } from "@iamyoungjohn-kit/policy/evm";
import { escrowAbi } from "@iamyoungjohn-kit/contracts";
import { decodeFunctionData, encodeEventTopics, encodeAbiParameters, erc20Abi, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { callTool } from "../src/index.js";
import { escrowTools } from "../src/tools/escrow.js";
import { evmTools } from "../src/tools/evm.js";
import { payTools } from "../src/tools/pay.js";

const ACCOUNT: Address = "0xA9e1000000000000000000000000000000000001";
const TOKEN: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ESCROW: Address = "0x00000000000000000000000000000000000E5c50";
const BOB: Address = "0x1111111111111111111111111111111111111111";

function guardWith(policyAllowEscrow = true) {
  const engine = createPolicyEngine({
    policy: {
      chains: ["eip155:84532"],
      allow: { programs: policyAllowEscrow ? [TOKEN, ESCROW] : [TOKEN] },
      limits: [{ asset: TOKEN, label: "USDC", perTx: usdc(10) }],
    },
  });
  const sent: { to: Address; data?: Hex }[] = [];
  const guard = createEvmGuard({
    engine,
    chainId: 84532,
    account: ACCOUNT,
    abis: [escrowAbi],
    reader: { call: async () => ({}), estimateGas: async () => 21_000n },
    sender: { sendTransaction: async (tx) => (sent.push(tx), `0x${sent.length.toString(16).padStart(64, "0")}` as Hex) },
  });
  return { engine, guard, sent };
}

describe("evm tools", () => {
  const reader = {
    getBalance: async () => 2n * 10n ** 17n,
    readContract: async () => usdc("12.5"),
  };

  it("reports balances in human units", async () => {
    const { guard } = guardWith();
    const [balance] = evmTools({ chainId: 84532, account: ACCOUNT, guard, reader, tokens: { USDC: { address: TOKEN, decimals: 6 } } });
    expect(JSON.parse((await callTool(balance!, {})).text)).toEqual({
      chain: "eip155:84532",
      address: ACCOUNT,
      balances: { native: "0.2", USDC: "12.5" },
    });
  });

  it("transfers through the policy guard and refuses over-cap amounts", async () => {
    const { guard, sent } = guardWith();
    const [, transfer] = evmTools({ chainId: 84532, account: ACCOUNT, guard, reader, tokens: { USDC: { address: TOKEN, decimals: 6 } } });
    const ok = await callTool(transfer!, { token: "USDC", to: BOB, amount: "1.5" });
    expect(ok.ok).toBe(true);
    expect(JSON.parse(ok.text).explorer).toMatch(/^https:\/\/sepolia\.basescan\.org\/tx\/0x/);
    expect(decodeFunctionData({ abi: erc20Abi, data: sent[0]!.data! }).args).toEqual([BOB, 1_500_000n]);

    const denied = await callTool(transfer!, { token: "USDC", to: BOB, amount: "50" });
    expect(denied).toMatchObject({ ok: false });
    expect(denied.text).toMatch(/denied: .*per-tx cap/);
    expect(await callTool(transfer!, { token: "DAI", to: BOB, amount: "1" })).toMatchObject({ ok: false });
    expect(await callTool(transfer!, { token: "USDC", to: "not-an-address", amount: "1" })).toMatchObject({ ok: false });
    expect(sent).toHaveLength(1);
  });
});

describe("escrow tools", () => {
  const dealCreatedLog = (id: bigint) => ({
    address: ESCROW,
    topics: encodeEventTopics({ abi: escrowAbi, eventName: "DealCreated", args: { id, client: ACCOUNT, provider: BOB } }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "uint32" }, { type: "bytes32" }],
      ["0x0000000000000000000000000000000000000000", TOKEN, 5_000_000n, 1n, 86400, `0x${"0".repeat(64)}`],
    ),
  });

  it("approves + funds through the guard and returns the deal id", async () => {
    const { guard, sent } = guardWith();
    const waitForTransactionReceipt = vi.fn(async () => ({ status: "success", logs: [dealCreatedLog(7n)] as never }));
    const [create] = escrowTools({
      chainId: 84532,
      escrow: ESCROW,
      token: { address: TOKEN, decimals: 6, symbol: "USDC" },
      guard,
      reader: { readContract: async () => ({}), waitForTransactionReceipt },
    });
    const res = await callTool(create!, { provider: BOB, amount: "5", deadlineHours: 24, terms: "Summarise 3 papers" });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.text).dealId).toBe("7");
    expect(sent.map((t) => t.to)).toEqual([TOKEN, ESCROW]);
    expect(decodeFunctionData({ abi: escrowAbi, data: sent[1]!.data! }).functionName).toBe("createAndFund");
  });

  it("is blocked when policy doesn't allow the escrow contract", async () => {
    const { guard, sent } = guardWith(false);
    const [create] = escrowTools({
      chainId: 84532,
      escrow: ESCROW,
      token: { address: TOKEN, decimals: 6, symbol: "USDC" },
      guard,
      reader: { readContract: async () => ({}), waitForTransactionReceipt: async () => ({ status: "success", logs: [] }) },
    });
    const res = await callTool(create!, { provider: BOB, amount: "5", deadlineHours: 24, terms: "x" });
    expect(res.ok).toBe(false);
    expect(res.text).toMatch(/not in allow list/);
    expect(sent).toHaveLength(1); // the approval went out; funding was refused
  });
});

describe("pay_fetch", () => {
  it("returns status, body and decoded settlement; enforces allowed hosts", async () => {
    const settle = btoa(JSON.stringify({ success: true, transaction: "0xabc", network: "eip155:84532" }));
    const fetch = vi.fn(async () => new Response("sunny", { status: 200, headers: { "PAYMENT-RESPONSE": settle } }));
    const [tool] = payTools({ fetch: fetch as unknown as typeof globalThis.fetch, allowedHosts: ["api.example.com"] });
    expect(JSON.parse((await callTool(tool!, { url: "https://api.example.com/weather" })).text)).toEqual({
      status: 200,
      paid: true,
      payment: { success: true, transaction: "0xabc", network: "eip155:84532" },
      body: "sunny",
    });
    expect((await callTool(tool!, { url: "https://evil.example/x" })).text).toMatch(/not in the allowed list/);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
