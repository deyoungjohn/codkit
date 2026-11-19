# @codkit/wallet

One `useWallet()` for EVM and Solana dapps. Adapters are hand-wired over the official libraries: wagmi (EIP-6963 browser wallets, optional WalletConnect) and the Wallet Standard with `@solana/kit` (Phantom, Solflare, Backpack, Solana Mobile …). Each ecosystem is one file, so a vendor can be swapped without touching the app. Why this stack: [decision 0001](../../docs/decisions/0001-wallet-kit.md).

```bash
npm install @codkit/wallet @codkit/config
npm install wagmi viem @tanstack/react-query   # EVM
npm install @solana/kit                        # Solana
```

## Setup

```tsx
import { WalletProvider } from "@codkit/wallet";
import { evmAdapter } from "@codkit/wallet/evm";
import { solanaAdapter } from "@codkit/wallet/solana";

// module scope (Vite) or useState(() => …) in a "use client" component (Next.js)
const adapters = [
  evmAdapter({ chains: ["base-sepolia", "sepolia"], env: import.meta.env }),
  solanaAdapter({ chains: ["solana-devnet"], env: import.meta.env }),
];

<WalletProvider adapters={adapters}>
  <App />
</WalletProvider>;
```

Chains are `@codkit/config` keys; RPCs resolve from your env (`VITE_BASE_SEPOLIA_RPC_URL`, `VITE_HELIUS_API_KEY` …) with public fallbacks. An app with one ecosystem passes one adapter and installs only that ecosystem's packages.

## Use

```tsx
import { useWallet } from "@codkit/wallet";

const evm = useWallet("evm");
evm.status; // "disconnected" | "connecting" | "reconnecting" | "connected"
evm.address;
evm.chain; // chain is a @codkit/config ChainConfig
evm.wallets; // discovered wallets: [{ id, name, icon, ecosystem }]
await evm.connect(evm.wallets[0].id);
await evm.signMessage("hello"); // 0x… (EIP-191)
const hash = await evm.sendTransaction({ to: "0x…", value: 10n ** 15n });
await evm.waitForTransaction(hash); // { ok: true }
await evm.switchChain("sepolia");

const sol = useWallet("solana");
await sol.signMessage("hello"); // base58
const sig = await sol.sendTransaction({
  instructions: [getTransferSolInstruction({ source: createNoopSigner(address(sol.address!)), destination, amount })],
});
```

`useWallet()` with no argument returns the first connected wallet; `useWallets()` returns all. Solana transactions are built for you: the connected wallet is the fee payer, the blockhash comes from the chain's RPC, and it's sent with the wallet's `signAndSendTransaction` (or `signTransaction` plus the RPC). Errors also land on `wallet.error`.

## Options

| `evmAdapter`             |                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walletConnectProjectId` | Adds WalletConnect (QR / mobile). Free project ID at dashboard.walletconnect.com; install `@walletconnect/ethereum-provider`. Its SDK loads at startup once enabled, so it's off by default. |
| `ssr`, `storage`         | Next.js: `ssr: true, storage: createStorage({ storage: cookieStorage })` keeps the connection across reloads without hydration warnings.                                                     |
| `connectors`             | Extra wagmi connectors (`coinbaseWallet`, `mock` in tests …).                                                                                                                                |

`evmAdapter(...).wagmiConfig` is the underlying wagmi config: every wagmi hook (`useReadContract`, `useBalance` …) works inside `<WalletProvider>`.

`solanaAdapter` reconnects the last wallet silently on page load (`autoConnect: false` to disable).

## Testing your app

`examples/dapp-vite/e2e` shows how to drive a dapp in headless Chromium with test wallets (an EIP-6963 provider and a Wallet Standard wallet whose signing runs in Node), locally against Anvil or for real on testnets.
