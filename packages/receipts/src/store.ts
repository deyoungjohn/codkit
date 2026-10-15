import type { Receipt } from "./types.js";

/** Persistence for receipts. The log serialises appends, so implementations needn't lock. */
export interface ReceiptStore {
  append(receipt: Receipt): Promise<void>;
  head(): Promise<Receipt | undefined>;
  list(): Promise<Receipt[]>;
}

export class MemoryReceiptStore implements ReceiptStore {
  private readonly receipts: Receipt[];

  constructor(initial: Receipt[] = []) {
    this.receipts = [...initial];
  }

  async append(r: Receipt): Promise<void> {
    this.receipts.push(r);
  }

  async head(): Promise<Receipt | undefined> {
    return this.receipts.at(-1);
  }

  async list(): Promise<Receipt[]> {
    return [...this.receipts];
  }
}
