import { paymentMiddleware, type PaywallConfig } from "@x402/express";
import type { RequestHandler } from "express";
import { createPaywall, type PaywallOptions } from "./core.js";

export interface ExpressPaywallOptions extends PaywallOptions {
  /** Built-in browser paywall UI config (needs `@x402/paywall`). */
  paywallConfig?: PaywallConfig;
  /** Fetch `/supported` from the facilitator on first request. Default true. */
  syncFacilitatorOnStart?: boolean;
}

/**
 * ```ts
 * app.use(paywall({ payTo: "0x…", routes: { "GET /weather": "$0.001" } }));
 * ```
 */
export function paywall(opts: ExpressPaywallOptions): RequestHandler {
  const { server, routes } = createPaywall(opts);
  return paymentMiddleware(routes, server, opts.paywallConfig, undefined, opts.syncFacilitatorOnStart ?? true) as RequestHandler;
}

export * from "./core.js";
