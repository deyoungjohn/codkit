"use client";

import { useWallets } from "@codkit/wallet";

export function Status() {
  return (
    <ul data-testid="status">
      {useWallets().map((w) => (
        <li key={w.ecosystem}>
          {w.ecosystem}: {w.status} on {w.chain.name}
        </li>
      ))}
    </ul>
  );
}
