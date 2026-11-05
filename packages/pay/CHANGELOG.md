# @codkit/pay

## 0.1.1

### Patch Changes

- ab5c2f5: Payment links, QR codes and webhooks: `@codkit/pay/links` (EIP-681 / Solana Pay links, SVG QR codes, a Circle USDC address table, `usdcTransferTx` for the policy EVM guard) and `@codkit/pay/webhooks` (HMAC-signed events with retries, `verifyWebhook`, and an `onSettled` drop-in for paywalls).
- e0a0252: Paid MCP tools: `@codkit/pay/mcp` adds `mcpPaywall()` (price tools by name, settle only on success) and `withPaidTools()` (an MCP client bound by the policy engine). `createMcpServer` gains a `wrapHandler` option.
- 4918fc9: Solana x402: `@codkit/pay/svm` adds `svmSchemes()`, the `exact` SVM client scheme and devnet/mainnet constants. `paywall()` now adds the EVM scheme for `eip155:*` routes even when other schemes are passed, and errors clearly when a Solana route has no scheme.
