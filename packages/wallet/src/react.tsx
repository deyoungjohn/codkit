import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { WalletSnapshot } from "./types.js";
import type { EvmWalletActions, Wallet, WalletAdapter, WalletEcosystem } from "./types.js";

type Adapters = Partial<{ [E in WalletEcosystem]: WalletAdapter<E> }>;

const Ctx = createContext<Adapters | null>(null);

export interface WalletProviderProps {
  /** e.g. `[evmAdapter({...}), solanaAdapter({...})]`. Create them outside render (module scope or useState). */
  adapters: readonly WalletAdapter[];
  children: ReactNode;
}

export function WalletProvider({ adapters, children }: WalletProviderProps) {
  const byEcosystem = useMemo(() => {
    const out: Adapters = {};
    for (const a of adapters) {
      if (out[a.ecosystem]) throw new Error(`WalletProvider: two adapters for ${a.ecosystem}`);
      (out as Record<string, WalletAdapter>)[a.ecosystem] = a;
    }
    return out;
  }, [adapters]);

  useEffect(() => {
    const cleanups = adapters.map((a) => a.mount());
    return () => {
      for (const c of cleanups) c();
    };
  }, [adapters]);

  let tree = <Ctx.Provider value={byEcosystem}>{children}</Ctx.Provider>;
  for (const a of [...adapters].reverse()) if (a.Provider) tree = <a.Provider>{tree}</a.Provider>;
  return tree;
}

function useAdapters(): Adapters {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

const toWallet = (a: WalletAdapter, snap: WalletSnapshot): Wallet =>
  ({
    ...snap,
    connect: a.connect,
    disconnect: a.disconnect,
    signMessage: a.signMessage,
    sendTransaction: a.sendTransaction,
    switchChain: a.switchChain,
    waitForTransaction: a.waitForTransaction,
    ...("signTypedData" in a && { signTypedData: (a as WalletAdapter & EvmWalletActions).signTypedData }),
  }) as Wallet;

/**
 * The wallet for one ecosystem: `useWallet("evm")`, `useWallet("solana")`.
 * With no argument: the first connected wallet, else the first configured ecosystem.
 */
export function useWallet<E extends WalletEcosystem>(ecosystem: E): Wallet<E>;
export function useWallet(): Wallet;
export function useWallet(ecosystem?: WalletEcosystem): Wallet {
  const all = useWallets();
  if (ecosystem) {
    const w = all.find((x) => x.ecosystem === ecosystem);
    if (!w) throw new Error(`useWallet: no ${ecosystem} adapter in <WalletProvider>`);
    return w;
  }
  if (!all.length) throw new Error("useWallet: <WalletProvider> has no adapters");
  return all.find((w) => w.status === "connected") ?? all[0]!;
}

/** Every configured ecosystem's wallet, in adapter order. */
export function useWallets(): Wallet[] {
  const adapters = useAdapters();
  const list = useMemo(() => Object.values(adapters) as WalletAdapter[], [adapters]);
  // One subscription over every adapter; each Wallet object keeps its identity until its own snapshot changes.
  const cache = useRef<{ snaps: WalletSnapshot[]; wallets: Wallet[] } | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => {
      const offs = list.map((a) => a.subscribe(listener));
      return () => {
        for (const off of offs) off();
      };
    },
    [list],
  );
  const get = useCallback(() => {
    const snaps = list.map((a) => a.getSnapshot());
    const prev = cache.current;
    if (prev && prev.snaps.length === snaps.length && prev.snaps.every((s, i) => s === snaps[i])) return prev.wallets;
    const wallets = snaps.map((s, i) => (prev?.snaps[i] === s ? prev.wallets[i]! : toWallet(list[i]!, s)));
    cache.current = { snaps, wallets };
    return wallets;
  }, [list]);
  return useSyncExternalStore(subscribe, get, get);
}
