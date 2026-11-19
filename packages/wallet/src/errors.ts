/**
 * One error type for every wallet failure, with a message fit for the UI.
 * The library's original error (viem, a Wallet Standard wallet …) stays on `cause`.
 */
export type WalletErrorCode =
  /** The user said no in the wallet. */
  | "rejected"
  /** The wallet already has a request open (check the extension). */
  | "pending"
  /** The wallet doesn't support what was asked (method, chain, feature). */
  | "unsupported"
  /** No wallet connected / found. */
  | "unavailable"
  /** Anything else the wallet or RPC reported. */
  | "wallet";

export class WalletError extends Error {
  override readonly name = "WalletError";
  constructor(
    readonly code: WalletErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export const isWalletError = (e: unknown): e is WalletError => e instanceof WalletError;

/** Walk an error chain (viem nests the provider's error in `cause`) for a numeric code and the deepest message. */
function inspect(e: unknown): { code?: number; details?: string } {
  let code: number | undefined;
  let details: string | undefined;
  for (
    let cur = e as { code?: unknown; details?: unknown; message?: unknown; cause?: unknown } | undefined, i = 0;
    cur && i < 8;
    cur = cur.cause as typeof cur, i++
  ) {
    if (code === undefined && typeof cur.code === "number") code = cur.code;
    if (typeof cur.details === "string" && cur.details) details = cur.details;
    else if (!details && i > 0 && typeof cur.message === "string") details = cur.message;
  }
  return { ...(code !== undefined && { code }), ...(details && { details }) };
}

const REJECTED = /reject|denied|declin|cancel/i;

/**
 * Normalise anything a wallet throws. `wallet` is the wallet's name, `action` what was
 * being attempted ("sign the message"), for messages like "Phantom can't sign the message".
 */
export function toWalletError(e: unknown, ctx: { wallet?: string; action?: string } = {}): WalletError {
  if (e instanceof WalletError) return e;
  const who = ctx.wallet ?? "Your wallet";
  const { code, details } = inspect(e);
  const top = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  if (code === 4001 || (code === undefined && REJECTED.test(`${top} ${details ?? ""}`))) {
    return new WalletError("rejected", `You rejected the request in ${ctx.wallet ?? "your wallet"}.`, { cause: e });
  }
  if (code === -32002) return new WalletError("pending", `${who} already has a request open. Check the extension.`, { cause: e });
  if (code === 4200 || code === -32601 || code === 4902) {
    return new WalletError("unsupported", `${who} doesn't support ${ctx.action ?? "this request"}${details ? ` (${details})` : ""}.`, {
      cause: e,
    });
  }
  // Keep the wallet's own words: "An unknown RPC error occurred" alone helps nobody.
  const why = details && !top.includes(details) ? `${top.replace(/\.$/, "")}: ${details}` : top;
  return new WalletError(
    "wallet",
    `${who} couldn't ${ctx.action ?? "complete the request"}. ${why.replace(/\s*Version: viem@[\d.]+\.?/, "").trim()}`,
    { cause: e },
  );
}
