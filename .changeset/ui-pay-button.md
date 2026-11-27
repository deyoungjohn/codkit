---
"@codkit/ui": minor
---

`@codkit/ui/pay`: `<PayButton url>` and `usePaidFetch()` pay x402 endpoints from the connected EVM wallet, through a `@codkit/policy` engine that caps each payment (default 0.01 USDC) and the page's total before the wallet is asked to sign. Shows the settlement with an explorer link, or why it was refused. `@codkit/pay` and `@codkit/policy` are optional peers, needed only for this subpath.
