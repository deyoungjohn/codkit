import { fromAtomic, toAtomic } from "@codkit/policy";
import type { EvmGuard } from "@codkit/policy/evm";
import { evmExplorerTxUrl } from "@codkit/policy/evm";
import { encodeFunctionData, erc20Abi, isAddress, type Address } from "viem";
import { z } from "zod";
import { defineTool } from "../tool.js";

export interface TokenInfo {
  address: Address;
  decimals: number;
}

export interface EvmToolOptions {
  chainId: number;
  account: Address;
  /** Every write goes through this guard: policy → simulation → approval → send. */
  guard: EvmGuard;
  reader: {
    getBalance(args: { address: Address }): Promise<bigint>;
    readContract(args: { address: Address; abi: typeof erc20Abi; functionName: "balanceOf"; args: [Address] }): Promise<bigint>;
  };
  /** Tokens the agent may use, by symbol, e.g. `{ USDC: { address, decimals: 6 } }`. */
  tokens: Record<string, TokenInfo>;
}

export const addressSchema = z.string().refine((a) => isAddress(a), "not an EVM address");

export function evmTools(opts: EvmToolOptions) {
  const symbols = Object.keys(opts.tokens);
  if (symbols.length === 0) throw new Error("evmTools: configure at least one token");
  const token = (s: string) => {
    const t = opts.tokens[s];
    if (!t) throw new Error(`unknown token ${s}; known: ${symbols.join(", ")}`);
    return t;
  };
  return [
    defineTool({
      name: "wallet_balance",
      description: `Your wallet address and balances (native + ${symbols.join(", ")}), in human units.`,
      input: z.object({}),
      annotations: { readOnlyHint: true },
      run: async () => {
        const balances: Record<string, string> = { native: fromAtomic(await opts.reader.getBalance({ address: opts.account }), 18) };
        for (const [sym, t] of Object.entries(opts.tokens)) {
          const raw = await opts.reader.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [opts.account] });
          balances[sym] = fromAtomic(raw, t.decimals);
        }
        return { chain: `eip155:${opts.chainId}`, address: opts.account, balances };
      },
    }),
    defineTool({
      name: "token_transfer",
      description: `Send ${symbols.join(" / ")} to an address. Checked against the spending policy and simulated before sending; may require human approval. Returns the tx hash and explorer link.`,
      input: z.object({
        token: z.enum(symbols as [string, ...string[]]),
        to: addressSchema,
        amount: z.string().regex(/^\d+(\.\d+)?$/).describe("Human units, e.g. '1.5'"),
        memo: z.string().optional().describe("Why — recorded with the decision"),
      }),
      run: async ({ token: sym, to, amount }) => {
        const t = token(sym);
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as Address, toAtomic(amount, t.decimals)] });
        const { result: hash } = await opts.guard.send({ to: t.address, data });
        return { tx: hash, explorer: evmExplorerTxUrl(opts.chainId, hash) ?? null };
      },
    }),
  ];
}
