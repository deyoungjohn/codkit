# @codkit/wallet

## 0.1.2

### Patch Changes

- daac9ee: `ConnectButton`: "Get a wallet" appears only while fewer than 3 wallets are detected (`suggestBelow`), and the wallet list no longer has a fixed row cap: it takes the height it needs and scrolls only when the window is too short (the `--ck-visible-options` variable is gone). `@codkit/wallet`: the generic "Injected" option is hidden when the browser has no `window.ethereum`, so an empty browser shows the install links instead of a connect button that can only fail.

## 0.1.1

### Patch Changes

- 2bf2823: Wallet errors are `WalletError`s with plain messages (`code`: rejected, pending, unsupported, unavailable, wallet) instead of viem's raw text. EVM signing retries as plain-text `personal_sign` for wallets that refuse hex, and `disconnect()` asks the wallet to revoke the site and reports when it couldn't (`lastDisconnect`). `ConnectButton` is now one fixed-height dialog with a tab per ecosystem and a scrolling wallet list.
- Updated dependencies [b36e228]
  - @codkit/config@0.1.2
