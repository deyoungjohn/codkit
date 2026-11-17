# @codkit/config

Chain registry, RPC resolution and env validation for dapps on EVM, Solana and Sui. Plain data at runtime: the core imports no chain SDK, so it works on servers, in browsers and in build scripts.

```bash
npm install @codkit/config
```

## Chains

```ts
import { chains, getChain, listChains, explorerTxUrl } from "@codkit/config";

chains["base-sepolia"]; // { key, id: "eip155:84532", ecosystem: "evm", chainId, nativeCurrency, rpcUrls, explorer, … }
getChain("solana:devnet"); // look up by key, CAIP-2 id, Wallet Standard id or EVM chain id (84532)
listChains({ ecosystem: "evm", testnet: true });
explorerTxUrl("solana-devnet", signature); // https://explorer.solana.com/tx/…?cluster=devnet
```

Built in: Ethereum, Base, Optimism, Arbitrum, Polygon, BNB, Avalanche and Celo (mainnet + testnet each), plus Linea Sepolia, Scroll Sepolia, Unichain Sepolia, Monad testnet and Anvil. Solana mainnet, devnet, testnet and localnet. Sui mainnet, testnet, devnet and localnet. The EVM entries are generated from `viem/chains` (`pnpm --filter @codkit/config gen`). For anything else, use `defineChain({...})`; every function accepts the result.

Sui note: public fullnodes no longer serve JSON-RPC. `rpcUrls` are base URLs for `SuiGrpcClient`, and `graphqlUrl` is the GraphQL endpoint.

## RPC URLs with fallbacks

```ts
import { getRpcUrl, getRpcUrls } from "@codkit/config";

getRpcUrls("base-sepolia");
// 1. BASE_SEPOLIA_RPC_URL (comma-separated for several)
// 2. https://base-sepolia.g.alchemy.com/v2/$ALCHEMY_API_KEY   (if set)
// 3. https://sepolia.base.org                                  (public)
```

| Variable                        | Effect                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `<KEY>_RPC_URL`, `<KEY>_WS_URL` | Your endpoints first. `<KEY>` is the chain key in upper snake case: `SOLANA_DEVNET_RPC_URL`. |
| `ALCHEMY_API_KEY`               | Adds Alchemy on the EVM chains and Solana.                                                   |
| `HELIUS_API_KEY`                | Adds Helius on Solana mainnet and devnet (tried before Alchemy).                             |

Each variable is also read with the `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_` and `EXPO_PUBLIC_` prefixes. On a server the default source is `process.env`. In the browser, frameworks only inline variables you name, so pass them in: `getRpcUrls(chain, { env: import.meta.env })` with Vite, or an object of `process.env.NEXT_PUBLIC_…` values with Next.js. Keys that reach the browser are public, so restrict them by domain in the provider's dashboard.

`getWsUrls` does the same for WebSockets; on Solana it derives `wss://` from an overridden RPC URL. `redactRpcUrl(url)` hides keys in logs.

## viem / wagmi

```ts
import { viemChain, viemTransport } from "@codkit/config/viem"; // needs viem

const baseSepolia = viemChain("base-sepolia");
createConfig({ chains: [baseSepolia], transports: { [baseSepolia.id]: viemTransport("base-sepolia") } });
```

`viemTransport` wraps every resolved URL in viem's `fallback`, so a rate-limited endpoint fails over to the next.

## Env validation

```ts
import { parseEnv, rpcEnvSchema } from "@codkit/config";
import { z } from "zod";

export const env = parseEnv(rpcEnvSchema(["base-sepolia", "solana-devnet"]).extend({ DATABASE_URL: z.url() }));
```

`rpcEnvSchema` covers the variables above plus `WALLETCONNECT_PROJECT_ID`; pass `{ prefix: "NEXT_PUBLIC_" }` for client builds. `parseEnv` treats empty strings as unset and throws an `EnvError` that lists every bad variable at once, without echoing values.

## Example

```bash
pnpm --filter @codkit/config example   # resolves Base Sepolia, Solana devnet and Sui testnet, then calls each
```
