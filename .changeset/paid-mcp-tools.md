---
"@codkit/pay": patch
"@codkit/mcp": patch
---

Paid MCP tools: `@codkit/pay/mcp` adds `mcpPaywall()` (price tools by name, settle only on success) and `withPaidTools()` (an MCP client bound by the policy engine). `createMcpServer` gains a `wrapHandler` option.
