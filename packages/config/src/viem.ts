/**
 * viem / wagmi glue. Import from `@codkit/config/viem` (needs `viem`).
 *
 * ```ts
 * const chains = [viemChain("base-sepolia")] as const;
 * createConfig({ chains, transports: { [chains[0].id]: viemTransport("base-sepolia") } });
 * ```
 */
import { type Chain, defineChain, fallback, type HttpTransportConfig, http, type Transport } from "viem";
import { type ChainRef, getChain } from "./chains.js";
import { getRpcUrls, type RpcOptions } from "./rpc.js";

/** A viem `Chain` whose default RPCs are the resolved ones (override → provider → public). */
export function viemChain(chain: ChainRef, opts: RpcOptions = {}): Chain {
  const c = getChain(chain);
  if (c.ecosystem !== "evm" || c.chainId === undefined) throw new Error(`viemChain: ${c.key} is not an EVM chain`);
  const http = getRpcUrls(c, opts);
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http, ...(c.wsUrls && { webSocket: [...c.wsUrls] }) } },
    ...(c.explorer && { blockExplorers: { default: { name: c.explorer.name, url: c.explorer.url } } }),
    testnet: c.testnet,
  });
}

/** One `http` transport per resolved RPC, wrapped in viem's `fallback` (or a single `http` when there's one). */
export function viemTransport(chain: ChainRef, opts: RpcOptions & { http?: HttpTransportConfig } = {}): Transport {
  const urls = getRpcUrls(chain, opts);
  const transports = urls.map((u) => http(u, opts.http));
  return transports.length === 1 ? transports[0]! : fallback(transports);
}
