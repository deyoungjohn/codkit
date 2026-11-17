import { type ChainRef, getChain } from "./chains.js";

/** Explorer link for a transaction (EVM hash, Solana signature, Sui digest), or undefined if the chain has no explorer. */
export function explorerTxUrl(chain: ChainRef, hash: string): string | undefined {
  const e = getChain(chain).explorer;
  return e && e.url + (e.tx ?? "/tx/{hash}").replace("{hash}", encodeURIComponent(hash));
}

/** Explorer link for an account / address. */
export function explorerAddressUrl(chain: ChainRef, address: string): string | undefined {
  const e = getChain(chain).explorer;
  return e && e.url + (e.address ?? "/address/{address}").replace("{address}", encodeURIComponent(address));
}
