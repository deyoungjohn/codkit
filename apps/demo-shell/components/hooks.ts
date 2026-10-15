"use client";

import type { FeedEvent } from "@iamyoungjohn-kit/feed";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/runtime";

/** Live feed over SSE; the browser's EventSource resumes with Last-Event-ID on reconnect. */
export function useFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    const es = new EventSource("/api/feed");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("feed", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as FeedEvent;
      if (seen.current.has(e.id)) return;
      seen.current.add(e.id);
      setEvents((prev) => [...prev, e].slice(-1000));
    });
    return () => es.close();
  }, []);
  const clear = useCallback(() => {
    seen.current.clear();
    setEvents([]);
  }, []);
  return { events, connected, clear };
}

export function useSnapshot(trigger: unknown) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.ok) setSnap(await r.json());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, trigger]);
  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);
  return { snap, refresh };
}

interface Eip6963Provider {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?(ev: string, cb: (x: unknown) => void): void };
}

/** Minimal wallet connect: EIP-6963 discovery, falling back to window.ethereum. */
export function useWallet() {
  const [providers, setProviders] = useState<Eip6963Provider[]>([]);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Eip6963Provider>).detail;
      setProviders((p) => (p.some((x) => x.info.uuid === d.info.uuid) ? p : [...p, d]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = (window as unknown as { ethereum?: Eip6963Provider["provider"] }).ethereum;
    if (legacy) {
      setProviders((p) => (p.length ? p : [{ info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "legacy" }, provider: legacy }]));
    }
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  const connect = useCallback(async (p: Eip6963Provider) => {
    try {
      setError(null);
      const accounts = (await p.provider.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(accounts[0] ?? null);
      setChainId(parseInt((await p.provider.request({ method: "eth_chainId" })) as string, 16));
      p.provider.on?.("accountsChanged", (a) => setAccount(((a as string[])[0] as string) ?? null));
      p.provider.on?.("chainChanged", (c) => setChainId(parseInt(c as string, 16)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "connection rejected");
    }
  }, []);

  return { providers, account, chainId, error, connect, disconnect: () => setAccount(null) };
}

export async function post(path: string, body: unknown = {}) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
