/**
 * x402 on Solana. Import from `@codkit/pay/svm` (needs `@x402/svm` and `@solana/kit`).
 *
 * Server: `paywall({ network: SOLANA_DEVNET, schemes: svmSchemes(SOLANA_DEVNET), … })`.
 * Client: `registerExactSvmScheme(client, { signer: await createKeyPairSignerFromBytes(…) })`, or
 * `client.register(SOLANA_DEVNET, new ExactSvmScheme(signer, { rpcUrl }))` for your own RPC,
 * then `createBudgetedFetch` / `withPaidTools` as on EVM.
 */
import type { Network, SchemeNetworkServer } from "@x402/core/types";
import { ExactSvmScheme as ExactSvmServerScheme } from "@x402/svm/exact/server";

export { ExactSvmScheme, registerExactSvmScheme, type SvmClientConfig } from "@x402/svm/exact/client";
export { toClientSvmSigner, USDC_DEVNET_ADDRESS, USDC_MAINNET_ADDRESS } from "@x402/svm";

export const SOLANA_DEVNET: Network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_MAINNET: Network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** `exact` SVM scheme servers for `paywall({ schemes })` / `mcpPaywall({ schemes })`. Default: devnet. */
export function svmSchemes(...networks: Network[]): { network: Network; server: SchemeNetworkServer }[] {
  return (networks.length ? networks : [SOLANA_DEVNET]).map((network) => ({ network, server: new ExactSvmServerScheme() }));
}
