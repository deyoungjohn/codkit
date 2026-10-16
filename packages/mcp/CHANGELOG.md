# @codkit/mcp

## 0.2.0

### Minor Changes

- adb8742: `mcpHttpHandler` now requires an `auth` option and authenticates every request: static bearer tokens (constant-time compare), a custom `verify` hook for OAuth/JWT access tokens (with an RFC 9728 `resourceMetadataUrl`), or an explicit `allowAnonymous: true` for local development. Unauthorized requests get `401` with `WWW-Authenticate: Bearer`. **Breaking:** calls without `auth` now throw at startup.
