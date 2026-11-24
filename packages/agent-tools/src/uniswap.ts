/**
 * Uniswap v3 swap provider (SwapRouter02 + QuoterV2). Import from `@codkit/agent-tools/uniswap`.
 *
 * It exists because LI.FI and Jupiter only serve mainnet liquidity: Uniswap v3 has real WETH/USDC pools
 * on Base Sepolia, so an agent can quote and execute a genuine swap on a testnet. It also works on
 * Ethereum, Base and Sepolia. Quotes come from the on-chain quoter, not an API.
 */
import { type Address, encodeFunctionData, parseAbi } from "viem";
import type { EvmSwapProvider } from "./evm.js";

export interface UniswapV3Deployment {
  router: Address;
  quoter: Address;
  weth: Address;
}

/** Checked on-chain (router, quoter and factory agree, and report this WETH) on 2026-11-24. */
export const uniswapV3Deployments: Readonly<Record<number, UniswapV3Deployment>> = {
  1: {
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  8453: {
    router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    weth: "0x4200000000000000000000000000000000000006",
  },
  11155111: {
    router: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
    quoter: "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3",
    weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  },
  84532: {
    router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
    quoter: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
    weth: "0x4200000000000000000000000000000000000006",
  },
};

export interface UniswapV3Options {
  /** Override or extend `uniswapV3Deployments`. */
  deployments?: Record<number, UniswapV3Deployment>;
  /** Fee tiers to try, in hundredths of a bip. Default `[100, 500, 3000, 10000]`. */
  feeTiers?: readonly number[];
  /** How long the swap transaction stays valid once signed. Default 300. */
  deadlineSeconds?: number;
}

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
]);
/** SwapRouter02's marker for "the router itself": the swap pays the router, which then unwraps for the user. */
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

export function uniswapV3(opts: UniswapV3Options = {}): EvmSwapProvider {
  const deployments = { ...uniswapV3Deployments, ...opts.deployments };
  const tiers = opts.feeTiers ?? [100, 500, 3000, 10_000];
  const deadlineSeconds = opts.deadlineSeconds ?? 300;
  return {
    name: "uniswap-v3",
    supports: (chainId) => chainId in deployments,
    async quote({ chainId, account, from, to, amount, slippageBps, publicClient }) {
      const dep = deployments[chainId];
      if (!dep) throw new Error(`no Uniswap v3 deployment configured for chain ${chainId}`);
      const tokenIn = from.address === "native" ? dep.weth : from.address;
      const tokenOut = to.address === "native" ? dep.weth : to.address;
      if (tokenIn.toLowerCase() === tokenOut.toLowerCase())
        throw new Error("from and to are the same token (WETH and the gas token are one pool side)");

      // Ask the quoter about every fee tier; pools that don't exist or have no liquidity simply revert.
      const quotes = await Promise.allSettled(
        tiers.map(async (fee) => {
          const { result } = await publicClient.simulateContract({
            address: dep.quoter,
            abi: quoterAbi,
            functionName: "quoteExactInputSingle",
            args: [{ tokenIn, tokenOut, amountIn: amount, fee, sqrtPriceLimitX96: 0n }],
            account,
          });
          return { fee, out: result[0] };
        }),
      );
      const usable = quotes.flatMap((q) => (q.status === "fulfilled" && q.value.out > 0n ? [q.value] : []));
      if (!usable.length)
        throw new Error(`no Uniswap v3 pool with liquidity for ${from.symbol} → ${to.symbol} (tried fee tiers ${tiers.join(", ")})`);
      const best = usable.reduce((a, b) => (b.out > a.out ? b : a));
      const min = (best.out * BigInt(10_000 - slippageBps)) / 10_000n;

      const nativeOut = to.address === "native";
      const swap = encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee: best.fee,
            recipient: nativeOut ? ADDRESS_THIS : account,
            amountIn: amount,
            amountOutMinimum: min,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      const calls = nativeOut ? [swap, encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [min, account] })] : [swap];
      const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
      return {
        expected: best.out,
        min,
        expiresAt: deadline,
        ...(from.address !== "native" && { spender: dep.router }),
        tx: {
          to: dep.router,
          data: encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [BigInt(deadline), calls] }),
          // The router wraps attached ETH itself when the input is WETH.
          ...(from.address === "native" && { value: amount }),
        },
        details: { feeTier: best.fee },
      };
    },
  };
}
