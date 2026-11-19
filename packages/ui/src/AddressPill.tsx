import { type ChainRef, explorerAddressUrl } from "@codkit/config";
import { useState } from "react";
import { shortAddress } from "./units.js";

export interface AddressPillProps {
  address: string;
  /** Adds an explorer link for this chain. */
  chain?: ChainRef;
  chars?: number;
  /** Click to copy. Default true. */
  copy?: boolean;
  className?: string;
}

export function AddressPill({ address, chain, chars = 4, copy = true, className }: AddressPillProps) {
  const [copied, setCopied] = useState(false);
  const href = chain ? explorerAddressUrl(chain, address) : undefined;
  const label = shortAddress(address, chars);
  return (
    <span className={cx("ck-pill", className)} title={address}>
      {copy ? (
        <button
          type="button"
          className="ck-pill-copy"
          aria-label={copied ? "Copied" : `Copy ${address}`}
          onClick={async () => {
            await navigator.clipboard?.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : label}
        </button>
      ) : (
        <span>{label}</span>
      )}
      {href && (
        <a className="ck-pill-link" href={href} target="_blank" rel="noreferrer" aria-label="View on explorer">
          ↗
        </a>
      )}
    </span>
  );
}

export const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
