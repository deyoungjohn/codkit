/**
 * Solana adapter over the Wallet Standard. Import from `@codkit/wallet/solana` (needs `@solana/kit`).
 *
 * Every Wallet Standard wallet (Phantom, Solflare, Backpack, Solana Mobile …) is discovered
 * automatically; transactions are built with `@solana/kit` against the RPC `@codkit/config` resolves.
 */
import { type ChainConfig, type ChainRef, type Env, getChain, getRpcUrl } from "@codkit/config";
import type {
  SolanaSignAndSendTransactionFeature,
  SolanaSignMessageFeature,
  SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getTransactionEncoder,
  type Instruction,
  pipe,
  type Signature,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getWallets } from "@wallet-standard/app";
import type { Wallet as StandardWallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature } from "@wallet-standard/features";
import { createStore, toError } from "./store.js";
import type { SolanaTransaction, WalletAdapter, WalletInfo, WalletSnapshot } from "./types.js";

export interface SolanaAdapterOptions {
  /** Solana chains, default first: `["solana-devnet"]`. */
  chains: readonly ChainRef[];
  /** Env for RPC resolution (`@codkit/config`); pass your public env in the browser. */
  env?: Env;
  /** Reconnect the last wallet silently on page load. Default true. */
  autoConnect?: boolean;
  /** localStorage key for the last wallet. */
  storageKey?: string;
}

type Features = Partial<
  StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignMessageFeature &
    SolanaSignAndSendTransactionFeature &
    SolanaSignTransactionFeature
>;

const isSolanaWallet = (w: StandardWallet) => w.chains.some((c) => c.startsWith("solana:")) && "standard:connect" in w.features;
const b58 = getBase58Decoder();

export function solanaAdapter(opts: SolanaAdapterOptions): WalletAdapter<"solana"> {
  const chains = opts.chains.map(getChain);
  if (!chains.length) throw new Error("solanaAdapter: pass at least one chain");
  for (const c of chains) if (c.ecosystem !== "solana") throw new Error(`solanaAdapter: ${c.key} is not a Solana chain`);
  const storageKey = opts.storageKey ?? "codkit:solana-wallet";
  const env = opts.env ? { env: opts.env } : {};

  let registered: StandardWallet[] = [];
  let current: { wallet: StandardWallet; account: WalletAccount } | undefined;
  let offEvents: (() => void) | undefined;

  const info = (w: StandardWallet): WalletInfo => ({ id: w.name, name: w.name, icon: w.icon, ecosystem: "solana" });
  const store = createStore<WalletSnapshot>({ ecosystem: "solana", status: "disconnected", chain: chains[0]!, chains, wallets: [] });
  const features = (w: StandardWallet) => w.features as Features;

  const setConnected = (wallet: StandardWallet, account: WalletAccount) => {
    current = { wallet, account };
    store.set({ status: "connected", address: account.address, wallet: info(wallet), error: undefined });
  };
  const setDisconnected = () => {
    current = undefined;
    offEvents?.();
    offEvents = undefined;
    store.set({ status: "disconnected", address: undefined, wallet: undefined });
  };

  const attach = (wallet: StandardWallet, accounts: readonly WalletAccount[]) => {
    const account = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? accounts[0];
    if (!account) throw new Error(`${wallet.name} returned no account`);
    offEvents?.();
    offEvents = features(wallet)["standard:events"]?.on("change", ({ accounts: next }) => {
      if (!next) return;
      if (!next.length) setDisconnected();
      else if (current?.wallet === wallet) setConnected(wallet, next[0]!);
    });
    setConnected(wallet, account);
  };

  const connectWallet = async (wallet: StandardWallet, silent: boolean) => {
    const f = features(wallet)["standard:connect"];
    if (!f) throw new Error(`${wallet.name} does not support connecting`);
    store.set({ status: silent ? "reconnecting" : "connecting" });
    try {
      const { accounts } = await f.connect(silent ? { silent: true } : undefined);
      if (!accounts.length) {
        if (silent) return setDisconnected();
        throw new Error(`${wallet.name} returned no account`);
      }
      attach(wallet, accounts);
      try {
        localStorage.setItem(storageKey, wallet.name);
      } catch {
        // storage unavailable (private mode, SSR)
      }
    } catch (e) {
      setDisconnected();
      if (!silent) {
        store.set({ error: toError(e) });
        throw e;
      }
    }
  };

  const need = () => {
    if (!current) throw new Error("no Solana wallet connected");
    return current;
  };
  const rpc = () => createSolanaRpc(getRpcUrl(store.get().chain, env));
  const walletChain = (c: ChainConfig) => (c.walletChain ?? c.id) as `${string}:${string}`;

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      store.set({ error: toError(e) });
      throw e;
    }
  };

  return {
    ecosystem: "solana",
    getSnapshot: store.get,
    subscribe: store.subscribe,
    mount() {
      if (typeof window === "undefined") return () => {};
      const api = getWallets();
      const sync = () => {
        registered = api.get().filter(isSolanaWallet);
        store.set({ wallets: registered.map(info) });
      };
      sync();
      const offs = [api.on("register", sync), api.on("unregister", sync)];
      let last: string | null = null;
      try {
        last = localStorage.getItem(storageKey);
      } catch {
        // ignore
      }
      const tryReconnect = () => {
        if (!(opts.autoConnect ?? true) || !last || current || store.get().status !== "disconnected") return;
        const w = registered.find((x) => x.name === last);
        if (w) void connectWallet(w, true);
      };
      tryReconnect();
      offs.push(api.on("register", tryReconnect));
      return () => {
        for (const o of offs) o();
        offEvents?.();
      };
    },
    connect: (walletId) =>
      run(async () => {
        const w = walletId ? registered.find((x) => x.name === walletId) : registered[0];
        if (!w) throw new Error(walletId ? `no Solana wallet "${walletId}"` : "no Solana wallet found; install a Wallet Standard wallet");
        if (current?.wallet === w) return;
        await connectWallet(w, false);
      }),
    disconnect: () =>
      run(async () => {
        const w = current?.wallet;
        setDisconnected();
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
        await (w && features(w)["standard:disconnect"]?.disconnect());
      }),
    signMessage: (message) =>
      run(async () => {
        const { wallet, account } = need();
        const f = features(wallet)["solana:signMessage"];
        if (!f) throw new Error(`${wallet.name} cannot sign messages`);
        const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
        const [out] = await f.signMessage({ account, message: bytes });
        return b58.decode(out!.signature);
      }),
    sendTransaction: (tx: SolanaTransaction) =>
      run(async () => {
        const { wallet, account } = need();
        const chain = store.get().chain;
        const client = rpc();
        const { value: blockhash } = await client.getLatestBlockhash({ commitment: "confirmed" }).send();
        const message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayer(address(account.address), m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
          (m) => appendTransactionMessageInstructions(tx.instructions as unknown as Instruction[], m),
        );
        const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
        const f = features(wallet);
        const sendFeature = f["solana:signAndSendTransaction"];
        if (sendFeature) {
          const [out] = await sendFeature.signAndSendTransaction({
            account,
            chain: walletChain(chain),
            transaction: wire,
            options: { preflightCommitment: "confirmed" },
          });
          return b58.decode(out!.signature);
        }
        const signFeature = f["solana:signTransaction"];
        if (!signFeature) throw new Error(`${wallet.name} cannot sign transactions`);
        const [signed] = await signFeature.signTransaction({ account, chain: walletChain(chain), transaction: wire });
        const b64 = getBase64Decoder().decode(signed!.signedTransaction) as Parameters<typeof client.sendTransaction>[0];
        return await client.sendTransaction(b64, { encoding: "base64", preflightCommitment: "confirmed" }).send();
      }),
    switchChain: (ref) =>
      run(async () => {
        const c = getChain(ref);
        if (!chains.some((x) => x.key === c.key)) throw new Error(`switchChain: ${c.key} is not one of this adapter's chains`);
        store.set({ chain: c });
      }),
    waitForTransaction: async (signature, o) => {
      const client = rpc();
      const until = Date.now() + (o?.timeoutMs ?? 60_000);
      for (;;) {
        const { value } = await client.getSignatureStatuses([signature as Signature]).send();
        const s = value[0];
        if (s?.err) return { ok: false };
        if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return { ok: true };
        if (Date.now() > until) throw new Error(`transaction ${signature} not confirmed within ${(o?.timeoutMs ?? 60_000) / 1000}s`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    },
  };
}
