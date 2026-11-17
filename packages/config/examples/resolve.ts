/**
 * Resolve an RPC for one EVM chain, Solana devnet and Sui testnet, then ask each
 * endpoint a cheap question to prove it answers. Reads the repo-root .env.
 *
 *   pnpm --filter @codkit/config example
 */
import { chains, explorerAddressUrl, getRpcUrls, redactRpcUrl } from "../src/index.js";

const call = async (url: string, method: string) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
};

const checks = [
  { chain: "base-sepolia", method: "eth_chainId", show: (r: unknown) => `chainId ${Number(r)}` },
  { chain: "solana-devnet", method: "getHealth", show: (r: unknown) => `health ${r}` },
] as const;

let failed = 0;
for (const { chain, method, show } of checks) {
  const urls = getRpcUrls(chain);
  console.log(`${chain}: ${urls.map(redactRpcUrl).join(" → ")}`);
  let ok = false;
  for (const url of urls) {
    try {
      console.log(`  ✓ ${redactRpcUrl(url)}: ${show(await call(url, method))}`);
      ok = true;
      break;
    } catch (e) {
      console.log(`  ✗ ${redactRpcUrl(url)}: ${(e as Error).message}, trying the next`);
    }
  }
  if (!ok) failed++;
}
// Sui public fullnodes serve gRPC and GraphQL only (JSON-RPC was retired), so ask GraphQL.
const sui = chains["sui-testnet"];
try {
  const res = await fetch(sui.graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "{ chainIdentifier }" }),
    signal: AbortSignal.timeout(15_000),
  });
  const { data } = (await res.json()) as { data?: { chainIdentifier?: string } };
  if (!data?.chainIdentifier) throw new Error("no chainIdentifier");
  console.log(`sui-testnet: gRPC ${getRpcUrls(sui).join(" → ")}\n  ✓ ${sui.graphqlUrl}: chain identifier ${data.chainIdentifier}`);
} catch (e) {
  console.log(`  ✗ ${sui.graphqlUrl}: ${(e as Error).message}`);
  failed++;
}
console.log(`\nexplorer: ${explorerAddressUrl("solana-devnet", "Bc8MUG6gkGGie7fYftZpZNHBCPnLiV3r1hkhUNALnN38")}`);
process.exitCode = failed ? 1 : 0;
