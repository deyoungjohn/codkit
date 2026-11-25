import { explorerTxUrl } from "@codkit/config";
import { useWallets, type WalletEcosystem } from "@codkit/wallet";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./AddressPill.js";
import { AlertIcon, CheckIcon, SpinnerIcon, XIcon } from "./icons.js";

export type TxStatus = "pending" | "confirmed" | "failed";

export interface TxToast {
  id: string;
  label: string;
  status: TxStatus;
  href?: string;
  error?: string;
}

export interface TxStatusToastProps extends Omit<TxToast, "id"> {
  onDismiss?: () => void;
  className?: string;
}

/** One toast: pending → confirmed / failed, with an explorer link. */
export function TxStatusToast({ label, status, href, error, onDismiss, className, id }: TxStatusToastProps & { id?: string }) {
  const text = status === "pending" ? "Waiting for confirmation…" : status === "confirmed" ? "Confirmed" : (error ?? "Failed");
  return (
    <div className={cx("ck-toast", `ck-toast-${status}`, className)} role={status === "failed" ? "alert" : "status"} data-toast={id}>
      <span className="ck-toast-icon">
        {status === "pending" ? <SpinnerIcon /> : status === "confirmed" ? <CheckIcon /> : <AlertIcon />}
      </span>
      <div>
        <strong>{label}</strong>
        <span className="ck-muted">{text}</span>
      </div>
      {href && (
        <a className="ck-toast-link" href={href} target="_blank" rel="noreferrer">
          View
        </a>
      )}
      {onDismiss && (
        <button type="button" className="ck-ghost" onClick={onDismiss} aria-label="Dismiss">
          <XIcon />
        </button>
      )}
    </div>
  );
}

type Track = (ecosystem: WalletEcosystem, txId: string, label?: string) => Promise<boolean>;
const Ctx = createContext<Track | null>(null);

/**
 * Renders a toast stack and provides `useTxToast()`. Put it inside `<WalletProvider>`.
 * Confirmed toasts dismiss themselves after `autoDismissMs`.
 */
export function TxToastProvider({ children, autoDismissMs = 6000 }: { children: ReactNode; autoDismissMs?: number }) {
  const wallets = useWallets();
  const ref = useRef(wallets);
  ref.current = wallets;
  const [toasts, setToasts] = useState<TxToast[]>([]);
  const update = useCallback(
    (id: string, patch: Partial<TxToast>) => setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    [],
  );
  const dismiss = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const stack = useRef<HTMLDivElement>(null);
  // The stack lives in the top layer (popover="manual": it stays up until dismissed, and light dismiss never touches it)
  // for as long as there is a toast.
  useEffect(() => {
    const el = stack.current;
    if (!el?.showPopover) return;
    try {
      if (toasts.length && !el.matches(":popover-open")) el.showPopover();
      else if (!toasts.length && el.matches(":popover-open")) el.hidePopover();
    } catch {
      // not connected yet, or already in the wanted state
    }
  }, [toasts.length]);
  // Don't pull a toast away from someone who is focused on it: wait until focus has left.
  const dismissLater = useCallback(
    (id: string) => {
      setTimeout(function tick() {
        const el = stack.current?.querySelector(`[data-toast="${CSS.escape(id)}"]`);
        if (el?.contains(document.activeElement)) setTimeout(tick, 1000);
        else dismiss(id);
      }, autoDismissMs);
    },
    [dismiss, autoDismissMs],
  );

  const track = useCallback<Track>(
    async (ecosystem, txId, label = "Transaction") => {
      const wallet = ref.current.find((w) => w.ecosystem === ecosystem);
      if (!wallet) throw new Error(`useTxToast: no ${ecosystem} wallet`);
      const id = `${ecosystem}:${txId}`;
      const href = explorerTxUrl(wallet.chain, txId);
      setToasts((ts) => [...ts.filter((t) => t.id !== id), { id, label, status: "pending", ...(href && { href }) }]);
      try {
        const { ok } = await wallet.waitForTransaction(txId);
        update(id, { status: ok ? "confirmed" : "failed", ...(!ok && { error: "Reverted onchain" }) });
        if (ok && autoDismissMs > 0) dismissLater(id);
        return ok;
      } catch (e) {
        update(id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [update, dismissLater, autoDismissMs],
  );

  const value = useMemo(() => track, [track]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <section ref={stack} className="ck-toasts" aria-label="Notifications" aria-live="polite" popover="manual">
        {toasts.map((t) => (
          <TxStatusToast key={t.id} {...t} onDismiss={() => dismiss(t.id)} />
        ))}
      </section>
    </Ctx.Provider>
  );
}

/** `const track = useTxToast(); const hash = await wallet.sendTransaction(tx); await track("evm", hash, "Send 1 USDC");` */
export function useTxToast(): Track {
  const t = useContext(Ctx);
  if (!t) throw new Error("useTxToast must be used inside <TxToastProvider>");
  return t;
}
