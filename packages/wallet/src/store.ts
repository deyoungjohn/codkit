/** A tiny external store with a referentially stable snapshot, for useSyncExternalStore. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      let changed = false;
      for (const k in patch) if (!Object.is(state[k], patch[k])) changed = true;
      if (!changed) return;
      state = { ...state, ...patch };
      for (const l of [...listeners]) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
