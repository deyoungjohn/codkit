/** The slice of `window` Wallet Standard and the Solana adapter use, for tests running in Node. */
const target = new EventTarget();
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: Object.assign(target, { navigator: { userAgent: "node" } }),
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});
