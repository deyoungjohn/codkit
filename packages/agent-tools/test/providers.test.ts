import { decodeFunctionData, parseAbi, type PublicClient, type Transport, type Chain } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { EvmAsset, EvmSwapQuoteRequest } from "../src/evm.js";
import { lifi } from "../src/lifi.js";
import { uniswapV3, uniswapV3Deployments } from "../src/uniswap.js";
import fixture from "./fixtures/lifi-base-usdc-eth.json" with { type: "json" };

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const ETH: EvmAsset = { symbol: "ETH", address: "native", decimals: 18 };
const USDC: EvmAsset = { symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 };
const DAI: EvmAsset = { symbol: "DAI", address: "0x2222222222222222222222222222222222222222", decimals: 18 };
const dep = uniswapV3Deployments[84532]!;

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
]);

/** A client whose quoter answers per fee tier: a number is the output, `null` means that pool doesn't exist (reverts). */
const quoterWith = (byFee: Record<number, bigint | null>) =>
  ({
    simulateContract: vi.fn(async ({ args }: { args: [{ fee: number }] }) => {
      const out = byFee[args[0].fee];
      if (out === null || out === undefined) throw new Error("execution reverted");
      return { result: [out, 0n, 0, 0n] };
    }),
  }) as unknown as PublicClient<Transport, Chain | undefined>;

const request = (over: Partial<EvmSwapQuoteRequest> & { publicClient: EvmSwapQuoteRequest["publicClient"] }): EvmSwapQuoteRequest => ({
  chainId: 84532,
  account: ACCOUNT,
  from: ETH,
  to: USDC,
  amount: 10n ** 15n,
  slippageBps: 50,
  ...over,
});

const decode = (data: `0x${string}`) => {
  const multi = decodeFunctionData({ abi: routerAbi, data });
  const [deadline, calls] = multi.args as [bigint, `0x${string}`[]];
  return { deadline, calls: calls.map((c) => decodeFunctionData({ abi: routerAbi, data: c })) };
};

describe("uniswapV3", () => {
  it("picks the fee tier with the best output and applies slippage to it", async () => {
    const p = uniswapV3();
    const q = await p.quote(request({ publicClient: quoterWith({ 100: 900n, 500: null, 3000: 1000n, 10000: 950n }) }));
    expect(q.expected).toBe(1000n);
    expect(q.min).toBe(995n); // 1000 × (1 − 0.5%)
    expect(q.details).toEqual({ feeTier: 3000 });
  });

  it("ETH in: wraps by attaching value, needs no approval, pays the user directly", async () => {
    const q = await uniswapV3().quote(request({ publicClient: quoterWith({ 3000: 1000n }) }));
    expect(q.tx.to).toBe(dep.router);
    expect(q.tx.value).toBe(10n ** 15n);
    expect(q.spender).toBeUndefined();
    const { deadline, calls } = decode(q.tx.data!);
    expect(Number(deadline)).toBeGreaterThan(Date.now() / 1000);
    expect(Number(deadline)).toBeLessThanOrEqual(Date.now() / 1000 + 301);
    expect(q.expiresAt).toBe(Number(deadline));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args![0]).toMatchObject({
      tokenIn: dep.weth,
      tokenOut: USDC.address,
      fee: 3000,
      recipient: ACCOUNT,
      amountIn: 10n ** 15n,
      amountOutMinimum: 995n,
      sqrtPriceLimitX96: 0n,
    });
  });

  it("token in: attaches no value and names the router as the spender", async () => {
    const q = await uniswapV3().quote(
      request({ from: USDC, to: DAI, amount: 5_000_000n, publicClient: quoterWith({ 500: 2_000_000_000_000_000_000n }) }),
    );
    expect(q.tx.value).toBeUndefined();
    expect(q.spender).toBe(dep.router);
    expect(decode(q.tx.data!).calls[0]!.args![0]).toMatchObject({
      tokenIn: USDC.address,
      tokenOut: DAI.address,
      recipient: ACCOUNT,
      amountIn: 5_000_000n,
    });
  });

  it("ETH out: swaps to the router, then unwraps to the user with the same minimum", async () => {
    const q = await uniswapV3().quote(
      request({ from: USDC, to: ETH, amount: 1_000_000n, publicClient: quoterWith({ 100: 4_000_000_000_000_000n }) }),
    );
    const { calls } = decode(q.tx.data!);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args![0]).toMatchObject({ tokenOut: dep.weth, recipient: "0x0000000000000000000000000000000000000002" });
    expect(calls[1]).toMatchObject({ functionName: "unwrapWETH9", args: [q.min, ACCOUNT] });
  });

  it("explains when no pool has liquidity, and refuses a pair that is one pool side", async () => {
    await expect(uniswapV3().quote(request({ publicClient: quoterWith({}) }))).rejects.toThrow(
      /no Uniswap v3 pool with liquidity for ETH → USDC \(tried fee tiers 100, 500, 3000, 10000\)/,
    );
    await expect(
      uniswapV3().quote(
        request({ from: ETH, to: { symbol: "WETH", address: dep.weth, decimals: 18 }, publicClient: quoterWith({ 3000: 1n }) }),
      ),
    ).rejects.toThrow(/same token/);
  });

  it("only claims the chains it has verified deployments for, and takes overrides", () => {
    const p = uniswapV3();
    expect([1, 8453, 11155111, 84532].every((id) => p.supports(id))).toBe(true);
    expect(p.supports(31337)).toBe(false);
    expect(uniswapV3({ deployments: { 31337: dep } }).supports(31337)).toBe(true);
  });
});

describe("lifi", () => {
  const BASE_USDC = { symbol: "USDC", address: fixture.action.fromToken.address as `0x${string}`, decimals: 6 };
  const fetchWith = (body: unknown, status = 200) => vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(body), { status }));
  const ask = (f: ReturnType<typeof fetchWith>, over: Partial<EvmSwapQuoteRequest> = {}, o: Parameters<typeof lifi>[0] = {}) =>
    lifi({ fetch: f as unknown as typeof fetch, ...o }).quote({
      chainId: 8453,
      account: ACCOUNT,
      from: BASE_USDC,
      to: ETH,
      amount: 1_000_000n,
      slippageBps: 50,
      publicClient: {} as never,
      ...over,
    });

  it("turns a recorded mainnet quote into a swap plan", async () => {
    const q = await ask(fetchWith(fixture));
    expect(q).toMatchObject({
      expected: BigInt(fixture.estimate.toAmount),
      min: BigInt(fixture.estimate.toAmountMin),
      spender: fixture.estimate.approvalAddress,
      tx: { to: fixture.transactionRequest.to, data: fixture.transactionRequest.data },
    });
    expect(q.tx.value).toBeUndefined(); // an ERC-20 input attaches no ETH
  });

  it("asks for exactly what was requested, with the key and integrator", async () => {
    const f = fetchWith(fixture);
    await ask(f, {}, { apiKey: "secret-key", integrator: "my-agent" });
    const [url, init] = f.mock.calls[0] as [string, { headers: Record<string, string> }];
    const params = new URL(url).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      fromChain: "8453",
      toChain: "8453",
      fromToken: BASE_USDC.address,
      toToken: "0x0000000000000000000000000000000000000000",
      fromAmount: "1000000",
      fromAddress: ACCOUNT,
      slippage: "0.005",
      integrator: "my-agent",
    });
    expect(init.headers["x-lifi-api-key"]).toBe("secret-key");
  });

  it("rejects a response that doesn't match the request, since its calldata would be signed", async () => {
    const tamper = (mutate: (q: typeof fixture) => void) => {
      const q = structuredClone(fixture);
      mutate(q);
      return ask(fetchWith(q));
    };
    await expect(
      tamper((q) => {
        q.transactionRequest.chainId = 1;
      }),
    ).rejects.toThrow(/different chain/);
    await expect(
      tamper((q) => {
        q.action.toToken.address = "0x4200000000000000000000000000000000000006";
      }),
    ).rejects.toThrow(/different tokens/);
    await expect(
      tamper((q) => {
        q.estimate.fromAmount = "999999";
      }),
    ).rejects.toThrow(/different amount/);
    await expect(
      tamper((q) => {
        q.transactionRequest.value = "0xde0b6b3a7640000";
      }),
    ).rejects.toThrow(/unexpected value/);
    await expect(
      tamper((q) => {
        (q.estimate as { approvalAddress?: string }).approvalAddress = undefined;
      }),
    ).rejects.toThrow(/no approval address/);
    await expect(
      tamper((q) => {
        (q.transactionRequest as { data?: string }).data = undefined;
      }),
    ).rejects.toThrow(/incomplete/);
  });

  it("for a native input requires the attached value to equal the amount", async () => {
    const native = structuredClone(fixture) as typeof fixture;
    native.action.fromToken.address = "0x0000000000000000000000000000000000000000";
    native.estimate.fromAmount = "1000000000000000";
    native.transactionRequest.value = "0x38d7ea4c68000"; // 0.001 ETH
    const q = await ask(fetchWith(native), { from: ETH, amount: 10n ** 15n });
    expect(q.tx.value).toBe(10n ** 15n);
    expect(q.spender).toBeUndefined();
    native.transactionRequest.value = "0x1";
    await expect(ask(fetchWith(native), { from: ETH, amount: 10n ** 15n })).rejects.toThrow(/unexpected value/);
  });

  it("reports the API's own message on failure", async () => {
    await expect(ask(fetchWith({ message: "No available quotes for the requested transfer", code: 1002 }, 404))).rejects.toThrow(
      "LI.FI 404: No available quotes for the requested transfer",
    );
  });

  it("doesn't claim testnets or local chains", () => {
    const p = lifi();
    expect(p.supports(8453)).toBe(true);
    expect(p.supports(1)).toBe(true);
    expect(p.supports(84532)).toBe(false);
    expect(p.supports(31337)).toBe(false);
  });
});
