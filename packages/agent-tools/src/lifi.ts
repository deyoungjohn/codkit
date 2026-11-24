/**
 * LI.FI swap provider (aggregator API, mainnets only). Import from `@codkit/agent-tools/lifi`.
 *
 * Quotes are read-only. LI.FI returns the calldata to sign, so the response is checked before it is used
 * (chain, tokens and amount echo the request; an ERC-20 input attaches no value; a native input attaches exactly
 * the amount). Pair it with `allow.programs` in your policy, set to LI.FI's diamond contract, so a compromised
 * response can only reach the contract you expect.
 */
import { findChain } from "@codkit/config";
import type { Address, Hex } from "viem";
import type { EvmSwapProvider } from "./evm.js";

export interface LifiOptions {
  /** Default `https://li.quest/v1`. */
  apiUrl?: string;
  /** Optional: raises rate limits (`x-lifi-api-key`). */
  apiKey?: string;
  /** Sent as `integrator`. Default `codkit`. */
  integrator?: string;
  fetch?: typeof globalThis.fetch;
  /** Give up on a quote after this many ms. Default 15 000. */
  timeoutMs?: number;
}

const ZERO = "0x0000000000000000000000000000000000000000";

interface LifiQuote {
  action?: { fromToken?: { address?: string }; toToken?: { address?: string }; fromChainId?: number; toChainId?: number };
  estimate?: { fromAmount?: string; toAmount?: string; toAmountMin?: string; approvalAddress?: string };
  transactionRequest?: { to?: string; data?: string; value?: string; chainId?: number };
  message?: string;
}

export function lifi(opts: LifiOptions = {}): EvmSwapProvider {
  const base = (opts.apiUrl ?? "https://li.quest/v1").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    name: "lifi",
    // LI.FI lists some testnets but has no swap routes on them: don't even ask.
    supports: (chainId) => findChain(chainId)?.testnet !== true,
    async quote({ chainId, account, from, to, amount, slippageBps }) {
      const params = new URLSearchParams({
        fromChain: String(chainId),
        toChain: String(chainId),
        fromToken: from.address === "native" ? ZERO : from.address,
        toToken: to.address === "native" ? ZERO : to.address,
        fromAmount: amount.toString(),
        fromAddress: account,
        slippage: String(slippageBps / 10_000),
        integrator: opts.integrator ?? "codkit",
      });
      const res = await doFetch(`${base}/quote?${params}`, {
        headers: opts.apiKey ? { "x-lifi-api-key": opts.apiKey } : {},
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      const q = (await res.json().catch(() => ({}))) as LifiQuote;
      if (!res.ok) throw new Error(`LI.FI ${res.status}: ${q.message ?? "no quote"}`);

      const tx = q.transactionRequest;
      const est = q.estimate;
      if (!tx?.to || !tx.data || !est?.toAmount || !est.toAmountMin) throw new Error("LI.FI returned an incomplete quote");
      const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
      if (Number(tx.chainId) !== chainId || q.action?.fromChainId !== chainId || q.action?.toChainId !== chainId)
        throw new Error("LI.FI quote is for a different chain than requested");
      if (
        !same(q.action?.fromToken?.address, from.address === "native" ? ZERO : from.address) ||
        !same(q.action?.toToken?.address, to.address === "native" ? ZERO : to.address)
      ) {
        throw new Error("LI.FI quote is for different tokens than requested");
      }
      if (est.fromAmount === undefined || BigInt(est.fromAmount) !== amount)
        throw new Error("LI.FI quote is for a different amount than requested");
      const value = BigInt(tx.value ?? 0);
      if (from.address === "native" ? value !== amount : value !== 0n)
        throw new Error(`LI.FI quote attaches an unexpected value (${value})`);
      if (from.address !== "native" && !est.approvalAddress) throw new Error("LI.FI quote has no approval address for an ERC-20 input");

      return {
        expected: BigInt(est.toAmount),
        min: BigInt(est.toAmountMin),
        ...(from.address !== "native" && { spender: est.approvalAddress as Address }),
        tx: { to: tx.to as Address, data: tx.data as Hex, ...(value > 0n && { value }) },
      };
    },
  };
}
