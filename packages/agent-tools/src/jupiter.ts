/**
 * Jupiter swap provider (Solana mainnet only). Import from `@codkit/agent-tools/jupiter`.
 *
 * Quotes are read-only and keyless on `lite-api.jup.ag`. Jupiter hands back a transaction to sign, so the Solana
 * adapter checks it before signing: the fee payer is the agent, every top-level program is on a short allowlist
 * (Jupiter's own, ComputeBudget, System, Token, ATA), and a simulation may not take more than the swap's input
 * or return less than the guaranteed minimum.
 */
import { getBase64Encoder } from "@solana/kit";
import type { SolanaSwapProvider } from "./solana.js";

export interface JupiterOptions {
  /** Default `https://lite-api.jup.ag/swap/v1`. Use `https://api.jup.ag/swap/v1` with a key for higher limits. */
  apiUrl?: string;
  /** Sent as `x-api-key`. */
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  /** Give up on a request after this many ms. Default 15 000. */
  timeoutMs?: number;
}

const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const WSOL = "So11111111111111111111111111111111111111112";
/** Jupiter aggregator v6: present in every swap transaction it built in the 2026-11-24 check. */
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

interface JupiterQuote {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  error?: string;
}

export function jupiter(opts: JupiterOptions = {}): SolanaSwapProvider {
  const base = (opts.apiUrl ?? "https://lite-api.jup.ag/swap/v1").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;
  const headers = (extra: Record<string, string> = {}) => ({ ...extra, ...(opts.apiKey && { "x-api-key": opts.apiKey }) });
  const timeout = () => AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  return {
    name: "jupiter",
    supports: (chainId) => chainId === MAINNET,
    async quote({ account, from, to, amount, slippageBps }) {
      const inputMint = from.mint === "native" ? WSOL : from.mint;
      const outputMint = to.mint === "native" ? WSOL : to.mint;
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: String(slippageBps),
        restrictIntermediateTokens: "true",
      });
      const res = await doFetch(`${base}/quote?${params}`, { headers: headers(), signal: timeout() });
      const q = (await res.json().catch(() => ({}))) as JupiterQuote;
      if (!res.ok || q.error) throw new Error(`Jupiter ${res.status}: ${q.error ?? "no quote"}`);
      if (q.inputMint !== inputMint || q.outputMint !== outputMint) throw new Error("Jupiter quote is for different tokens than requested");
      if (q.swapMode !== "ExactIn" || q.inAmount === undefined || BigInt(q.inAmount) !== amount)
        throw new Error("Jupiter quote is not for the exact amount requested");
      if (q.outAmount === undefined || q.otherAmountThreshold === undefined) throw new Error("Jupiter returned an incomplete quote");
      return {
        expected: BigInt(q.outAmount),
        min: BigInt(q.otherAmountThreshold),
        program: JUPITER_PROGRAM,
        async build() {
          const r = await doFetch(`${base}/swap`, {
            method: "POST",
            headers: headers({ "content-type": "application/json" }),
            body: JSON.stringify({ quoteResponse: q, userPublicKey: account, dynamicComputeUnitLimit: true }),
            signal: timeout(),
          });
          const body = (await r.json().catch(() => ({}))) as { swapTransaction?: string; error?: string };
          if (!r.ok || !body.swapTransaction) throw new Error(`Jupiter swap ${r.status}: ${body.error ?? "no transaction"}`);
          return new Uint8Array(getBase64Encoder().encode(body.swapTransaction));
        },
      };
    },
  };
}
