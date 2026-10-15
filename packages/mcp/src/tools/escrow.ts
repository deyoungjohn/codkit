import { dealIdFromLogs, escrowTxs, hashText, readDeal, type ContractReader } from "@codkit/contracts";
import { fromAtomic, toAtomic } from "@codkit/policy";
import type { EvmGuard } from "@codkit/policy/evm";
import { evmExplorerTxUrl } from "@codkit/policy/evm";
import type { Address, Hex, Log } from "viem";
import { z } from "zod";
import { defineTool } from "../tool.js";
import { addressSchema, type TokenInfo } from "./evm.js";

export interface EscrowToolOptions {
  chainId: number;
  escrow: Address;
  token: TokenInfo & { symbol: string };
  guard: EvmGuard;
  reader: ContractReader & { waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: string; logs: Log[] }> };
}

/** Escrowed deals with other agents / humans (client side). */
export function escrowTools(opts: EscrowToolOptions) {
  const tx = escrowTxs(opts.escrow);
  const sym = opts.token.symbol;
  const send = async (t: { to: Address; data: Hex }) => {
    const { result: hash } = await opts.guard.send(t);
    const receipt = await opts.reader.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
    return { hash, receipt };
  };
  const link = (h: Hex) => evmExplorerTxUrl(opts.chainId, h) ?? null;
  const dealId = z.string().regex(/^\d+$/).describe("Deal id returned by escrow_create");

  return [
    defineTool({
      name: "escrow_create",
      description: `Lock ${sym} in escrow for a provider to earn by delivering. Approves the token and funds the deal (two policy-checked transactions). Returns the deal id.`,
      input: z.object({
        provider: addressSchema,
        amount: z.string().regex(/^\d+(\.\d+)?$/).describe(`${sym}, human units`),
        deadlineHours: z.number().positive().max(24 * 90).describe("Provider must deliver within this many hours"),
        terms: z.string().max(4000).describe("What is being bought; its hash is stored onchain"),
        arbiter: addressSchema.optional(),
      }),
      run: async ({ provider, amount, deadlineHours, terms, arbiter }) => {
        const atomic = toAtomic(amount, opts.token.decimals);
        const approve = await send(tx.approve(opts.token.address, atomic));
        const created = await send(
          tx.createAndFund({
            provider: provider as Address,
            token: opts.token.address,
            amount: atomic,
            deadline: new Date(Date.now() + deadlineHours * 3_600_000),
            termsHash: hashText(terms),
            ...(arbiter && { arbiter: arbiter as Address }),
          }),
        );
        const id = dealIdFromLogs(created.receipt.logs);
        return { dealId: id?.toString() ?? null, approveTx: link(approve.hash), fundTx: link(created.hash) };
      },
    }),
    defineTool({
      name: "escrow_status",
      description: "Read a deal: parties, amount, deadline, status (Funded / Delivered / Released / Refunded / Disputed) and delivery hash.",
      input: z.object({ dealId }),
      annotations: { readOnlyHint: true },
      run: async ({ dealId: id }) => {
        const d = await readDeal(opts.reader, opts.escrow, BigInt(id));
        return { ...d, amount: `${fromAtomic(d.amount, opts.token.decimals)} ${sym}` };
      },
    }),
    defineTool({
      name: "escrow_release",
      description: "Pay the provider for a deal. Only do this once the delivery has been checked against the terms.",
      input: z.object({ dealId }),
      run: async ({ dealId: id }) => ({ tx: link((await send(tx.release(BigInt(id)))).hash) }),
    }),
    defineTool({
      name: "escrow_refund",
      description: "Get your money back on a deal the provider failed to deliver by the deadline.",
      input: z.object({ dealId }),
      run: async ({ dealId: id }) => ({ tx: link((await send(tx.refund(BigInt(id)))).hash) }),
    }),
  ];
}
