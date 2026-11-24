import { type AnyKitTool, defineTool, errorMessage } from "@codkit/mcp";
import { type Action, fromAtomic, type PolicyEngine, toAtomic } from "@codkit/policy";
import { z } from "zod";
import type { AssetRef, ChainAdapter, Prepared } from "./types.js";

export interface AgentToolsConfig {
  /** Every fund-moving call passes through it: caps, allow/deny lists, approval, simulation, kill switch. */
  engine: PolicyEngine;
  chains: readonly ChainAdapter[];
  /**
   * The most one call may spend of each asset, in human units by symbol: `{ ETH: "0.01", USDC: "25" }`.
   * An asset without an entry can't be moved by these tools.
   */
  maxPerCall: Record<string, string>;
  /** Force every fund-moving call to be a dry run. The model can't turn this off. */
  dryRun?: boolean;
  /** Largest slippage a swap may ask for, in basis points. Default 100 (1%). */
  maxSlippageBps?: number;
}

const amount = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "a decimal number such as '1.5'")
  .describe("Human units, e.g. '1.5' (not atomic units)");
const dryRun = z
  .boolean()
  .optional()
  .describe("Preview only: check the caps, policy and simulation and report what would happen, without sending anything.");
const maxSpend = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .optional()
  .describe("Refuse if this call would spend more than this, in the token being spent. It can only lower the operator's per-call cap.");

/**
 * `get_balance`, `transfer`, `quote_swap` and `swap` over the configured chains.
 * Run them in the Vercel AI SDK (`toAiSdkTools` from `@codkit/mcp/ai-sdk`), an MCP server
 * (`createMcpServer` from `@codkit/mcp/server`) or the agent loop.
 */
export function agentTools(config: AgentToolsConfig): AnyKitTool[] {
  if (!config.chains.length) throw new Error("agentTools: configure at least one chain");
  const byKey = new Map<string, ChainAdapter>();
  for (const c of config.chains) {
    if (byKey.has(c.chain.key)) throw new Error(`agentTools: chain ${c.chain.key} configured twice`);
    byKey.set(c.chain.key, c);
  }
  for (const [symbol, cap] of Object.entries(config.maxPerCall)) {
    if (!/^\d+(\.\d+)?$/.test(cap)) throw new Error(`agentTools: maxPerCall.${symbol} must be a decimal number, got "${cap}"`);
  }
  const maxSlippage = config.maxSlippageBps ?? 100;
  const keys = [...byKey.keys()] as [string, ...string[]];
  const chain = z.enum(keys).describe(`Which chain: ${keys.join(", ")}`);
  const known = (a: ChainAdapter) => a.assets.map((x) => x.symbol).join(", ");
  const asset = (a: ChainAdapter, symbol: string): AssetRef => {
    const found = a.assets.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase());
    if (!found) throw new Error(`unknown token ${symbol} on ${a.chain.key}; known: ${known(a)}`);
    return found;
  };
  const human = (a: AssetRef, v: bigint) => fromAtomic(v, a.decimals);

  /** The three gates every fund-moving call passes: per-call cap, dry run, policy. */
  async function run(
    a: ChainAdapter,
    prepared: Prepared,
    input: { dryRun?: boolean | undefined; maxSpend?: string | undefined },
    extra: Record<string, unknown> = {},
  ) {
    checkCaps(a, prepared.action, config.maxPerCall, input.maxSpend);
    const forced = config.dryRun === true;
    if (forced || input.dryRun === true) {
      const decision = await config.engine.evaluate(prepared.action);
      const simulation = await prepared.simulate().catch((e: unknown) => ({ ok: false, error: errorMessage(e) }));
      return {
        dryRun: true,
        ...(forced && { enforcedByOperator: true }),
        wouldSucceed: decision.verdict !== "deny" && simulation.ok,
        needsHumanApproval: decision.verdict === "require_approval",
        policy: { verdict: decision.verdict, reasons: decision.reasons },
        simulation: { ok: simulation.ok, ...(simulation.error && { error: simulation.error }) },
        ...prepared.summary,
        ...extra,
        note: "Dry run: nothing was sent.",
      };
    }
    const out = await config.engine.execute(prepared.action, {
      simulate: () => prepared.simulate(),
      execute: () => prepared.send(),
      ref: (s) => s.id,
    });
    return {
      dryRun: false,
      status: "sent",
      id: out.result.id,
      explorer: out.result.explorer ?? null,
      ...out.result.details,
      ...prepared.summary,
      ...extra,
      policy: out.decision.verdict === "require_approval" ? "approved by a human" : "allowed",
    };
  }

  const tools: AnyKitTool[] = [
    defineTool({
      name: "get_balance",
      description:
        "Read balances (the gas token and each configured token) of your own wallet, or any address, on one chain. Read-only. Returns human-unit amounts.",
      input: z.object({ chain, address: z.string().optional().describe("Defaults to your own wallet") }),
      annotations: { readOnlyHint: true },
      run: async ({ chain: key, address }) => {
        const a = byKey.get(key)!;
        const who = address ?? a.address;
        if (!a.isAddress(who)) throw new Error(`${who} is not a valid ${a.chain.ecosystem} address`);
        const raw = await a.balances(who);
        const balances = Object.fromEntries(a.assets.map((x) => [x.symbol, human(x, raw[x.symbol] ?? 0n)]));
        return { chain: key, address: who, balances };
      },
    }),
    defineTool({
      name: "transfer",
      description:
        "Send a token (or the gas token) to an address on one chain. Capped per call, simulated, and checked against the spending policy before anything is sent; may need human approval. Use dryRun to preview. Returns the transaction id and explorer link.",
      input: z.object({
        chain,
        token: z.string().describe("Token symbol, e.g. USDC or the chain's gas token"),
        to: z.string().describe("Recipient address"),
        amount,
        memo: z.string().optional().describe("Why you are sending this; recorded with the policy decision"),
        dryRun,
        maxSpend,
      }),
      run: async (input) => {
        const a = byKey.get(input.chain)!;
        const token = asset(a, input.token);
        if (!a.isAddress(input.to)) throw new Error(`${input.to} is not a valid ${a.chain.ecosystem} address`);
        const prepared = await a.prepareTransfer({
          asset: token,
          to: input.to,
          amount: toAtomic(input.amount, token.decimals),
          ...(input.memo && { memo: input.memo }),
        });
        return run(a, prepared, input, { chain: input.chain, action: "transfer" });
      },
    }),
  ];

  if (config.chains.some((c) => c.canSwap)) {
    const swapChains = config.chains.filter((c) => c.canSwap).map((c) => c.chain.key) as [string, ...string[]];
    const swapChain = z.enum(swapChains).describe(`Which chain: ${swapChains.join(", ")}`);
    const swapFields = {
      chain: swapChain,
      from: z.string().describe("Token symbol to sell"),
      to: z.string().describe("Token symbol to buy"),
      amount: amount.describe("How much of `from` to sell, human units"),
      slippageBps: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .optional()
        .describe(`Slippage tolerance in basis points (50 = 0.5%). Default 50, at most ${maxSlippage}.`),
    };
    const quote = async (input: { chain: string; from: string; to: string; amount: string; slippageBps?: number | undefined }) => {
      const a = byKey.get(input.chain)!;
      const slippageBps = input.slippageBps ?? Math.min(50, maxSlippage);
      if (slippageBps > maxSlippage) throw new Error(`slippage ${slippageBps} bps is above the allowed ${maxSlippage} bps`);
      const from = asset(a, input.from);
      const to = asset(a, input.to);
      if (from.id === to.id) throw new Error("from and to are the same token");
      return { a, from, to, q: await a.quoteSwap({ from, to, amount: toAtomic(input.amount, from.decimals), slippageBps }) };
    };
    const describeQuote = ({ q, from, to }: Awaited<ReturnType<typeof quote>>) => ({
      provider: q.provider,
      sell: { token: from.symbol, amount: human(from, q.from.amount) },
      buy: { token: to.symbol, expected: human(to, q.to.expected), atLeast: human(to, q.to.min) },
      ...(q.priceImpactPct !== undefined && { priceImpactPct: q.priceImpactPct }),
      ...(q.expiresAt !== undefined && { expiresAt: new Date(q.expiresAt * 1000).toISOString() }),
    });
    tools.push(
      defineTool({
        name: "quote_swap",
        description:
          "Get a price for swapping one token for another on one chain: how much you'd receive, the minimum after slippage, and the route. Read-only; nothing is sent. Call this before `swap`.",
        input: z.object(swapFields),
        annotations: { readOnlyHint: true },
        run: async (input) => ({ chain: input.chain, ...describeQuote(await quote(input)) }),
      }),
      defineTool({
        name: "swap",
        description:
          "Swap one token for another on one chain at the current quote. Capped per call, simulated, and checked against the spending policy before anything is sent; may need human approval. Use dryRun to preview. Returns the transaction id and what you received.",
        input: z.object({ ...swapFields, dryRun, maxSpend }),
        run: async (input) => {
          const got = await quote(input);
          const prepared = await got.a.prepareSwap(got.q);
          return run(got.a, prepared, input, { chain: input.chain, action: "swap", quote: describeQuote(got) });
        },
      }),
    );
  }
  return tools;
}

/** Refuse a call that would spend more than the operator's cap (or the model's own tighter `maxSpend`). */
export function checkCaps(a: ChainAdapter, action: Action, caps: Record<string, string>, maxSpend?: string): void {
  action.spends.forEach((spend, i) => {
    const ref = a.assets.find((x) => x.id.toLowerCase() === spend.asset.toLowerCase());
    if (!ref) throw new Error(`refusing to move ${spend.asset}: it is not a configured token on ${a.chain.key}`);
    const cap = caps[ref.symbol];
    if (cap === undefined)
      throw new Error(`no per-call cap for ${ref.symbol}: the operator must set maxPerCall.${ref.symbol} before these tools can move it`);
    let limit = toAtomic(cap, ref.decimals);
    if (i === 0 && maxSpend !== undefined) {
      const own = toAtomic(maxSpend, ref.decimals);
      if (own < limit) limit = own;
    }
    if (spend.amount > limit) {
      throw new Error(
        `per-call cap: ${fromAtomic(spend.amount, ref.decimals)} ${ref.symbol} is more than the ${fromAtomic(limit, ref.decimals)} ${ref.symbol} allowed in one call`,
      );
    }
  });
}
