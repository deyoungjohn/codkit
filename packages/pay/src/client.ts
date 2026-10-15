import { isPolicyError, type Action, type PolicyEngine, type PolicyError } from "@codkit/policy";
import type { x402Client } from "@x402/core/client";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import { paymentToAction } from "./action.js";

export type PaymentOutcome =
  | { status: "settled"; action: Action; transaction: string; network: string; payer?: string; authorizationId: string }
  | { status: "failed"; action: Action; reason: string; authorizationId: string }
  | { status: "blocked"; action: Action; error: PolicyError };

export interface PolicyHookOptions {
  engine: PolicyEngine;
  /**
   * Return the budget when the server reports that verification or settlement
   * failed. Default `true`. Set `false` to be strictly conservative: a signed
   * authorization could in theory still be settled later by the recipient.
   */
  releaseOnFailure?: boolean;
  onPayment?: (outcome: PaymentOutcome) => void;
}

interface Pending {
  action: Action;
  auth: Awaited<ReturnType<PolicyEngine["authorize"]>>;
}

/**
 * Put an x402 client behind a policy engine. Before any payment is signed the
 * engine must authorize it (caps, allow/deny lists, approval, kill switch);
 * the spend is reserved, then committed with the settlement tx hash, or
 * released if the payment fails. Works for any transport built on the client
 * (fetch, axios, MCP).
 */
export function withPolicy(client: x402Client, opts: PolicyHookOptions): x402Client {
  const { engine, releaseOnFailure = true, onPayment } = opts;
  // `selectedRequirements` is the same object across the before/after/failure hooks of one payment.
  const byRequirements = new WeakMap<PaymentRequirements, Pending>();
  const byPayload = new WeakMap<PaymentPayload, Pending>();
  const notify = (o: PaymentOutcome) => {
    try {
      onPayment?.(o);
    } catch {
      // never let a logging callback break payments
    }
  };

  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
    const action = paymentToAction(selectedRequirements, paymentRequired.resource);
    try {
      const auth = await engine.authorize(action);
      byRequirements.set(selectedRequirements, { action, auth });
    } catch (e) {
      if (!isPolicyError(e)) throw e;
      notify({ status: "blocked", action, error: e });
      return { abort: true, reason: `policy: ${e.message}` };
    }
  });

  client.onAfterPaymentCreation(async ({ selectedRequirements, paymentPayload }) => {
    const p = byRequirements.get(selectedRequirements);
    if (!p) return;
    byRequirements.delete(selectedRequirements);
    byPayload.set(paymentPayload, p);
  });

  client.onPaymentCreationFailure(async ({ selectedRequirements, error }) => {
    const p = byRequirements.get(selectedRequirements);
    if (!p) return;
    byRequirements.delete(selectedRequirements);
    await p.auth.release(`payment creation failed: ${error.message}`);
  });

  client.onPaymentResponse(async (ctx) => {
    const p = byPayload.get(ctx.paymentPayload);
    if (!p) return;
    byPayload.delete(ctx.paymentPayload);
    const s = ctx.settleResponse;
    if (s?.success) {
      await p.auth.commit(s.transaction);
      notify({
        status: "settled",
        action: p.action,
        transaction: s.transaction,
        network: s.network,
        authorizationId: p.auth.id,
        ...(s.payer !== undefined && { payer: s.payer }),
      });
      return;
    }
    const reason =
      s?.errorReason ?? ctx.paymentRequired?.error ?? ctx.error?.message ?? "payment not accepted by server";
    if (releaseOnFailure) await p.auth.release(reason);
    notify({ status: "failed", action: p.action, reason, authorizationId: p.auth.id });
  });

  return client;
}

export interface BudgetedFetchOptions extends PolicyHookOptions {
  /** An x402 client with schemes registered, e.g. via `registerExactEvmScheme(client, { signer })`. */
  client: x402Client;
  fetch?: typeof globalThis.fetch;
}

/**
 * `fetch` that pays x402 paywalls automatically, but only within policy.
 * Blocked payments throw an `Error` whose message contains `policy: <code>: …`.
 */
export function createBudgetedFetch(opts: BudgetedFetchOptions): typeof globalThis.fetch {
  const client = withPolicy(opts.client, opts);
  return wrapFetchWithPayment(opts.fetch ?? globalThis.fetch, client) as typeof globalThis.fetch;
}
