---
"@codkit/agent-tools": patch
---

`evmChain` accepts viem clients made for a specific chain. `createPublicClient({ chain: baseSepolia })` (or any Base/OP chain) failed to type-check against it, because those chains' transaction types aren't assignable to the generic `Chain`; the clients' chain parameter is now left open.
