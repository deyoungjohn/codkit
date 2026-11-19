import { getChain } from "@codkit/config";
import type { WalletAdapter, WalletEcosystem, WalletSnapshot } from "@codkit/wallet";

/** A scriptable adapter: no chain, no wallet extension. */
export function fakeAdapter<E extends WalletEcosystem>(ecosystem: E, chains: string[], opts: { confirm?: boolean } = {}) {
  const cfgs = chains.map(getChain);
  let snap: WalletSnapshot = {
    ecosystem,
    status: "disconnected",
    chain: cfgs[0]!,
    chains: cfgs,
    wallets: [{ id: "w1", name: `${ecosystem} Wallet`, ecosystem }],
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<WalletSnapshot>) => {
    snap = { ...snap, ...patch };
    for (const l of listeners) l();
  };
  const calls: string[] = [];
  const adapter: WalletAdapter<E> = {
    ecosystem,
    getSnapshot: () => snap,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    mount: () => () => {},
    connect: async (id) => {
      calls.push(`connect:${id}`);
      if (id === "broken") throw new Error("User rejected the request");
      set({
        status: "connected",
        address: ecosystem === "evm" ? "0x1234567890abcdef1234567890abcdef12345678" : "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        wallet: snap.wallets[0]!,
      });
    },
    disconnect: async () => {
      calls.push("disconnect");
      set({ status: "disconnected", address: undefined, wallet: undefined });
    },
    signMessage: async () => "sig",
    sendTransaction: async () => "tx1",
    switchChain: async (ref) => {
      calls.push(`switch:${getChain(ref).key}`);
      set({ chain: getChain(ref) });
    },
    waitForTransaction: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: opts.confirm ?? true };
    },
  };
  return { adapter, calls, set };
}
