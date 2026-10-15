/**
 * Store the full receipt log on Walrus via the HTTP publisher / aggregator API
 * (no SDK). Import from `@iamyoungjohn-kit/receipts/walrus`.
 *
 * Public testnet endpoints are the defaults. Mainnet has no public publisher:
 * run your own or use an upload relay, and pass its URL.
 */
import { walrusBlobUrl } from "../explorer.js";
import type { Uploader } from "../types.js";

export const WALRUS_TESTNET = {
  publisher: "https://publisher.walrus-testnet.walrus.space",
  aggregator: "https://aggregator.walrus-testnet.walrus.space",
} as const;

export interface WalrusOptions {
  publisher?: string;
  aggregator?: string;
  /** Storage duration in epochs. Default 5. */
  epochs?: number;
  /** Send the resulting Blob object to this Sui address. */
  sendObjectTo?: string;
  network?: "testnet" | "mainnet";
  fetch?: typeof globalThis.fetch;
}

export interface WalrusStored {
  blobId: string;
  /** Sui object id of the Blob, when newly created. */
  objectId?: string;
  newlyCreated: boolean;
  endEpoch?: number;
}

export async function walrusStore(content: string | Uint8Array, opts: WalrusOptions = {}): Promise<WalrusStored> {
  const f = opts.fetch ?? globalThis.fetch;
  const params = new URLSearchParams({ epochs: String(opts.epochs ?? 5) });
  if (opts.sendObjectTo) params.set("send_object_to", opts.sendObjectTo);
  const res = await f(`${opts.publisher ?? WALRUS_TESTNET.publisher}/v1/blobs?${params}`, {
    method: "PUT",
    body: typeof content === "string" ? content : new Uint8Array(content),
  });
  if (!res.ok) throw new Error(`walrus store failed: ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as {
    newlyCreated?: { blobObject: { id: string; blobId: string; storage?: { endEpoch?: number } } };
    alreadyCertified?: { blobId: string; endEpoch?: number };
  };
  if (json.newlyCreated) {
    const b = json.newlyCreated.blobObject;
    return {
      blobId: b.blobId,
      objectId: b.id,
      newlyCreated: true,
      ...(b.storage?.endEpoch !== undefined && { endEpoch: b.storage.endEpoch }),
    };
  }
  if (json.alreadyCertified) {
    return {
      blobId: json.alreadyCertified.blobId,
      newlyCreated: false,
      ...(json.alreadyCertified.endEpoch !== undefined && { endEpoch: json.alreadyCertified.endEpoch }),
    };
  }
  throw new Error(`unexpected walrus response: ${JSON.stringify(json).slice(0, 200)}`);
}

export async function walrusRead(blobId: string, opts: Pick<WalrusOptions, "aggregator" | "fetch"> = {}): Promise<string> {
  const f = opts.fetch ?? globalThis.fetch;
  const res = await f(`${opts.aggregator ?? WALRUS_TESTNET.aggregator}/v1/blobs/${encodeURIComponent(blobId)}`);
  if (!res.ok) throw new Error(`walrus read failed: ${res.status}`);
  return res.text();
}

/** `Uploader` for `ReceiptLog.publish()`; URI is `walrus://<blobId>`. */
export function walrusUploader(opts: WalrusOptions = {}): Uploader {
  return {
    async upload(content) {
      const stored = await walrusStore(content, opts);
      return { id: stored.blobId, uri: `walrus://${stored.blobId}`, url: walrusBlobUrl(stored.blobId, opts.network) };
    },
  };
}

/** Fetch a log by `walrus://<blobId>` URI. */
export function readWalrusUri(uri: string, opts: Pick<WalrusOptions, "aggregator" | "fetch"> = {}): Promise<string> {
  if (!uri.startsWith("walrus://")) throw new Error(`not a walrus uri: ${uri}`);
  return walrusRead(uri.slice("walrus://".length), opts);
}
