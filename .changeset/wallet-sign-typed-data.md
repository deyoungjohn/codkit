---
"@codkit/wallet": minor
---

EVM wallets can sign EIP-712 typed data: `useWallet("evm").signTypedData({ domain, types, primaryType, message })` (x402 payment authorizations, permits, sign-in). If the domain names another chain the adapter knows, the wallet switches to it first, because wallets refuse a domain `chainId` that isn't the active chain.
