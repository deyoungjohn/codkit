---
"@codkit/ui": patch
"@codkit/wallet": patch
---

`ConnectButton`: "Get a wallet" appears only while fewer than 3 wallets are detected (`suggestBelow`), and the wallet list no longer has a fixed row cap: it takes the height it needs and scrolls only when the window is too short (the `--ck-visible-options` variable is gone). `@codkit/wallet`: the generic "Injected" option is hidden when the browser has no `window.ethereum`, so an empty browser shows the install links instead of a connect button that can only fail.
