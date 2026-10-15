import { z } from "zod";

/** Accepts `1000n`, `1000`, or `"1000"` (atomic units) and yields a bigint. */
export const amountSchema = z
  .union([z.bigint(), z.number().int().nonnegative(), z.string().regex(/^\d+$/, "atomic units, digits only")])
  .transform((v) => BigInt(v))
  .refine((v) => v >= 0n, "amount must be >= 0");

const listSchema = z
  .object({
    /** Counterparties (`Action.to`). */
    addresses: z.array(z.string()).optional(),
    /** Contracts / programs (`Action.program`). */
    programs: z.array(z.string()).optional(),
    /** Function names or selectors (`Action.method`). */
    methods: z.array(z.string()).optional(),
  })
  .strict();

export const limitSchema = z
  .object({
    /** `native` or token address / mint. */
    asset: z.string(),
    /** Restrict to one chain (CAIP-2). Omit to apply on every chain. */
    chain: z.string().optional(),
    /** Optional label for UIs, e.g. `USDC`. */
    label: z.string().optional(),
    perTx: amountSchema.optional(),
    perPeriod: z
      .object({
        amount: amountSchema,
        /** Rolling window length. */
        seconds: z.number().int().positive(),
      })
      .strict()
      .optional(),
    /** Lifetime cap, counting everything recorded in the spend store. */
    total: amountSchema.optional(),
    /** Single spends strictly above this need a human. */
    approvalAbove: amountSchema.optional(),
  })
  .strict();

export const policySchema = z
  .object({
    /** When true, every action is denied. */
    killSwitch: z.boolean().default(false),
    /** Allowed chains (CAIP-2). Omit to allow any. */
    chains: z.array(z.string()).optional(),
    /** If set, the action must match every non-empty list. */
    allow: listSchema.optional(),
    /** Matching any entry denies the action. */
    deny: listSchema.optional(),
    limits: z.array(limitSchema).default([]),
    /** What to do with a spend whose asset has no limit configured. */
    unknownAssets: z.enum(["deny", "require_approval", "allow"]).default("deny"),
    /** `execute()` refuses to run without a successful simulation. */
    requireSimulation: z.boolean().default(true),
  })
  .strict();

/** Policy as you write it (amounts may be strings/numbers, defaults optional). */
export type PolicyInput = z.input<typeof policySchema>;
/** Policy after validation (amounts are bigints, defaults filled). */
export type Policy = z.output<typeof policySchema>;
export type Limit = z.output<typeof limitSchema>;

export function parsePolicy(input: PolicyInput): Policy {
  return policySchema.parse(input);
}
