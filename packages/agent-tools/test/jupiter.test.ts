import { getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { JUPITER_PROGRAM, jupiter } from "../src/jupiter.js";
import { SAFE_SWAP_PROGRAMS, type SolanaSwapQuoteRequest } from "../src/solana.js";
import recorded from "./fixtures/jupiter-sol-usdc.json" with { type: "json" };

const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const agent = recorded.userPublicKey as never;

const req = (over: Partial<SolanaSwapQuoteRequest> = {}): SolanaSwapQuoteRequest => ({
  chainId: MAINNET,
  account: agent,
  from: { symbol: "SOL", mint: "native", decimals: 9 },
  to: { symbol: "USDC", mint: USDC as never, decimals: 6 },
  amount: 100_000_000n,
  slippageBps: 50,
  ...over,
});
/** Serves the recorded quote for GET /quote and the recorded transaction for POST /swap. */
const api = (quote: unknown = recorded.quote, status = 200) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/quote")) return new Response(JSON.stringify(quote), { status });
    if (u.endsWith("/swap")) return new Response(JSON.stringify({ swapTransaction: recorded.swapTransaction }), { status: 200 });
    throw new Error(`unexpected ${init?.method ?? "GET"} ${u}`);
  });
const provider = (f: ReturnType<typeof api>, o: Parameters<typeof jupiter>[0] = {}) =>
  jupiter({ fetch: f as unknown as typeof fetch, ...o });

describe("jupiter", () => {
  it("turns a recorded mainnet quote into a swap plan", async () => {
    const q = await provider(api()).quote(req());
    expect(q).toMatchObject({
      expected: BigInt(recorded.quote.outAmount),
      min: BigInt(recorded.quote.otherAmountThreshold),
      program: JUPITER_PROGRAM,
    });
    expect(q.priceImpactPct).toBeUndefined(); // the unit of Jupiter's field isn't established, so it isn't reported
  });

  it("asks for exactly what was requested, with SOL as wrapped SOL, and sends the key", async () => {
    const f = api();
    await provider(f, { apiKey: "k1" }).quote(req());
    const [url, init] = f.mock.calls[0]! as [string, { headers: Record<string, string> }];
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      inputMint: WSOL,
      outputMint: USDC,
      amount: "100000000",
      slippageBps: "50",
      restrictIntermediateTokens: "true",
    });
    expect(init.headers["x-api-key"]).toBe("k1");
  });

  it("builds the transaction on demand for the agent, and the real one only calls programs the adapter allows", async () => {
    const f = api();
    const q = await provider(f).quote(req());
    expect(f).toHaveBeenCalledTimes(1); // nothing is built until it's needed
    const wire = await q.build();
    const [, init] = f.mock.calls[1]! as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      userPublicKey: agent,
      dynamicComputeUnitLimit: true,
      quoteResponse: { inAmount: "100000000" },
    });

    const tx = getTransactionDecoder().decode(wire);
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
      staticAccounts: string[];
      instructions: { programAddressIndex: number }[];
    };
    expect(msg.staticAccounts[0]).toBe(agent); // the agent pays
    const programs = new Set(msg.instructions.map((i) => msg.staticAccounts[i.programAddressIndex]!));
    expect(programs.has(JUPITER_PROGRAM)).toBe(true);
    const allowed = new Set<string>([...SAFE_SWAP_PROGRAMS, JUPITER_PROGRAM]);
    expect([...programs].filter((p) => !allowed.has(p))).toEqual([]); // a real Jupiter transaction passes the adapter's allowlist
    expect(getBase64Encoder().encode(recorded.swapTransaction).length).toBe(wire.length);
  });

  it("rejects a quote that doesn't match the request", async () => {
    const bad = (mutate: (q: Record<string, unknown>) => void) => {
      const q = { ...recorded.quote } as Record<string, unknown>;
      mutate(q);
      return provider(api(q)).quote(req());
    };
    await expect(
      bad((q) => {
        q.outputMint = WSOL;
      }),
    ).rejects.toThrow(/different tokens/);
    await expect(
      bad((q) => {
        q.inAmount = "1";
      }),
    ).rejects.toThrow(/exact amount/);
    await expect(
      bad((q) => {
        q.swapMode = "ExactOut";
      }),
    ).rejects.toThrow(/exact amount/);
    await expect(
      bad((q) => {
        q.otherAmountThreshold = undefined;
      }),
    ).rejects.toThrow(/incomplete/);
    await expect(provider(api({ error: "Could not find any route" }, 400)).quote(req())).rejects.toThrow(
      "Jupiter 400: Could not find any route",
    );
  });

  it("only claims mainnet", () => {
    const p = jupiter();
    expect(p.supports(MAINNET)).toBe(true);
    expect(p.supports("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toBe(false); // devnet
  });
});
