/**
 * Solana chain adapter over `@solana/kit`. Import from `@codkit/agent-tools/solana`
 * (needs `@solana/kit`, `@solana-program/system`, `@solana-program/token`).
 *
 * ```ts
 * const sol = solanaChain({
 *   chain: "solana-devnet",
 *   rpc: createSolanaRpc(getRpcUrl("solana-devnet")),
 *   signer,                                           // the agent's KeyPairSigner
 *   tokens: { USDC: { mint: "4zMMC9…", decimals: 6 } },
 *   swap: [jupiter()],                                // from "@codkit/agent-tools/jupiter" (mainnet only)
 * });
 * ```
 * Only the legacy Token program is supported (Token-2022 mints are refused, not mis-handled).
 */
import { type ChainRef, explorerTxUrl, getChain } from "@codkit/config";
import { fromAtomic, type SimulationResult } from "@codkit/policy";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  type Address,
  address,
  appendTransactionMessageInstructions,
  type Base64EncodedWireTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isAddress,
  type KeyPairSigner,
  pipe,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { AssetRef, ChainAdapter, Prepared, SwapQuote, SwapRequest } from "./types.js";

export interface SolanaAsset {
  symbol: string;
  mint: Address | "native";
  decimals: number;
}

export interface SolanaSwapQuote {
  /** Estimated output, atomic units. */
  expected: bigint;
  /** Output the transaction guarantees after slippage, atomic units. */
  min: bigint;
  priceImpactPct?: number;
  expiresAt?: number;
  /** The program the swap goes through: what `allow.programs` in your policy should list. */
  program: string;
  /** Other top-level programs the transaction may legitimately call (beyond the safe defaults and `program`). */
  allowedPrograms?: readonly string[];
  /** Build the unsigned transaction (fee payer = the agent) right before it's simulated or sent: quotes go stale. */
  build(): Promise<Uint8Array>;
  details?: Record<string, unknown>;
}

export interface SolanaSwapQuoteRequest {
  /** CAIP-2 id, e.g. `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. */
  chainId: string;
  account: Address;
  from: SolanaAsset;
  to: SolanaAsset;
  amount: bigint;
  slippageBps: number;
}

/** A swap venue for Solana: `jupiter()`, or your own. */
export interface SolanaSwapProvider {
  name: string;
  supports(chainId: string): boolean;
  quote(req: SolanaSwapQuoteRequest): Promise<SolanaSwapQuote>;
}

export interface SolanaChainOptions {
  chain: ChainRef;
  rpc: Rpc<SolanaRpcApi>;
  /** The agent's key. Keep it a devnet / low-balance key. */
  signer: KeyPairSigner;
  /** Tokens the agent may use, by symbol. SOL is always included. */
  tokens?: Record<string, { mint: string; decimals: number }>;
  swap?: readonly SolanaSwapProvider[];
  /** Lamports a swap may cost beyond its input (fees, rent for new token accounts). Default 20 000 000 (0.02 SOL). */
  swapOverheadLamports?: bigint;
  /** Extra top-level programs a swap transaction may call, on top of ComputeBudget, System, Token, the ATA program and the provider's own. */
  swapAllowedPrograms?: readonly string[];
  /** How long to wait for confirmation. Default 60 000 ms. */
  confirmTimeoutMs?: number;
}

/** Top-level programs any legitimate swap transaction may call. DEX programs run inside the aggregator's, not at top level. */
export const SAFE_SWAP_PROGRAMS: readonly string[] = [
  "ComputeBudget111111111111111111111111111111",
  "11111111111111111111111111111111",
  TOKEN_PROGRAM_ADDRESS as string,
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
];

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

export function solanaChain(opts: SolanaChainOptions): ChainAdapter {
  const chain = getChain(opts.chain);
  if (chain.ecosystem !== "solana") throw new Error(`solanaChain: ${chain.key} is not a Solana chain`);
  const { rpc, signer } = opts;
  const agent = signer.address;
  const overhead = opts.swapOverheadLamports ?? 20_000_000n;
  const native: AssetRef = { symbol: chain.nativeCurrency.symbol, id: "native", decimals: chain.nativeCurrency.decimals };
  const assets: AssetRef[] = [native];
  for (const [symbol, t] of Object.entries(opts.tokens ?? {})) {
    if (symbol.toLowerCase() === native.symbol.toLowerCase()) throw new Error(`solanaChain: token ${symbol} clashes with the gas token`);
    if (!isAddress(t.mint)) throw new Error(`solanaChain: ${symbol} mint ${t.mint} is not a Solana address`);
    assets.push({ symbol, id: t.mint, decimals: t.decimals });
  }
  const providers = (opts.swap ?? []).filter((p) => p.supports(chain.id));
  const asSol = (a: AssetRef): SolanaAsset => ({
    symbol: a.symbol,
    mint: a.id === "native" ? "native" : address(a.id),
    decimals: a.decimals,
  });
  const checkedMints = new Map<string, Promise<void>>();

  /** Refuse Token-2022 (and non-token) mints up front. Cached per mint. */
  const requireLegacyMint = (mint: Address): Promise<void> => {
    let p = checkedMints.get(mint);
    if (!p) {
      p = rpc
        .getAccountInfo(mint, { encoding: "base64", commitment: "confirmed" })
        .send()
        .then(({ value }) => {
          if (!value) throw new Error(`mint ${mint} does not exist on ${chain.key}`);
          if (value.owner !== TOKEN_PROGRAM_ADDRESS)
            throw new Error(`mint ${mint} is not owned by the legacy Token program (Token-2022 mints aren't supported yet)`);
        });
      p.catch(() => checkedMints.delete(mint));
      checkedMints.set(mint, p);
    }
    return p;
  };
  const ataOf = async (owner: Address, mint: Address) =>
    (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

  /** A fresh, signed transaction. Built at the moment of use so a long wait for approval can't expire its blockhash. */
  const buildOwn = async (instructions: Parameters<typeof appendTransactionMessageInstructions>[0]) => {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const tx = await signTransactionMessageWithSigners(message);
    return { wire: getBase64EncodedWireTransaction(tx), signature: getSignatureFromTransaction(tx) };
  };

  const simulateWire = async (wire: Base64EncodedWireTransaction, accounts?: Address[]) => {
    const { value } = await rpc
      .simulateTransaction(wire, {
        encoding: "base64",
        commitment: "confirmed",
        ...(accounts && { accounts: { addresses: accounts, encoding: "base64" as const } }),
      })
      .send();
    return value;
  };
  const asResult = (v: {
    err: unknown;
    unitsConsumed?: bigint | undefined;
    logs?: readonly string[] | null | undefined;
  }): SimulationResult =>
    v.err
      ? { ok: false, error: `${json(v.err)}${v.logs?.length ? ` (${v.logs.at(-1)})` : ""}` }
      : { ok: true, details: { ...(v.unitsConsumed !== undefined && { unitsConsumed: v.unitsConsumed.toString() }) } };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Send, then wait for `confirmed`. Throws if it fails onchain or isn't confirmed in time. */
  const sendAndConfirm = async (wire: Base64EncodedWireTransaction, signature: string): Promise<string> => {
    await rpc.sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
    const until = Date.now() + (opts.confirmTimeoutMs ?? 60_000);
    for (;;) {
      const { value } = await rpc.getSignatureStatuses([signature as Signature]).send();
      const s = value[0];
      if (s?.err) throw new Error(`transaction ${signature} failed onchain: ${json(s.err)}`);
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return signature;
      if (Date.now() > until)
        throw new Error(
          `transaction ${signature} was not confirmed within ${(opts.confirmTimeoutMs ?? 60_000) / 1000}s; it may still land, so check the explorer before retrying`,
        );
      await sleep(1000);
    }
  };
  const link = (sig: string) => explorerTxUrl(chain, sig);

  const decodeAmount = (acct: { data: unknown } | null | undefined): bigint => {
    if (!acct) return 0n;
    const b64 = (acct.data as [string, string])[0];
    const bytes = getBase64Encoder().encode(b64);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(64, true); // SPL token account: amount at offset 64
  };

  return {
    chain,
    address: agent,
    assets,
    canSwap: providers.length > 0,
    isAddress: (v) => isAddress(v),

    async balances(who) {
      const owner = address(who);
      const out: Record<string, bigint> = {};
      out[native.symbol] = (await rpc.getBalance(owner, { commitment: "confirmed" }).send()).value;
      for (const a of assets.slice(1)) {
        const ata = await ataOf(owner, address(a.id));
        try {
          out[a.symbol] = BigInt((await rpc.getTokenAccountBalance(ata, { commitment: "confirmed" }).send()).value.amount);
        } catch {
          out[a.symbol] = 0n; // no token account yet
        }
      }
      return out;
    },

    async prepareTransfer({ asset, to, amount, memo }): Promise<Prepared> {
      const recipient = address(to);
      let instructions: Parameters<typeof appendTransactionMessageInstructions>[0];
      if (asset.id === "native") {
        instructions = [getTransferSolInstruction({ source: signer, destination: recipient, amount })];
      } else {
        const mint = address(asset.id);
        await requireLegacyMint(mint);
        instructions = [
          // The recipient may not have a token account yet; the agent pays the rent to create it.
          await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer, owner: recipient, mint }),
          getTransferCheckedInstruction({
            source: await ataOf(agent, mint),
            mint,
            destination: await ataOf(recipient, mint),
            authority: signer,
            amount,
            decimals: asset.decimals,
          }),
        ];
      }
      return {
        action: {
          chain: chain.id,
          kind: asset.id === "native" ? "transfer" : "token_transfer",
          to: recipient,
          ...(asset.id !== "native" && { program: asset.id, method: "transfer" }),
          spends: [{ asset: asset.id, amount }],
          ...(memo && { meta: { memo } }),
        },
        summary: { token: asset.symbol, amount: fromAtomic(amount, asset.decimals), to: recipient },
        simulate: async () => asResult(await simulateWire((await buildOwn(instructions)).wire)),
        send: async () => {
          const { wire, signature } = await buildOwn(instructions);
          await sendAndConfirm(wire, signature);
          return { id: signature, ...(link(signature) && { explorer: link(signature)! }) };
        },
      };
    },

    async quoteSwap({ from, to, amount, slippageBps }: SwapRequest): Promise<SwapQuote> {
      if (!providers.length) throw new Error(`no swap provider configured for ${chain.key}`);
      const results = await Promise.allSettled(
        providers.map(async (p) => ({
          p,
          q: await p.quote({ chainId: chain.id, account: agent, from: asSol(from), to: asSol(to), amount, slippageBps }),
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
      const plan = quote.plan as SolanaSwapQuote;
      const inMint = quote.from.id === "native" ? undefined : address(quote.from.id);
      const outMint = quote.to.id === "native" ? undefined : address(quote.to.id);
      for (const m of [inMint, outMint]) if (m) await requireLegacyMint(m);
      const watched: Address[] = [
        agent,
        ...(inMint ? [await ataOf(agent, inMint)] : []),
        ...(outMint ? [await ataOf(agent, outMint)] : []),
      ];
      const inIdx = inMint ? 1 : -1;
      const outIdx = outMint ? (inMint ? 2 : 1) : -1;

      /** Sign the provider's transaction, after checking it is ours to pay for. */
      const signed = async () => {
        const tx = getTransactionDecoder().decode(await plan.build());
        const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
        if (message.staticAccounts[0] !== agent) throw new Error("the swap transaction's fee payer is not the agent: refusing to sign it");
        const allowed = new Set<string>([
          ...SAFE_SWAP_PROGRAMS,
          plan.program,
          ...(plan.allowedPrograms ?? []),
          ...(opts.swapAllowedPrograms ?? []),
        ]);
        // kit types the compiled message as a union by version; every version has `instructions`
        for (const ix of (message as unknown as { instructions: readonly { programAddressIndex: number }[] }).instructions) {
          const program = message.staticAccounts[ix.programAddressIndex]!;
          if (!allowed.has(program))
            throw new Error(`the swap transaction calls ${program}, which is not an allowed program: refusing to sign it`);
        }
        const s = await signTransaction([signer.keyPair], tx);
        return { wire: getBase64EncodedWireTransaction(s), signature: getSignatureFromTransaction(s) };
      };

      return {
        action: {
          chain: chain.id,
          kind: "swap",
          to: plan.program,
          program: plan.program,
          method: "swap",
          spends: [{ asset: quote.from.id, amount: quote.from.amount }],
          meta: { provider: quote.provider, buy: quote.to.symbol, expected: quote.to.expected.toString(), min: quote.to.min.toString() },
        },
        summary: { provider: quote.provider, sell: quote.from.symbol, buy: quote.to.symbol, program: plan.program },
        // An aggregator hands us a transaction to sign. Simulate it and compare balances before and after:
        // it may not take more than the input (plus fee/rent allowance) or return less than the guaranteed minimum.
        simulate: async () => {
          const { wire } = await signed();
          const pre = (await rpc.getMultipleAccounts(watched, { encoding: "base64", commitment: "confirmed" }).send()).value;
          const sim = await simulateWire(wire, watched);
          if (sim.err) return asResult(sim);
          const post = sim.accounts ?? [];
          const lamports = (a: { lamports: bigint | number } | null | undefined) => BigInt(a?.lamports ?? 0);
          const solSpent = lamports(pre[0]) - lamports(post[0]);
          const problems: string[] = [];
          if (inIdx < 0) {
            if (solSpent > quote.from.amount + overhead)
              problems.push(`it would take ${fromAtomic(solSpent, 9)} SOL for a ${fromAtomic(quote.from.amount, 9)} SOL swap`);
          } else {
            const tokenSpent = decodeAmount(pre[inIdx]) - decodeAmount(post[inIdx]);
            if (tokenSpent > quote.from.amount)
              problems.push(
                `it would take ${fromAtomic(tokenSpent, quote.from.decimals)} ${quote.from.symbol} for a ${fromAtomic(quote.from.amount, quote.from.decimals)} swap`,
              );
            if (solSpent > overhead)
              problems.push(`it would also take ${fromAtomic(solSpent, 9)} SOL in fees and rent (allowed: ${fromAtomic(overhead, 9)})`);
          }
          const gained =
            outIdx < 0 ? lamports(post[0]) - lamports(pre[0]) + overhead : decodeAmount(post[outIdx]) - decodeAmount(pre[outIdx]);
          if (gained < quote.to.min)
            problems.push(
              `it would return less ${quote.to.symbol} than the guaranteed minimum ${fromAtomic(quote.to.min, quote.to.decimals)}`,
            );
          return problems.length ? { ok: false, error: `balance check failed: ${problems.join("; ")}` } : asResult(sim);
        },
        send: async () => {
          const before = outMint
            ? decodeAmount(
                (await rpc.getMultipleAccounts([watched[outIdx]!], { encoding: "base64", commitment: "confirmed" }).send()).value[0],
              )
            : undefined;
          const { wire, signature } = await signed();
          await sendAndConfirm(wire, signature);
          const after =
            outMint && before !== undefined
              ? decodeAmount(
                  (await rpc.getMultipleAccounts([watched[outIdx]!], { encoding: "base64", commitment: "confirmed" }).send()).value[0],
                ) - before
              : undefined;
          return {
            id: signature,
            ...(link(signature) && { explorer: link(signature)! }),
            ...(after !== undefined && { details: { received: { token: quote.to.symbol, amount: fromAtomic(after, quote.to.decimals) } } }),
          };
        },
      };
    },
  };
}
