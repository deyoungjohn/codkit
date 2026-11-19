import { useWallets, type Wallet, type WalletEcosystem } from "@codkit/wallet";
import { useRef, useState } from "react";
import { AddressPill, cx } from "./AddressPill.js";

const NAMES: Record<WalletEcosystem, string> = { evm: "Ethereum & EVM", solana: "Solana" };

export interface ConnectButtonProps {
  /** Which ecosystems to offer. Default: every adapter in `<WalletProvider>`. */
  ecosystems?: WalletEcosystem[];
  label?: string;
  className?: string;
}

/**
 * Disconnected: a button that opens a wallet picker grouped by ecosystem.
 * Connected: an address pill per connected ecosystem, with disconnect.
 */
export function ConnectButton({ ecosystems, label = "Connect wallet", className }: ConnectButtonProps) {
  const wallets = useWallets().filter((w) => !ecosystems || ecosystems.includes(w.ecosystem));
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const connected = wallets.filter((w) => w.status === "connected" && w.address);
  const canConnectMore = wallets.some((w) => w.status !== "connected");

  const pick = async (w: Wallet, id: string) => {
    setPending(`${w.ecosystem}:${id}`);
    setError(undefined);
    try {
      await w.connect(id);
      dialog.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(undefined);
    }
  };

  return (
    <div className={cx("ck-connect", className)}>
      {connected.map((w) => (
        <span key={w.ecosystem} className="ck-connected">
          {w.wallet?.icon && <img className="ck-icon" src={w.wallet.icon} alt="" />}
          <AddressPill address={w.address!} chain={w.chain} />
          <button type="button" className="ck-ghost" onClick={() => w.disconnect()} aria-label={`Disconnect ${NAMES[w.ecosystem]}`}>
            ✕
          </button>
        </span>
      ))}
      {canConnectMore && (
        <button type="button" className="ck-button" onClick={() => dialog.current?.showModal()}>
          {connected.length ? "Add wallet" : label}
        </button>
      )}
      <dialog ref={dialog} className="ck-dialog" aria-label="Connect a wallet" onClose={() => setError(undefined)}>
        <div className="ck-dialog-head">
          <strong>Connect a wallet</strong>
          <button type="button" className="ck-ghost" onClick={() => dialog.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>
        {wallets
          .filter((w) => w.status !== "connected")
          .map((w) => (
            <section key={w.ecosystem} className="ck-group">
              <h3>{NAMES[w.ecosystem]}</h3>
              {w.wallets.length ? (
                <ul>
                  {w.wallets.map((option) => (
                    <li key={option.id}>
                      <button type="button" className="ck-option" disabled={!!pending} onClick={() => pick(w, option.id)}>
                        {option.icon ? <img className="ck-icon" src={option.icon} alt="" /> : <span className="ck-icon" />}
                        <span>{option.name}</span>
                        {pending === `${w.ecosystem}:${option.id}` && <span className="ck-muted">Connecting…</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ck-muted">No {NAMES[w.ecosystem]} wallet found. Install one, then reload.</p>
              )}
            </section>
          ))}
        {error && (
          <p role="alert" className="ck-error">
            {error}
          </p>
        )}
      </dialog>
    </div>
  );
}
