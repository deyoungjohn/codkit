/**
 * EVM adapter over wagmi. Import from `@codkit/wallet/evm` (needs `wagmi`, `viem`, `@tanstack/react-query`).
 *
 * Browser wallets are discovered through EIP-6963. WalletConnect is added only when you pass
 * `walletConnectProjectId` (free at dashboard.walletconnect.com) and install `@walletconnect/ethereum-provider`.
 */
import { type ChainConfig, type ChainRef, type Env, getChain } from "@codkit/config";
import { viemChain, viemTransport } from "@codkit/config/viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Chain } from "viem";
import { type Config, type Connector, type CreateConnectorFn, createConfig, type Storage, WagmiProvider } from "wagmi";
import {
  connect,
  disconnect,
  getConnection,
  getConnectors,
  sendTransaction,
  signMessage,
  switchChain,
  waitForTransactionReceipt,
  watchConnection,
  watchConnectors,
} from "wagmi/actions";
import { injected, walletConnect } from "wagmi/connectors";
import { createStore, toError } from "./store.js";
import type { WalletAdapter, WalletInfo, WalletSnapshot } from "./types.js";

export interface EvmAdapterOptions {
  /** EVM chains, default first: `["base-sepolia", "sepolia"]`. */
  chains: readonly ChainRef[];
  /** Env for RPC resolution (`@codkit/config`); pass your public env in the browser. */
  env?: Env;
  /** Enables the WalletConnect connector (QR / mobile). Requires `@walletconnect/ethereum-provider`. */
  walletConnectProjectId?: string;
  /** Shown by WalletConnect wallets. */
  app?: { name: string; url?: string; icon?: string; description?: string };
  /** Next.js: `true`, plus `storage: createStorage({ storage: cookieStorage })` to keep the connection across SSR. */
  ssr?: boolean;
  storage?: Storage;
  /** Extra wagmi connectors (e.g. `mock` in tests, `coinbaseWallet`). */
  connectors?: CreateConnectorFn[];
  queryClient?: QueryClient;
}

export type EvmAdapter = WalletAdapter<"evm"> & {
  /** The wagmi config, so the app can use wagmi hooks and actions directly. */
  wagmiConfig: Config;
  queryClient: QueryClient;
};

export function evmAdapter(opts: EvmAdapterOptions): EvmAdapter {
  const chainConfigs = opts.chains.map(getChain);
  if (!chainConfigs.length) throw new Error("evmAdapter: pass at least one chain");
  for (const c of chainConfigs) if (c.ecosystem !== "evm") throw new Error(`evmAdapter: ${c.key} is not an EVM chain`);
  const env = opts.env ? { env: opts.env } : {};
  const viemChains = chainConfigs.map((c) => viemChain(c, env)) as [Chain, ...Chain[]];
  const transports = Object.fromEntries(chainConfigs.map((c) => [c.chainId!, viemTransport(c, env)]));

  const connectors: CreateConnectorFn[] = [injected(), ...(opts.connectors ?? [])];
  if (opts.walletConnectProjectId) {
    connectors.push(
      walletConnect({
        projectId: opts.walletConnectProjectId,
        showQrModal: true,
        ...(opts.app && {
          metadata: {
            name: opts.app.name,
            description: opts.app.description ?? "",
            url: opts.app.url ?? "",
            icons: opts.app.icon ? [opts.app.icon] : [],
          },
        }),
      }),
    );
  }

  const wagmiConfig = createConfig({
    chains: viemChains,
    connectors,
    transports,
    ...(opts.ssr !== undefined && { ssr: opts.ssr }),
    ...(opts.storage && { storage: opts.storage }),
  });
  const queryClient = opts.queryClient ?? new QueryClient();

  const byChainId = new Map(chainConfigs.map((c) => [c.chainId!, c]));
  const info = (c: Connector): WalletInfo => ({ id: c.id, name: c.name, ecosystem: "evm", ...(c.icon && { icon: c.icon }) });
  /** The generic `injected` connector duplicates EIP-6963 wallets; show it only when none announced themselves. */
  const listWallets = (): WalletInfo[] => {
    const all = getConnectors(wagmiConfig);
    const announced = all.some((c) => c.type === "injected" && c.id !== "injected");
    return all.filter((c) => !(announced && c.id === "injected")).map(info);
  };

  const read = (): Omit<WalletSnapshot, "wallets" | "chains" | "ecosystem"> => {
    const c = getConnection(wagmiConfig);
    const chain: ChainConfig =
      (c.chainId !== undefined && byChainId.get(c.chainId)) || byChainId.get(wagmiConfig.state.chainId) || chainConfigs[0]!;
    return { status: c.status, chain, ...(c.address && { address: c.address }), ...(c.connector && { wallet: info(c.connector) }) };
  };
  const store = createStore<WalletSnapshot>({ ecosystem: "evm", wallets: listWallets(), chains: chainConfigs, ...read() });
  // explicit undefineds so a disconnect clears the previous address and wallet
  const refresh = () => store.set({ address: undefined, wallet: undefined, ...read() });

  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      const r = await fn();
      store.set({ error: undefined });
      return r;
    } catch (e) {
      store.set({ error: toError(e) });
      throw e;
    }
  };

  // biome-ignore lint/correctness/noComponentHookFactories: created once per adapter (outside render), closing over its config
  const Provider = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );

  return {
    ecosystem: "evm",
    wagmiConfig,
    queryClient,
    Provider,
    getSnapshot: store.get,
    subscribe: store.subscribe,
    mount() {
      const offConn = watchConnection(wagmiConfig, { onChange: () => refresh() });
      const offList = watchConnectors(wagmiConfig, { onChange: () => store.set({ wallets: listWallets() }) });
      store.set({ wallets: listWallets() });
      refresh();
      return () => {
        offConn();
        offList();
      };
    },
    connect: (walletId) =>
      run(async () => {
        const all = getConnectors(wagmiConfig);
        const id = walletId ?? listWallets()[0]?.id;
        const connector = all.find((c) => c.id === id || c.uid === id);
        if (!connector) throw new Error(walletId ? `no EVM wallet "${walletId}"` : "no EVM wallet found; install a browser wallet");
        if (getConnection(wagmiConfig).connector?.uid === connector.uid) return;
        await connect(wagmiConfig, { connector, chainId: read().chain.chainId! });
        refresh();
      }),
    disconnect: () =>
      run(async () => {
        await disconnect(wagmiConfig);
        refresh();
      }),
    signMessage: (message) => run(() => signMessage(wagmiConfig, { message: typeof message === "string" ? message : { raw: message } })),
    sendTransaction: (tx) =>
      run(() =>
        sendTransaction(wagmiConfig, {
          to: tx.to,
          ...(tx.value !== undefined && { value: tx.value }),
          ...(tx.data && { data: tx.data }),
          chainId: read().chain.chainId!,
        }),
      ),
    switchChain: (ref) =>
      run(async () => {
        const c = getChain(ref);
        if (!byChainId.has(c.chainId ?? -1)) throw new Error(`switchChain: ${c.key} is not one of this adapter's chains`);
        if (getConnection(wagmiConfig).status === "connected") await switchChain(wagmiConfig, { chainId: c.chainId! });
        else wagmiConfig.setState((s) => ({ ...s, chainId: c.chainId! }));
        refresh();
      }),
    waitForTransaction: async (hash, o) => {
      const r = await waitForTransactionReceipt(wagmiConfig, {
        hash: hash as `0x${string}`,
        chainId: read().chain.chainId!,
        ...(o?.timeoutMs !== undefined && { timeout: o.timeoutMs }),
      });
      return { ok: r.status === "success" };
    },
  };
}
