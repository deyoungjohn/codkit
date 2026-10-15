export type SpendStatus = "reserved" | "committed";

export interface SpendRecord {
  id: string;
  chain: string;
  asset: string;
  amount: bigint;
  /** Unix ms. */
  at: number;
  status: SpendStatus;
  /** Tx hash or other reference, set on commit. */
  ref?: string;
}

export interface SpendQuery {
  asset: string;
  /** Omit to sum across chains. */
  chain?: string;
  /** Only records with `at >= since`. */
  since?: number;
  /** Ignore `reserved` records older than this (unix ms). */
  reservedAfter?: number;
}

/**
 * Persistence for spend accounting. Implement it over Redis / SQLite / a JSON
 * file if the agent must survive restarts; the engine serialises access, so
 * implementations don't need their own locking within one process.
 */
export interface SpendStore {
  sum(query: SpendQuery): Promise<bigint>;
  reserve(record: SpendRecord): Promise<void>;
  commit(id: string, ref?: string): Promise<void>;
  release(id: string): Promise<void>;
  list(): Promise<SpendRecord[]>;
}

export class MemorySpendStore implements SpendStore {
  private records = new Map<string, SpendRecord>();

  async sum(q: SpendQuery): Promise<bigint> {
    let total = 0n;
    for (const r of this.records.values()) {
      if (r.asset !== q.asset) continue;
      if (q.chain !== undefined && r.chain !== q.chain) continue;
      if (q.since !== undefined && r.at < q.since) continue;
      if (r.status === "reserved" && q.reservedAfter !== undefined && r.at < q.reservedAfter) continue;
      total += r.amount;
    }
    return total;
  }

  async reserve(record: SpendRecord): Promise<void> {
    if (this.records.has(record.id)) throw new Error(`duplicate spend record ${record.id}`);
    this.records.set(record.id, { ...record });
  }

  async commit(id: string, ref?: string): Promise<void> {
    const r = this.records.get(id);
    if (!r) throw new Error(`unknown spend record ${id}`);
    r.status = "committed";
    if (ref !== undefined) r.ref = ref;
  }

  async release(id: string): Promise<void> {
    this.records.delete(id);
  }

  async list(): Promise<SpendRecord[]> {
    return [...this.records.values()].map((r) => ({ ...r }));
  }
}
