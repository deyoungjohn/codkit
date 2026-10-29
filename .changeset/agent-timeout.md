---
"@codkit/mcp": patch
---

Agent loop: `requestTimeoutMs` (default 60 s) ends a hung model request and fails over to the next provider without retrying it. The Gemini preset now defaults to `gemini-3.5-flash,gemini-flash-lite-latest` (`gemini-2.5-flash` is retired).
