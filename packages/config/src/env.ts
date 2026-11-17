import { z } from "zod";
import { type ChainRef, getChain } from "./chains.js";
import { type Env, envStem } from "./rpc.js";

const urlList = z
  .string()
  .trim()
  .refine((v) => v.split(",").every((u) => /^(https?|wss?):\/\/\S+$/.test(u.trim())), "comma-separated http(s):// or ws(s):// URLs");

export interface RpcEnvOptions {
  /** Prefix for every variable, e.g. `NEXT_PUBLIC_` or `VITE_` for browser builds. Default none. */
  prefix?: string;
  /** Also accept `WALLETCONNECT_PROJECT_ID` (used by `@codkit/wallet`). Default true. */
  walletConnect?: boolean;
}

/**
 * A zod schema for the variables `getRpcUrls` reads, for the chains you use:
 * `<KEY>_RPC_URL`, `<KEY>_WS_URL`, `ALCHEMY_API_KEY`, `HELIUS_API_KEY`, `WALLETCONNECT_PROJECT_ID`. All optional.
 * Extend it with your own: `rpcEnvSchema(["base-sepolia"]).extend({ DATABASE_URL: z.url() })`.
 */
export function rpcEnvSchema(chains: ChainRef[], opts: RpcEnvOptions = {}) {
  const p = opts.prefix ?? "";
  const shape: Record<string, z.ZodOptional<z.ZodType<string>>> = {
    [`${p}ALCHEMY_API_KEY`]: z.string().trim().min(1).optional(),
    [`${p}HELIUS_API_KEY`]: z.string().trim().min(1).optional(),
  };
  if (opts.walletConnect ?? true)
    shape[`${p}WALLETCONNECT_PROJECT_ID`] = z
      .string()
      .trim()
      .regex(/^[0-9a-f]{32}$/, "32 hex chars")
      .optional();
  for (const c of chains.map(getChain)) {
    shape[`${p}${envStem(c)}_RPC_URL`] = urlList.optional();
    shape[`${p}${envStem(c)}_WS_URL`] = urlList.optional();
  }
  return z.object(shape);
}

export class EnvError extends Error {
  constructor(readonly issues: { name: string; message: string }[]) {
    super(`invalid environment:\n${issues.map((i) => `  ${i.name}: ${i.message}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/**
 * Validate env vars against a schema, reporting every bad variable at once (values are never echoed).
 * `source` defaults to `process.env`; on the client pass the variables explicitly.
 */
export function parseEnv<S extends z.ZodType>(schema: S, source?: Env): z.infer<S> {
  const env = source ?? (globalThis as { process?: { env?: Env } }).process?.env ?? {};
  // empty strings mean "unset", as in most .env files
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const r = schema.safeParse(cleaned);
  if (r.success) return r.data;
  throw new EnvError(r.error.issues.map((i) => ({ name: i.path.join(".") || "(root)", message: i.message })));
}
