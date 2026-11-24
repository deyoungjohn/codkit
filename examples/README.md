# Examples

Small apps that prove the packages work together. Not project code: hackathon projects live in their own repos.

| Example                                                                                                        | What it shows                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [dapp-vite](dapp-vite) (its dev server reads the packages' source, so package edits show up without a rebuild) | `@codkit/wallet` + `@codkit/ui` in Vite: connect EVM and Solana wallets, sign on each, send a transfer on each with toasts. `pnpm --filter example-dapp-vite dev` |
| [dapp-next](dapp-next)                                                                                         | The same in the Next.js App Router: server-rendered, hydrates cleanly, keeps the connection across reloads. `pnpm --filter example-dapp-next dev`                 |

## End-to-end checks

Both drive headless Chromium with test wallets injected into the page (an EIP-6963 provider and a Wallet Standard wallet that forward signing to the Node test process, so keys never enter the page). Needs Foundry (`anvil`) and a Playwright Chromium: `npx playwright@1.64.1 install chromium`.

```bash
pnpm --filter example-dapp-vite e2e               # local: Anvil + a stub Solana RPC
pnpm --filter example-dapp-vite e2e -- --testnet  # real self-transfers on Base Sepolia + Solana devnet (agent keys from .env)
pnpm --filter example-dapp-vite e2e:picker         # picker layout in real Chromium: no scrollbar with 11-14 wallets, suggestions only below 3
pnpm --filter example-dapp-next build && pnpm --filter example-dapp-next e2e   # SSR + hydration + reconnect
```
