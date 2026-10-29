/**
 * Signed webhooks for payment events. Web Crypto only, so it runs on Node,
 * Bun, Deno, Workers and Next.js route handlers.
 *
 * Signature header (Stripe-style): `x-codkit-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 */
import type { SettledPayment } from "./server/core.js";

export const SIGNATURE_HEADER = "x-codkit-signature";

export interface WebhookEvent<T = unknown> {
  id: string;
  type: string;
  /** Unix seconds. */
  created: number;
  data: T;
}

export async function signWebhook(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

export interface VerifyWebhookOptions {
  /** The raw request body, exactly as received. */
  body: string;
  /** The `x-codkit-signature` header. */
  signature: string | null | undefined;
  secret: string;
  /** Reject signatures older than this (replay protection). Default 300. */
  toleranceSeconds?: number;
  now?: number;
}

/** Check a webhook's signature and age. Returns the parsed event, or throws. */
export async function verifyWebhook<T = unknown>(opts: VerifyWebhookOptions): Promise<WebhookEvent<T>> {
  const parts = Object.fromEntries((opts.signature ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) throw new Error("webhook: missing or malformed signature");
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) throw new Error("webhook: signature timestamp outside tolerance");
  const expected = await hmacHex(opts.secret, `${t}.${opts.body}`);
  if (!timingSafeEqual(expected, parts.v1)) throw new Error("webhook: signature mismatch");
  return JSON.parse(opts.body) as WebhookEvent<T>;
}

export interface WebhookSenderOptions {
  url: string;
  /** Shared secret, at least 16 characters (`openssl rand -hex 32`). */
  secret: string;
  /** Attempts per event, with exponential backoff. Default 4. */
  attempts?: number;
  /** First retry delay in ms; doubles each time. Default 500. */
  backoffMs?: number;
  fetch?: typeof globalThis.fetch;
  /** Called when an event could not be delivered after every attempt. */
  onError?: (error: Error, event: WebhookEvent) => void;
}

export interface WebhookSender {
  /** Deliver one event, retrying on network errors and non-2xx responses. Resolves when delivered or given up. */
  send<T>(type: string, data: T): Promise<{ delivered: boolean; event: WebhookEvent<T> }>;
  /** Drop-in `onSettled` for `paywall()` / `mcpPaywall()`: sends `payment.settled` without delaying the response. */
  onSettled: (payment: SettledPayment) => void;
}

export function webhookSender(opts: WebhookSenderOptions): WebhookSender {
  if (opts.secret.length < 16) throw new Error("webhookSender: secret must be at least 16 characters");
  const doFetch = opts.fetch ?? globalThis.fetch;
  const attempts = opts.attempts ?? 4;
  const backoff = opts.backoffMs ?? 500;

  const send: WebhookSender["send"] = async (type, data) => {
    const event = { id: `evt_${crypto.randomUUID()}`, type, created: Math.floor(Date.now() / 1000), data };
    const body = JSON.stringify(event, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    let last: Error = new Error("not sent");
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, backoff * 2 ** (i - 1)));
      try {
        const res = await doFetch(opts.url, {
          method: "POST",
          headers: { "content-type": "application/json", [SIGNATURE_HEADER]: await signWebhook(body, opts.secret) },
          body,
        });
        if (res.ok) return { delivered: true, event };
        last = new Error(`webhook: ${opts.url} answered ${res.status}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break; // won't succeed on retry
      } catch (e) {
        last = e instanceof Error ? e : new Error(String(e));
      }
    }
    opts.onError?.(last, event);
    return { delivered: false, event };
  };

  return { send, onSettled: (payment) => void send("payment.settled", payment).catch(() => {}) };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
