"use client";

import { useWallets } from "@codkit/wallet";

const NAMES = { evm: "EVM", solana: "Solana" } as const;

export function Status() {
  return (
    <ul className="status" data-testid="status">
      {useWallets().map((w) => (
        <li key={w.ecosystem} data-connected={w.status === "connected"}>
          <span className="dot" aria-hidden="true" />
          <span className="eco">{NAMES[w.ecosystem]}</span>
          <span className="detail">
            {w.ecosystem}: {w.status} on {w.chain.name}
          </span>
        </li>
      ))}
    </ul>
  );
}
