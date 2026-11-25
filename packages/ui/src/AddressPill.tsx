import { type ChainRef, explorerAddressUrl } from "@codkit/config";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRightIcon, CheckIcon, CopyIcon } from "./icons.js";
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
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
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
            try {
              await navigator.clipboard.writeText(address);
            } catch {
              return; // no clipboard here (insecure page, or the browser said no): don't claim it worked
            }
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }}
        >
          <span>{label}</span>
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span className="ck-sr" role="status">
            {copied ? "Copied" : ""}
          </span>
        </button>
      ) : (
        <span>{label}</span>
      )}
      {href && (
        <a className="ck-pill-link" href={href} target="_blank" rel="noreferrer" aria-label="View on explorer">
          <ArrowUpRightIcon />
        </a>
      )}
    </span>
  );
}

export const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
