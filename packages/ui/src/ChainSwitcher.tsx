import { useWallet, type WalletEcosystem } from "@codkit/wallet";
import { useState } from "react";
import { cx } from "./AddressPill.js";

export interface ChainSwitcherProps {
  ecosystem: WalletEcosystem;
  className?: string;
}

/** A select over the chains the ecosystem's adapter was configured with. */
export function ChainSwitcher({ ecosystem, className }: ChainSwitcherProps) {
  const wallet = useWallet(ecosystem);
  const [busy, setBusy] = useState(false);
  if (wallet.chains.length < 2) return null;
  return (
    <select
      className={cx("ck-select", className)}
      aria-label={`${ecosystem} network`}
      value={wallet.chain.key}
      disabled={busy}
      onChange={async (e) => {
        setBusy(true);
        try {
          await wallet.switchChain(e.target.value);
        } catch {
          // the wallet refused; the select snaps back to the current chain
        } finally {
          setBusy(false);
        }
      }}
    >
      {wallet.chains.map((c) => (
        <option key={c.key} value={c.key}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
