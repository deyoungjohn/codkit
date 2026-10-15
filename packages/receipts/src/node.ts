import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseJsonl } from "./log.js";
import type { ReceiptStore } from "./store.js";
import type { Receipt } from "./types.js";

/**
 * JSON Lines file store (Node only). Survives restarts; the file is the same
 * format `toJsonl()` uploads, so you can `cat` it, diff it, or verify it.
 */
export class JsonlFileStore implements ReceiptStore {
  private readonly receipts: Receipt[];

  constructor(readonly path: string) {
    this.receipts = existsSync(path) ? parseJsonl(readFileSync(path, "utf8")) : [];
  }

  async append(r: Receipt): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(r)}\n`);
    this.receipts.push(r);
  }

  async head(): Promise<Receipt | undefined> {
    return this.receipts.at(-1);
  }

  async list(): Promise<Receipt[]> {
    return [...this.receipts];
  }
}
