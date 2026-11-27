---
"@codkit/pay": patch
---

Fix the Solana mainnet USDC mint in `USDC` / `usdcAddress()` (used by payment links and QR codes): it was a mistyped address with no account on-chain; it is now Circle's `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Every other entry was checked on-chain.
