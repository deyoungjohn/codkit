export { createBudgetedFetch, withPolicy } from "./client.js";
export type { BudgetedFetchOptions, PaymentOutcome, PolicyHookOptions } from "./client.js";
export { paymentToAction } from "./action.js";

// Re-exported so a typical agent needs a single import. Pin-compatible with the
// @x402/* versions this package depends on.
export { x402Client } from "@x402/core/client";
export { decodePaymentResponseHeader } from "@x402/core/http";
export { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
export type { Network, PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
