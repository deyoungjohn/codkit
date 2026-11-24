/**
 * EVM chain adapter over viem. Import from `@codkit/agent-tools/evm` (needs `viem`).
 *
 * ```ts
 * const base = evmChain({
 *   chain: "base-sepolia",
 *   publicClient, walletClient,                       // viem clients; the wallet client holds the agent's key
 *   tokens: { USDC: { address: "0x036C…", decimals: 6 } },
 *   swap: [uniswapV3()],                              // from "@codkit/agent-tools/uniswap"
 * });
 * ```
 */
import { type ChainRef, explorerTxUrl, getChain } from "@codkit/config";
import { fromAtomic } from "@codkit/policy";
import { simulateEvmTx } from "@codkit/policy/evm";
import {
  type Account,
  type Address,
  type Chain,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
  isAddress,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import type { AssetRef, ChainAdapter, Prepared, SwapQuote, SwapRequest } from "./types.js";

export interface EvmAsset {
  symbol: string;
  address: Address | "native";
  decimals: number;
}

export interface EvmTx {
  to: Address;
  data?: Hex;
  value?: bigint;
}

export interface EvmSwapQuote {
  /** Estimated output, atomic units. */
  expected: bigint;
  /** Output guaranteed by the transaction after slippage, atomic units. */
  min: bigint;
  priceImpactPct?: number;
  expiresAt?: number;
  /** The token spender to approve (the router / aggregator), if the input is an ERC-20. */
  spender?: Address;
  tx: EvmTx;
  details?: Record<string, unknown>;
}

export interface EvmSwapQuoteRequest {
  chainId: number;
  /** The agent's address: the sender and the recipient. */
  account: Address;
  from: EvmAsset;
  to: EvmAsset;
  amount: bigint;
  slippageBps: number;
  publicClient: PublicClient<Transport, Chain | undefined>;
}

/** A swap venue for EVM: `uniswapV3()`, `lifi()`, or your own. */
export interface EvmSwapProvider {
  name: string;
  supports(chainId: number): boolean;
  quote(req: EvmSwapQuoteRequest): Promise<EvmSwapQuote>;
}

export interface EvmChainOptions {
  /** A `@codkit/config` chain: key, CAIP-2 id or chain id. */
  chain: ChainRef;
  publicClient: PublicClient<Transport, Chain | undefined>;
  /** Created with `account` and `chain`. This is the agent's key, so keep it a testnet / low-balance key. */
  walletClient: WalletClient<Transport, Chain, Account>;
  /** Tokens the agent may use, by symbol. The gas token is always included. */
  tokens?: Record<string, { address: Address; decimals: number }>;
  swap?: readonly EvmSwapProvider[];
}

export function evmChain(opts: EvmChainOptions): ChainAdapter {
  const chain = getChain(opts.chain);
  if (chain.ecosystem !== "evm" || chain.chainId === undefined) throw new Error(`evmChain: ${chain.key} is not an EVM chain`);
  const chainId = chain.chainId;
  const { publicClient, walletClient } = opts;
  const account = walletClient.account.address;
  const native: AssetRef = { symbol: chain.nativeCurrency.symbol, id: "native", decimals: chain.nativeCurrency.decimals };
  const assets: AssetRef[] = [native];
  for (const [symbol, t] of Object.entries(opts.tokens ?? {})) {
    if (symbol.toLowerCase() === native.symbol.toLowerCase()) throw new Error(`evmChain: token ${symbol} clashes with the gas token`);
    assets.push({ symbol, id: getAddress(t.address), decimals: t.decimals });
  }
  const providers = (opts.swap ?? []).filter((p) => p.supports(chainId));
  const asEvm = (a: AssetRef): EvmAsset => ({
    symbol: a.symbol,
    address: a.id === "native" ? "native" : (a.id as Address),
    decimals: a.decimals,
  });

  const balanceOf = (token: Address, who: Address) =>
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

  /** Send, wait for the receipt, and throw if it reverted (so the engine releases the reserved spend). */
  const sendAndConfirm = async (tx: EvmTx, what: string): Promise<Hex> => {
    const hash = await walletClient.sendTransaction({
      to: tx.to,
      ...(tx.value !== undefined && { value: tx.value }),
      ...(tx.data && { data: tx.data }),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${what} transaction reverted onchain (${hash})`);
    return hash;
  };
  const link = (hash: Hex) => explorerTxUrl(chain, hash);
  /**
   * Re-read until `done`, for RPC providers that load-balance across nodes: right after a mined transaction a read can
   * land on a node that hasn't seen it. Gives up after `timeoutMs` and returns the last value, so a wrong answer
   * surfaces as the real error (a failed simulation, a zero balance change) rather than hanging.
   */
  const settle = async <T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 15_000): Promise<T> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const v = await read();
      if (done(v) || Date.now() > until) return v;
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const simulate = (tx: EvmTx) => simulateEvmTx(publicClient, account, tx);

  return {
    chain,
    address: account,
    assets,
    canSwap: providers.length > 0,
    isAddress: (v) => isAddress(v),

    async balances(address) {
      const who = getAddress(address);
      const out: Record<string, bigint> = {};
      out[native.symbol] = await publicClient.getBalance({ address: who });
      for (const a of assets.slice(1)) out[a.symbol] = await balanceOf(a.id as Address, who);
      return out;
    },

    async prepareTransfer({ asset, to, amount, memo }): Promise<Prepared> {
      const recipient = getAddress(to);
      const tx: EvmTx =
        asset.id === "native"
          ? { to: recipient, value: amount }
          : { to: asset.id as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }) };
      return {
        action: {
          chain: `eip155:${chainId}`,
          kind: asset.id === "native" ? "transfer" : "token_transfer",
          to: recipient,
          ...(asset.id !== "native" && { program: asset.id, method: "transfer" }),
          spends: [{ asset: asset.id, amount }],
          ...(memo && { meta: { memo } }),
        },
        summary: { token: asset.symbol, amount: fromAtomic(amount, asset.decimals), to: recipient },
        simulate: () => simulate(tx),
        send: async () => {
          const hash = await sendAndConfirm(tx, "transfer");
          return { id: hash, ...(link(hash) && { explorer: link(hash)! }) };
        },
      };
    },

    async quoteSwap({ from, to, amount, slippageBps }: SwapRequest): Promise<SwapQuote> {
      if (!providers.length) throw new Error(`no swap provider configured for ${chain.key}`);
      const results = await Promise.allSettled(
        providers.map(async (p) => ({
          p,
          q: await p.quote({ chainId, account, from: asEvm(from), to: asEvm(to), amount, slippageBps, publicClient }),
        })),
      );
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (!ok.length) {
        const why = results
          .map(
            (r, i) =>
              `${providers[i]!.name}: ${r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : ""}`,
          )
          .join("; ");
        throw new Error(`no swap route for ${from.symbol} → ${to.symbol} on ${chain.key} (${why})`);
      }
      const best = ok.reduce((a, b) => (b.q.min > a.q.min ? b : a));
      return {
        provider: best.p.name,
        from: { ...from, amount },
        to: { ...to, expected: best.q.expected, min: best.q.min },
        ...(best.q.priceImpactPct !== undefined && { priceImpactPct: best.q.priceImpactPct }),
        ...(best.q.expiresAt !== undefined && { expiresAt: best.q.expiresAt }),
        plan: best.q,
      };
    },

    async prepareSwap(quote): Promise<Prepared> {
      const plan = quote.plan as EvmSwapQuote;
      const spendsToken = quote.from.id !== "native";
      const needsApproval =
        spendsToken &&
        plan.spender !== undefined &&
        (await publicClient.readContract({
          address: quote.from.id as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account, plan.spender],
        })) < quote.from.amount;
      // Approve exactly what this swap spends, never more.
      const approveTx: EvmTx | undefined = needsApproval
        ? {
            to: quote.from.id as Address,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [plan.spender!, quote.from.amount] }),
          }
        : undefined;
      const receiving = quote.to.id !== "native" ? (quote.to.id as Address) : undefined;
      return {
        action: {
          chain: `eip155:${chainId}`,
          kind: "swap",
          to: plan.tx.to,
          program: plan.tx.to,
          method: "swap",
          // The asset leaving the wallet: existing per-asset policy limits apply to swaps.
          spends: [{ asset: quote.from.id, amount: quote.from.amount }],
          meta: { provider: quote.provider, buy: quote.to.symbol, expected: quote.to.expected.toString(), min: quote.to.min.toString() },
        },
        summary: { provider: quote.provider, sell: quote.from.symbol, buy: quote.to.symbol, router: plan.tx.to, needsApproval },
        // The swap can't be simulated before its approval exists, so simulate the approval first and the swap right after it.
        simulate: () => simulate(approveTx ?? plan.tx),
        send: async () => {
          const before = receiving ? await balanceOf(receiving, account) : undefined;
          let approval: Hex | undefined;
          if (approveTx) {
            approval = await sendAndConfirm(approveTx, "approval");
            // the swap is simulated against the approval, so wait until the node answering us can see it
            await settle(
              () =>
                publicClient.readContract({
                  address: quote.from.id as Address,
                  abi: erc20Abi,
                  functionName: "allowance",
                  args: [account, plan.spender!],
                }),
              (allowance) => allowance >= quote.from.amount,
            );
            const sim = await simulate(plan.tx);
            if (!sim.ok)
              throw new Error(`swap simulation failed after the approval (${approval}); the exact-amount approval remains: ${sim.error}`);
          }
          const hash = await sendAndConfirm(plan.tx, "swap");
          const received =
            receiving && before !== undefined
              ? (await settle(
                  () => balanceOf(receiving, account),
                  (after) => after > before,
                )) - before
              : undefined;
          return {
            id: hash,
            ...(link(hash) && { explorer: link(hash)! }),
            details: {
              ...(approval && { approvalTx: approval }),
              ...(received !== undefined && { received: { token: quote.to.symbol, amount: fromAtomic(received, quote.to.decimals) } }),
            },
          };
        },
      };
    },
  };
}
