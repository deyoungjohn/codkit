---
"@codkit/pay": patch
---

Solana x402: `@codkit/pay/svm` adds `svmSchemes()`, the `exact` SVM client scheme and devnet/mainnet constants. `paywall()` now adds the EVM scheme for `eip155:*` routes even when other schemes are passed, and errors clearly when a Solana route has no scheme.
