import { encodeFunctionData, erc20Abi, maxUint256, parseAbi, parseEther, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createEvmGuard, evmExplorerTxUrl, evmTxToAction, simulateEvmTx, type EvmReader } from "../src/adapters/evm.js";
import { createPolicyEngine, usdc } from "../src/index.js";

const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const AGENT: Address = "0xA9e1000000000000000000000000000000000001";
const ALICE: Address = "0x1111111111111111111111111111111111111111";
const ROUTER: Address = "0x2222222222222222222222222222222222222222";
const chainId = 84532;

describe("evmTxToAction", () => {
  it("maps a native transfer", () => {
    expect(evmTxToAction({ to: ALICE, value: parseEther("0.01") }, { chainId })).toMatchObject({
      chain: "eip155:84532",
      kind: "transfer",
      to: ALICE,
      spends: [{ asset: "native", amount: parseEther("0.01") }],
    });
  });

  it("decodes ERC20 transfer / approve / transferFrom", () => {
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ALICE, 1_000_000n] });
    expect(evmTxToAction({ to: USDC, data: transfer }, { chainId })).toMatchObject({
      kind: "token_transfer",
      to: ALICE,
      program: USDC,
      method: "transfer",
      spends: [{ asset: USDC, amount: 1_000_000n }],
    });

    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUint256] });
    expect(evmTxToAction({ to: USDC, data: approve }, { chainId })).toMatchObject({
      kind: "token_approval",
      to: ROUTER,
      method: "approve",
      spends: [{ asset: USDC, amount: maxUint256 }],
    });

    const from = encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [AGENT, ALICE, 5n] });
    expect(evmTxToAction({ to: USDC, data: from }, { chainId })).toMatchObject({ to: ALICE, spends: [{ asset: USDC, amount: 5n }] });
  });

  it("names unknown calls via extra ABIs, falling back to the selector", () => {
    const abi = parseAbi(["function swap(uint256 amountIn, uint256 minOut)"]);
    const data = encodeFunctionData({ abi, functionName: "swap", args: [1n, 2n] });
    expect(evmTxToAction({ to: ROUTER, data, value: 7n }, { chainId, abis: [abi] })).toMatchObject({
      kind: "contract_call",
      to: ROUTER,
      program: ROUTER,
      method: "swap",
      spends: [{ asset: "native", amount: 7n }],
    });
    expect(evmTxToAction({ to: ROUTER, data }, { chainId }).method).toBe(data.slice(0, 10));
  });
});

describe("simulateEvmTx", () => {
  it("returns ok with gas estimate", async () => {
    const reader: EvmReader = { call: async () => ({ data: "0x01" }), estimateGas: async () => 21_000n };
    expect(await simulateEvmTx(reader, AGENT, { to: ALICE, value: 1n })).toEqual({
      ok: true,
      details: { returnData: "0x01", gasEstimate: "21000" },
    });
  });

  it("reports reverts without throwing", async () => {
    const reader: EvmReader = {
      call: async () => Promise.reject(Object.assign(new Error("long"), { shortMessage: "execution reverted: ERC20: transfer amount exceeds balance" })),
      estimateGas: async () => 0n,
    };
    expect(await simulateEvmTx(reader, AGENT, { to: USDC })).toEqual({
      ok: false,
      error: "execution reverted: ERC20: transfer amount exceeds balance",
    });
  });
});

describe("createEvmGuard", () => {
  const engine = () =>
    createPolicyEngine({
      policy: {
        limits: [{ asset: USDC, label: "USDC", perTx: usdc(5) }],
        allow: { programs: [USDC] },
      },
    });

  it("simulates, sends and commits the tx hash", async () => {
    const eng = engine();
    const sendTransaction = vi.fn(async () => "0xdeadbeef" as const);
    const guard = createEvmGuard({
      engine: eng,
      chainId,
      account: AGENT,
      reader: { call: async () => ({}), estimateGas: async () => 50_000n },
      sender: { sendTransaction },
    });
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ALICE, usdc(1)] });
    const res = await guard.send({ to: USDC, data });
    expect(res.result).toBe("0xdeadbeef");
    expect(sendTransaction).toHaveBeenCalledWith({ to: USDC, data });
    expect(await eng.spendStore.list()).toEqual([expect.objectContaining({ status: "committed", ref: "0xdeadbeef" })]);
  });

  it("never sends a denied or reverting tx", async () => {
    const sendTransaction = vi.fn(async () => "0x" as const);
    const reverting = createEvmGuard({
      engine: engine(),
      chainId,
      account: AGENT,
      reader: { call: () => Promise.reject(new Error("reverted")), estimateGas: async () => 0n },
      sender: { sendTransaction },
    });
    const ok = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ALICE, usdc(1)] });
    const tooBig = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ALICE, usdc(50)] });
    const unlimited = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUint256] });
    await expect(reverting.send({ to: USDC, data: ok })).rejects.toMatchObject({ code: "simulation_failed" });
    await expect(reverting.send({ to: USDC, data: tooBig })).rejects.toMatchObject({ code: "denied" });
    await expect(reverting.send({ to: USDC, data: unlimited })).rejects.toMatchObject({ code: "denied" });
    await expect(reverting.send({ to: ROUTER, data: ok })).rejects.toMatchObject({ code: "denied" });
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});

it("builds explorer links", () => {
  expect(evmExplorerTxUrl(84532, "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
  expect(evmExplorerTxUrl(999999, "0xabc")).toBeUndefined();
  expect(evmExplorerTxUrl(999999, "0xabc", "https://explorer.example/")).toBe("https://explorer.example/tx/0xabc");
});
