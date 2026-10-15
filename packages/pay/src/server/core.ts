import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient, type RouteConfig } from "@x402/core/server";
import type { Network, Price, SchemeNetworkServer } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

/** Public x402 testnet facilitator (Base Sepolia, Solana devnet …). */
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
export const DEFAULT_NETWORK: Network = "eip155:84532"; // Base Sepolia

/**
 * Route pricing:
 * - `"$0.01"` (or an `{ amount, asset }` object) — pay that on the default network to `payTo`
 * - `{ price, description?, mimeType?, network?, payTo? }` — same, with metadata / overrides
 * - a full x402 route config (`{ accepts: [...] }`) — passed through untouched
 */
export type RouteSpec =
  | Price
  | {
      price: Price;
      network?: Network;
      payTo?: string;
      description?: string;
      mimeType?: string;
      maxTimeoutSeconds?: number;
    }
  | RouteConfig;

export interface SettledPayment {
  network: string;
  transaction: string;
  payer?: string;
  /** Atomic units actually settled. */
  amount: string;
  asset: string;
  payTo: string;
  scheme: string;
  resource?: string;
}

export interface PaywallOptions {
  /** Address that receives payments (can be overridden per route). */
  payTo: string;
  /** Route key format is x402's: `"GET /weather"`, `"/api/*"`, … */
  routes: Record<string, RouteSpec>;
  /** CAIP-2 network. Default: Base Sepolia. */
  network?: Network;
  /** Facilitator client or URL. Default: the public testnet facilitator. */
  facilitator?: FacilitatorClient | string;
  /**
   * Scheme servers to register. Default: `exact` EVM for every `eip155:*`
   * network used by the routes. Add e.g. `ExactSvmScheme` from `@x402/svm` for Solana.
   */
  schemes?: { network: Network; server: SchemeNetworkServer }[];
  /** Fires after each successful settlement — feed it to receipts / the demo dashboard. */
  onSettled?: (payment: SettledPayment) => void | Promise<void>;
  /** Fires when settlement fails after the resource was served. */
  onSettleFailed?: (error: Error, requirements: { network: string; amount: string; payTo: string }) => void | Promise<void>;
}

export interface Paywall {
  server: x402ResourceServer;
  routes: Record<string, RouteConfig>;
}

/** Build the x402 resource server + route table used by the framework adapters. */
export function createPaywall(opts: PaywallOptions): Paywall {
  const network = opts.network ?? DEFAULT_NETWORK;
  const facilitator =
    typeof opts.facilitator === "object"
      ? opts.facilitator
      : new HTTPFacilitatorClient({ url: opts.facilitator ?? DEFAULT_FACILITATOR_URL });

  const routes: Record<string, RouteConfig> = {};
  const networks = new Set<Network>();
  for (const [key, spec] of Object.entries(opts.routes)) {
    const route = toRouteConfig(spec, network, opts.payTo);
    for (const a of [route.accepts].flat()) networks.add(a.network);
    routes[key] = route;
  }

  const server = new x402ResourceServer(facilitator);
  const schemes = opts.schemes ?? [...networks].filter((n) => n.startsWith("eip155:")).map((n) => ({ network: n, server: new ExactEvmScheme() }));
  for (const s of schemes) server.register(s.network, s.server);

  if (opts.onSettled) {
    const cb = opts.onSettled;
    server.onAfterSettle(async ({ result, requirements, paymentPayload }) => {
      if (!result.success) return;
      await cb({
        network: result.network,
        transaction: result.transaction,
        amount: result.amount ?? requirements.amount,
        asset: requirements.asset,
        payTo: requirements.payTo,
        scheme: requirements.scheme,
        ...(result.payer !== undefined && { payer: result.payer }),
        ...(paymentPayload.resource?.url !== undefined && { resource: paymentPayload.resource.url }),
      });
    });
  }
  if (opts.onSettleFailed) {
    const cb = opts.onSettleFailed;
    server.onSettleFailure(async ({ error, requirements }) => {
      await cb(error, { network: requirements.network, amount: requirements.amount, payTo: requirements.payTo });
    });
  }

  return { server, routes };
}

function toRouteConfig(spec: RouteSpec, network: Network, payTo: string): RouteConfig {
  if (typeof spec === "object" && spec !== null && "accepts" in spec) return spec;
  if (typeof spec === "object" && spec !== null && "price" in spec) {
    const { price, network: n, payTo: p, maxTimeoutSeconds, ...meta } = spec;
    return {
      accepts: {
        scheme: "exact",
        price,
        network: n ?? network,
        payTo: p ?? payTo,
        ...(maxTimeoutSeconds !== undefined && { maxTimeoutSeconds }),
      },
      ...meta,
    };
  }
  return { accepts: { scheme: "exact", price: spec, network, payTo } };
}
