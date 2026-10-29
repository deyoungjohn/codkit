# @codkit/mcp

## 0.2.1

### Patch Changes

- 120ecf9: Agent loop: `requestTimeoutMs` (default 60 s) ends a hung model request and fails over to the next provider without retrying it. The Gemini preset now defaults to `gemini-3.5-flash,gemini-flash-lite-latest` (`gemini-2.5-flash` is retired).
- e0a0252: Paid MCP tools: `@codkit/pay/mcp` adds `mcpPaywall()` (price tools by name, settle only on success) and `withPaidTools()` (an MCP client bound by the policy engine). `createMcpServer` gains a `wrapHandler` option.

## 0.2.0

### Minor Changes

- adb8742: `mcpHttpHandler` now requires an `auth` option and authenticates every request: static bearer tokens (constant-time compare), a custom `verify` hook for OAuth/JWT access tokens (with an RFC 9728 `resourceMetadataUrl`), or an explicit `allowAnonymous: true` for local development. Unauthorized requests get `401` with `WWW-Authenticate: Bearer`. **Breaking:** calls without `auth` now throw at startup.
