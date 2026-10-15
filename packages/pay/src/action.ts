import type { Action } from "@iamyoungjohn-kit/policy";
import type { PaymentRequirements } from "@x402/core/types";

/**
 * x402 payment requirements → policy `Action`.
 *
 * `to` is the `payTo` address, the spend is `amount` of `asset` (atomic units)
 * on `network` (CAIP-2), so the same limits you set for direct transfers apply.
 */
export function paymentToAction(req: PaymentRequirements, resource?: { url?: string; description?: string }): Action {
  return {
    chain: req.network,
    kind: "x402_payment",
    to: req.payTo,
    method: `x402:${req.scheme}`,
    spends: [{ asset: req.asset, amount: BigInt(req.amount) }],
    meta: {
      scheme: req.scheme,
      ...(resource?.url !== undefined && { resource: resource.url }),
      ...(resource?.description !== undefined && { description: resource.description }),
    },
  };
}
