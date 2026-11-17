import { type ChainRef, getChain } from "./chains.js";
import type { ChainConfig } from "./types.js";

export type Env = Record<string, string | undefined>;
export type RpcProvider = "alchemy" | "helius";

export interface RpcOptions {
  /**
   * Where to read variables. Default: `process.env` when it exists. In browsers pass your
   * public env explicitly (Vite: `import.meta.env`; Next.js: an object of `process.env.NEXT_PUBLIC_…`).
   */
  env?: Env;
  /** Keyed providers to try, in order. Default: Helius then Alchemy on Solana; Alchemy elsewhere. */
  providers?: RpcProvider[];
  /** Append the chain's public endpoints as the last fallbacks. Default true. */
  public?: boolean;
}

/** Env-var prefixes frameworks require for values exposed to the browser. */
const PREFIXES = ["", "NEXT_PUBLIC_", "VITE_", "PUBLIC_", "EXPO_PUBLIC_"];

/** `base-sepolia` → `BASE_SEPOLIA`, the stem of `BASE_SEPOLIA_RPC_URL`. */
export const envStem = (chain: ChainRef): string => getChain(chain).key.toUpperCase().replace(/-/g, "_");

/** Read `name`, also under the public prefixes (`NEXT_PUBLIC_name`, `VITE_name` …). */
export function readEnv(env: Env | undefined, name: string): string | undefined {
  const src = env ?? defaultEnv();
  for (const p of PREFIXES) {
    const v = src[`${p}${name}`]?.trim();
    if (v) return v;
  }
  return undefined;
}

const TEMPLATES: Record<
  RpcProvider,
  { http: (slug: string, key: string) => string; ws: (slug: string, key: string) => string; keyVar: string }
> = {
  alchemy: {
    keyVar: "ALCHEMY_API_KEY",
    http: (slug, key) => `https://${slug}.g.alchemy.com/v2/${key}`,
    ws: (slug, key) => `wss://${slug}.g.alchemy.com/v2/${key}`,
  },
  helius: {
    keyVar: "HELIUS_API_KEY",
    http: (slug, key) => `https://${slug}.helius-rpc.com/?api-key=${key}`,
    ws: (slug, key) => `wss://${slug}.helius-rpc.com/?api-key=${key}`,
  },
};

/**
 * RPC endpoints for a chain, best first:
 * 1. `<KEY>_RPC_URL` (comma-separated for several), e.g. `BASE_SEPOLIA_RPC_URL`
 * 2. keyed providers whose API key is set (`HELIUS_API_KEY`, `ALCHEMY_API_KEY`)
 * 3. the chain's public endpoints
 * Every variable is also read with the `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` prefixes.
 */
export function getRpcUrls(chain: ChainRef, opts: RpcOptions = {}): string[] {
  return resolve(getChain(chain), opts, "http");
}

/** The first of `getRpcUrls`. */
export function getRpcUrl(chain: ChainRef, opts: RpcOptions = {}): string {
  return getRpcUrls(chain, opts)[0]!;
}

/** WebSocket endpoints (`<KEY>_WS_URL`, then providers, then public; Solana derives `wss://` from overridden RPC URLs). */
export function getWsUrls(chain: ChainRef, opts: RpcOptions = {}): string[] {
  return resolve(getChain(chain), opts, "ws");
}

function resolve(c: ChainConfig, opts: RpcOptions, kind: "http" | "ws"): string[] {
  const env = opts.env;
  const out: string[] = [];
  const override = readEnv(env, `${envStem(c)}_${kind === "http" ? "RPC" : "WS"}_URL`);
  if (override) out.push(...split(override));
  else if (kind === "ws" && c.ecosystem === "solana") {
    // Solana RPCs serve websockets on the same host
    const rpc = readEnv(env, `${envStem(c)}_RPC_URL`);
    if (rpc) out.push(...split(rpc).map((u) => u.replace(/^http/, "ws")));
  }
  const order = opts.providers ?? (c.ecosystem === "solana" ? ["helius", "alchemy"] : ["alchemy"]);
  for (const p of order) {
    const slug = c.providers?.[p];
    const key = slug && readEnv(env, TEMPLATES[p].keyVar);
    if (slug && key) out.push(TEMPLATES[p][kind](slug, key));
  }
  if (opts.public ?? true) out.push(...((kind === "http" ? c.rpcUrls : c.wsUrls) ?? []));
  const urls = [...new Set(out)];
  if (!urls.length)
    throw new Error(
      `no ${kind === "http" ? "RPC" : "WebSocket"} URL for ${c.key}; set ${envStem(c)}_${kind === "http" ? "RPC" : "WS"}_URL`,
    );
  return urls;
}

const split = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function defaultEnv(): Env {
  const p = (globalThis as { process?: { env?: Env } }).process;
  return p?.env ?? {};
}

/** Replace API keys in URLs with `<redacted>`, for logs and error messages. */
export function redactRpcUrl(url: string): string {
  return url.replace(/(\/v2\/)[^/?#]+/, "$1<redacted>").replace(/([?&]api-key=)[^&#]+/, "$1<redacted>");
}
