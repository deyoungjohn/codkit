"use client";

import "@codkit/ui/styles.css";
import { TxToastProvider } from "@codkit/ui";
import { WalletProvider } from "@codkit/wallet";
import { evmAdapter } from "@codkit/wallet/evm";
import { solanaAdapter } from "@codkit/wallet/solana";
import { type ReactNode, useState } from "react";
import { cookieStorage, createStorage } from "wagmi";

// Next.js inlines only the NEXT_PUBLIC_ variables it can see, so name them here.
const env = {
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL,
  NEXT_PUBLIC_HELIUS_API_KEY: process.env.NEXT_PUBLIC_HELIUS_API_KEY,
};
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export function Providers({ children }: { children: ReactNode }) {
  // one set of adapters per browser tab (and per server request), never per render
  const [adapters] = useState(() => [
    evmAdapter({
      chains: ["base-sepolia", "sepolia"],
      env,
      ssr: true,
      storage: createStorage({ storage: cookieStorage }),
      ...(walletConnectProjectId && { walletConnectProjectId, app: { name: "codkit dapp" } }),
    }),
    solanaAdapter({ chains: ["solana-devnet"], env }),
  ]);
  return (
    <WalletProvider adapters={adapters}>
      <TxToastProvider>{children}</TxToastProvider>
    </WalletProvider>
  );
}
