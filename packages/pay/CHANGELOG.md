# @codkit/pay

## 0.1.3

### Patch Changes

- c03820a: Fix the Solana mainnet USDC mint in `USDC` / `usdcAddress()` (used by payment links and QR codes): it was a mistyped address with no account on-chain; it is now Circle's `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Every other entry was checked on-chain.

## 0.1.2

### Patch Changes

- a1fc1c2: Builds move from tsc to tsup: every entry point now ships ESM (`.js`) and CommonJS (`.cjs`), each with its own types (`.d.ts` / `.d.cts`), so `require()` and older bundlers work. Package-level `main` / `module` / `types` are added for tools that ignore `exports`.
- Updated dependencies [a1fc1c2]
  - @codkit/policy@0.1.1

## 0.1.1

### Patch Changes

- ab5c2f5: Payment links, QR codes and webhooks: `@codkit/pay/links` (EIP-681 / Solana Pay links, SVG QR codes, a Circle USDC address table, `usdcTransferTx` for the policy EVM guard) and `@codkit/pay/webhooks` (HMAC-signed events with retries, `verifyWebhook`, and an `onSettled` drop-in for paywalls).
- e0a0252: Paid MCP tools: `@codkit/pay/mcp` adds `mcpPaywall()` (price tools by name, settle only on success) and `withPaidTools()` (an MCP client bound by the policy engine). `createMcpServer` gains a `wrapHandler` option.
- 4918fc9: Solana x402: `@codkit/pay/svm` adds `svmSchemes()`, the `exact` SVM client scheme and devnet/mainnet constants. `paywall()` now adds the EVM scheme for `eip155:*` routes even when other schemes are passed, and errors clearly when a Solana route has no scheme.
