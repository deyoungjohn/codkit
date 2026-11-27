# @codkit/ui

## 0.3.0

### Minor Changes

- c03820a: `@codkit/ui/pay`: `<PayButton url>` and `usePaidFetch()` pay x402 endpoints from the connected EVM wallet, through a `@codkit/policy` engine that caps each payment (default 0.01 USDC) and the page's total before the wallet is asked to sign. Shows the settlement with an explorer link, or why it was refused. `@codkit/pay` and `@codkit/policy` are optional peers, needed only for this subpath.

### Patch Changes

- Updated dependencies [c03820a]
- Updated dependencies [c03820a]
  - @codkit/pay@0.1.3
  - @codkit/wallet@0.2.0

## 0.2.0

### Minor Changes

- 5e4c939: Visual and accessibility pass. Spacing on a 4px grid, a graphite colour ramp with quiet hairlines, weights 400/500, line icons (SVG) instead of text glyphs, and 150ms colour/transform transitions only. The wallet picker is labelled by its title, closes on a click outside it (`closedby="any"`, with a fallback for Safari), keeps the page from scrolling behind it, and fades in unless motion is reduced. The address pill keeps its width when copied and no longer claims a copy the browser refused. Toasts sit in a labelled notifications region in the top layer, show a status icon instead of a coloured edge, and wait while one has focus before auto-dismissing. New: `.ck-button-secondary`, `.ck-field`, `--ck-raised`, `--ck-radius-lg`. Changed: the default `--ck-radius` is 10px (was 12px), and the suggestion row says "Install" with an icon instead of "Install ↗".

## 0.1.3

### Patch Changes

- daac9ee: `ConnectButton`: "Get a wallet" appears only while fewer than 3 wallets are detected (`suggestBelow`), and the wallet list no longer has a fixed row cap: it takes the height it needs and scrolls only when the window is too short (the `--ck-visible-options` variable is gone). `@codkit/wallet`: the generic "Injected" option is hidden when the browser has no `window.ethereum`, so an empty browser shows the install links instead of a connect button that can only fail.
- Updated dependencies [daac9ee]
  - @codkit/wallet@0.1.2

## 0.1.2

### Patch Changes

- 966006c: `ConnectButton` closes once a wallet connects (and reopens on the first ecosystem not yet connected), and its list fits 10 wallets before scrolling (`--ck-visible-options`, `--ck-option-height` to tune).
- 64f785d: `ConnectButton` suggests wallets that aren't installed: official install links on desktop and "Open in Phantom / Solflare / Backpack / MetaMask" deep links on phones (`suggestions` prop, `suggestedWallets`). Fixes a missing space in the "keeps this site connected" note.

## 0.1.1

### Patch Changes

- 2bf2823: Wallet errors are `WalletError`s with plain messages (`code`: rejected, pending, unsupported, unavailable, wallet) instead of viem's raw text. EVM signing retries as plain-text `personal_sign` for wallets that refuse hex, and `disconnect()` asks the wallet to revoke the site and reports when it couldn't (`lastDisconnect`). `ConnectButton` is now one fixed-height dialog with a tab per ecosystem and a scrolling wallet list.
- Updated dependencies [b36e228]
- Updated dependencies [2bf2823]
  - @codkit/config@0.1.2
  - @codkit/wallet@0.1.1
