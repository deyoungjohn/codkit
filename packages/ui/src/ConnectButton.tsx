import { useWallets, type Wallet, type WalletEcosystem } from "@codkit/wallet";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { AddressPill, cx } from "./AddressPill.js";

/** Tab labels; a new ecosystem (Sui, NEAR …) only needs an adapter and a name here. */
const TABS: Record<WalletEcosystem, string> = { evm: "EVM", solana: "Solana" };
const LONG: Record<WalletEcosystem, string> = { evm: "Ethereum & EVM", solana: "Solana" };

export interface ConnectButtonProps {
  /** Which ecosystems to offer. Default: every adapter in `<WalletProvider>`. */
  ecosystems?: WalletEcosystem[];
  label?: string;
  className?: string;
}

/**
 * Disconnected: a button that opens a wallet picker, one tab per ecosystem.
 * Connected: an address pill per connected ecosystem, with disconnect.
 */
export function ConnectButton({ ecosystems, label = "Connect wallet", className }: ConnectButtonProps) {
  const wallets = useWallets().filter((w) => !ecosystems || ecosystems.includes(w.ecosystem));
  const dialog = useRef<HTMLDialogElement>(null);
  const connected = wallets.filter((w) => w.status === "connected" && w.address);
  const firstOpen = () => (wallets.find((w) => w.status !== "connected") ?? wallets[0])?.ecosystem;
  const [tab, setTab] = useState<WalletEcosystem | undefined>(firstOpen);

  const open = () => {
    setTab(firstOpen());
    dialog.current?.showModal();
  };

  return (
    <div className={cx("ck-connect", className)}>
      {connected.map((w) => (
        <span key={w.ecosystem} className="ck-connected">
          {w.wallet?.icon && <img className="ck-icon" src={w.wallet.icon} alt="" />}
          <AddressPill address={w.address!} chain={w.chain} />
          <button
            type="button"
            className="ck-ghost"
            onClick={() => w.disconnect().catch(() => {})}
            aria-label={`Disconnect ${LONG[w.ecosystem]}`}
          >
            ✕
          </button>
        </span>
      ))}
      <button type="button" className="ck-button" onClick={open}>
        {!connected.length ? label : connected.length < wallets.length ? "Add wallet" : "Wallets"}
      </button>
      <dialog ref={dialog} className="ck-dialog" aria-label="Connect a wallet">
        <div className="ck-dialog-head">
          <strong>Connect a wallet</strong>
          <button type="button" className="ck-ghost" onClick={() => dialog.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>
        {wallets.length > 1 && <Tabs wallets={wallets} value={tab} onChange={setTab} />}
        {wallets
          .filter((w) => w.ecosystem === (tab ?? wallets[0]?.ecosystem))
          .map((w) => (
            <Panel
              key={w.ecosystem}
              wallet={w}
              onConnected={() =>
                wallets.some((x) => x !== w && x.status !== "connected") ? setTab(firstOther(wallets, w)) : dialog.current?.close()
              }
            />
          ))}
      </dialog>
    </div>
  );
}

const firstOther = (wallets: Wallet[], w: Wallet) => wallets.find((x) => x !== w && x.status !== "connected")?.ecosystem;

function Tabs({
  wallets,
  value,
  onChange,
}: {
  wallets: Wallet[];
  value: WalletEcosystem | undefined;
  onChange: (e: WalletEcosystem) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  // Arrow keys move between tabs (WAI-ARIA tabs pattern)
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + wallets.length) % wallets.length;
    onChange(wallets[next]!.ecosystem);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Ecosystem" className="ck-tabs">
      {wallets.map((w, i) => {
        const selected = w.ecosystem === value;
        return (
          <button
            key={w.ecosystem}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-${w.ecosystem}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="ck-tab"
            onClick={() => onChange(w.ecosystem)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {TABS[w.ecosystem]}
            {w.status === "connected" && <span className="ck-dot" role="img" aria-label="connected" />}
          </button>
        );
      })}
    </div>
  );
}

function Panel({ wallet: w, onConnected }: { wallet: Wallet; onConnected: () => void }) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const kept = w.lastDisconnect && !w.lastDisconnect.revoked ? w.lastDisconnect.wallet : undefined;

  const pick = async (id: string) => {
    setPending(id);
    setError(undefined);
    try {
      await w.connect(id);
      onConnected();
    } catch (e) {
      // adapters throw WalletError with a message meant for people
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(undefined);
    }
  };

  if (w.status === "connected" && w.address) {
    return (
      <section role="tabpanel" className="ck-panel" aria-label={LONG[w.ecosystem]}>
        <div className="ck-current">
          {w.wallet?.icon ? <img className="ck-icon" src={w.wallet.icon} alt="" /> : <span className="ck-icon" />}
          <div>
            <div>{w.wallet?.name}</div>
            <AddressPill address={w.address} chain={w.chain} />
          </div>
          <button type="button" className="ck-ghost" onClick={() => w.disconnect().catch(() => {})}>
            Disconnect
          </button>
        </div>
        <p className="ck-muted">To use another address, switch accounts in {w.wallet?.name ?? "your wallet"}; this page follows it.</p>
      </section>
    );
  }

  return (
    <section role="tabpanel" className="ck-panel" aria-label={LONG[w.ecosystem]}>
      {w.wallets.length ? (
        <ul className="ck-list">
          {w.wallets.map((option) => (
            <li key={option.id}>
              <button type="button" className="ck-option" disabled={!!pending} onClick={() => pick(option.id)}>
                {option.icon ? <img className="ck-icon" src={option.icon} alt="" /> : <span className="ck-icon" />}
                <span>{option.name}</span>
                {pending === option.id && <span className="ck-muted">Check your wallet…</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ck-muted">No {LONG[w.ecosystem]} wallet found. Install one, then reload.</p>
      )}
      {kept && (
        <p className="ck-note">
          {kept.name} keeps this site connected after a disconnect, so it will reconnect the same address. To use another one, switch
          accounts in {kept.name}
          first, or remove this site from its connected sites.
        </p>
      )}
      {error && (
        <p role="alert" className="ck-error">
          {error}
        </p>
      )}
    </section>
  );
}
