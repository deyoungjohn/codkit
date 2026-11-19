import { z } from "zod";
import { type ChainRef, findChain, getChain } from "./chains.js";

const contract = z.looseObject({
  address: z.string().min(1),
  tx: z.string().optional(),
  block: z.number().int().nonnegative().optional(),
});

/**
 * One chain's deployment record: what `DeploymentRecorder.sol` writes, and what
 * codkit's own `deployments/*.json` carry. Extra fields are kept.
 *
 * `{ "chain": "eip155:84532", "contracts": { "Escrow": { "address": "0x…", "tx": "0x…" } } }`
 */
export const deploymentSchema = z.looseObject({
  /** Any chain reference `getChain` accepts: key, CAIP-2, Wallet Standard id. */
  chain: z.string().refine((c) => findChain(c) !== undefined, "unknown chain; use a @codkit/config key or CAIP-2 id"),
  contracts: z.record(z.string(), contract).refine((c) => Object.keys(c).length > 0, "no contracts"),
});

export type Deployment = z.infer<typeof deploymentSchema>;

/** Validate a deployment record (e.g. an imported JSON file); throws with every problem listed. */
export function parseDeployment(json: unknown): Deployment {
  const r = deploymentSchema.safeParse(json);
  if (r.success) return r.data;
  throw new Error(`invalid deployment record:\n${r.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")}`);
}

/** The record for `chain` among several (matched by chain, whatever id form each uses). */
export function findDeployment(deployments: Deployment | readonly Deployment[], chain: ChainRef): Deployment | undefined {
  const key = getChain(chain).key;
  return [deployments].flat().find((d) => findChain(d.chain)?.key === key);
}

/**
 * The address of a deployed contract:
 * `contractAddress([baseSepolia, devnet], "base-sepolia", "Escrow")`. Throws a message
 * naming what *is* deployed when the chain or contract is missing.
 */
export function contractAddress(deployments: Deployment | readonly Deployment[], chain: ChainRef, name: string): string {
  const c = getChain(chain);
  const d = findDeployment(deployments, c);
  if (!d) {
    const have = [deployments].flat().map((x) => findChain(x.chain)?.key ?? x.chain);
    throw new Error(`no deployment for ${c.key}${have.length ? ` (have: ${have.join(", ")})` : ""}`);
  }
  const entry = d.contracts[name];
  if (!entry) throw new Error(`${name} is not deployed on ${c.key} (have: ${Object.keys(d.contracts).join(", ")})`);
  return entry.address;
}
