# 0001: Wallet kit for `@codkit/wallet`

- Status: accepted
- Date: 2026-11-17
- Scope: EVM + Solana (Sui comes later as an adapter; see [HANDOFF](../HANDOFF.md))

## Decision

Wire the official libraries by hand, behind one `useWallet()` interface:

- **EVM:** `wagmi` 3 + `viem` 2. Wallets are discovered through EIP-6963 with the `injected` connector. Coinbase and WalletConnect are **opt-in connectors loaded on demand** (`import()`), never bundled by default.
- **Solana:** `@solana/react` 8 + `@wallet-standard/react`, which are Wallet Standard discovery and signing on the same release line as `@solana/kit`. Solana Mobile (`@solana-mobile/wallet-standard-mobile`) registers as one more Wallet Standard wallet when enabled.

The adapter for each ecosystem lives in its own file, so swapping a vendor means editing one file. No third-party modal: `@codkit/ui` supplies the connect UI.

## Candidates and evidence

The same minimal flow (provider + connect button, EVM and Solana) was bundled for each candidate with esbuild (minified, ESM, browser, React external). Measured on 2026-11-17:

| Candidate                                                         | Version        | Gzipped      | Builds for the browser as is                     | Notes                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------- | ------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **wagmi + `@solana/react` (chosen)**                              | 3.7.11 / 8.6.0 | **41 KB**    | yes                                              | MIT / Apache-2.0. Both are published by the maintainers of viem and @solana/kit, and were released this month.                                                     |
| wagmi (WalletConnect connector bundled eagerly) + `@solana/react` |                | 576 KB       | yes                                              | So WalletConnect must load on demand.                                                                                                                              |
| wagmi + `@solana/connector` (ConnectorKit)                        | 0.3.0          | 393 KB       | yes                                              | Solana Foundation, on kit 8, but 0.x and ~350 KB more than `@solana/react`.                                                                                        |
| `@dzapio/wallet`                                                  | 0.2.0          | ≥ 2,064 KB*  | **no**: imports Node `crypto`, `http`, `stream`… | Requires `@dzapio/sdk` (DZap's aggregator) as a peer; uses `@solana/web3.js` v1, Redux, and Suiet 0.5. 5 releases since 2026-08.                                   |
| `@sodax/wallet-sdk-react`                                         | 2.2.0          | ≥ 2,531 KB*  | **no**: same Node built-ins                      | Pins `wagmi` 2.16.9 and `viem` 2.29.2 as hard dependencies (duplicates next to wagmi 3); bundles the Injective, Stellar, NEAR and ICON SDKs; `@solana/web3.js` v1. |
| TrustConnect (`@trustwallet/connect-*`)                           | 0.0.0          | n/a          | n/a                                              | Every package is a `0.0.0` placeholder (2026-05-22); nothing to evaluate.                                                                                          |
| Solana framework-kit (`@solana/react-hooks`)                      | 1.4.1          | not measured |                                                  | Built on `@solana/kit` ^5 (we're on 8); last release 2026-01.                                                                                                      |

\* Sizes measured with Node built-ins left external, so they are a lower bound. Shipping these kits also needs polyfill configuration in every Next.js and Vite template.

Scores against the handoff criteria:

|                 | Chain coverage (EVM + Solana) | Bundle   | Headless / custom UI | SSR (Next.js)                                                                                                       | Licence          | Activity |
| --------------- | ----------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- |
| Chosen baseline | ✅                            | ✅ 41 KB | ✅ hooks only        | wagmi has `ssr: true` + cookie storage; Wallet Standard runs only on the client. **Verify in the Phase 2 example.** | MIT / Apache-2.0 | ✅       |
| ConnectorKit    | ✅                            | ⚠️       | ✅                   | to verify                                                                                                           | MIT              | ✅ (0.x) |
| dzap            | ✅ (+ BTC, Sui)               | ❌       | ⚠️ ships its own UI  | ❌ needs polyfills                                                                                                  | MIT              | ⚠️       |
| sodax           | ✅ (+ many)                   | ❌       | ⚠️                   | ❌ needs polyfills                                                                                                  | MIT              | ✅       |

## Consequences

- `@codkit/wallet` owns the unified interface and the two adapters. It depends on `wagmi`, `viem`, `@solana/react` and `@wallet-standard/react` as **peers**, so projects keep one copy of each.
- No Reown AppKit. WalletConnect is used for connection only, through wagmi's connector with a project ID from the free WalletConnect dashboard, and only when a project enables it.
- Sui later: `@mysten/dapp-kit-react` is also built on the Wallet Standard, so a Sui adapter fits the same shape.
- Revisit if ConnectorKit reaches 1.0 with a smaller footprint, or if a multichain kit appears that is headless, browser-clean and uses peer dependencies.
