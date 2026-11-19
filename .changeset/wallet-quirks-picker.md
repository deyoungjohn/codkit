---
"@codkit/wallet": patch
"@codkit/ui": patch
---

Wallet errors are `WalletError`s with plain messages (`code`: rejected, pending, unsupported, unavailable, wallet) instead of viem's raw text. EVM signing retries as plain-text `personal_sign` for wallets that refuse hex, and `disconnect()` asks the wallet to revoke the site and reports when it couldn't (`lastDisconnect`). `ConnectButton` is now one fixed-height dialog with a tab per ecosystem and a scrolling wallet list.
