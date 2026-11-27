# Versions

The versions codkit is built and tested against, checked on the npm registry and local toolchains on **2026-11-17**. These ecosystems break often: re-check before a hackathon and update this file in the same PR as any bump.

## Chains and wallets

| Package                                       | Version                | Notes                                                                                                               |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `viem`                                        | 2.58.0                 |                                                                                                                     |
| `wagmi` / `@wagmi/core` / `@wagmi/connectors` | 3.7.11 / 3.6.9 / 8.2.4 | wagmi 3 is the major. Connector SDKs (Coinbase, WalletConnect, MetaMask) are optional peers of `@wagmi/connectors`. |
| `@tanstack/react-query`                       | 5.108.0                | wagmi peer                                                                                                          |
| `@solana/kit`                                 | 8.6.0                  | `@solana/react` releases on the same line                                                                           |
| `@solana/react`                               | 8.6.0                  | Wallet Standard hooks for kit                                                                                       |
| `@wallet-standard/react`                      | 1.0.3                  |                                                                                                                     |
| `@solana-mobile/wallet-standard-mobile`       | 0.7.1                  | optional                                                                                                            |
| `@solana-program/token` / `system`            | 0.18.0 / 0.16.0        | codkit still uses 0.17 / 0.15 in places                                                                             |
| `@mysten/sui` / `@mysten/dapp-kit-react`      | 2.39.1 / 2.1.45        | Sui is a later phase                                                                                                |

## Contracts and codegen

| Tool                              | Version                               | Notes                                               |
| --------------------------------- | ------------------------------------- | --------------------------------------------------- |
| Foundry (`forge`)                 | 1.8.3                                 | local                                               |
| `@openzeppelin/contracts`         | check at Phase 3                      | Phase 3 builds on OpenZeppelin v5                   |
| Anchor CLI                        | 1.2.1                                 | local, via `avm`                                    |
| `anchor-lang` (crate)             | 1.x in use; `2.0.0-rc.4` on crates.io | Stay on 1.x until 2.0 is final.                     |
| `@anchor-lang/core` (TS)          | 1.2.2                                 | `@coral-xyz/anchor` (0.32.1) is the pre-1.0 package |
| Solana CLI                        | 4.1.2                                 | pairs with Anchor 1.2.1                             |
| `codama` / `@codama/renderers-js` | 1.11.0 / 2.9.0                        | Phase 3 codegen                                     |
| Sui CLI                           | 1.82.1                                | local                                               |

## Agents and payments

| Package                                            | Version                              | Notes                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@x402/core`, `evm`, `svm`, `fetch`, `hono`, `mcp` | 2.31.0                               | codkit pins `~2.28.0`; bump deliberately and rerun `e2e:x402-solana`                                                                                                                            |
| `@modelcontextprotocol/sdk`                        | 1.32.2                               |                                                                                                                                                                                                 |
| `ai` (Vercel AI SDK)                               | 7.0.183                              | `@codkit/ai` (fallback models, structured output); has the AI Gateway built in (`createGateway`) and no provider fallback of its own (checked 2026-11-27)                                       |
| `@ai-sdk/anthropic` / `openai` / `google` / `groq` | 4.0.110 / 4.0.125 / 4.0.128 / 4.0.88 | `@codkit/ai` dependencies. Default models read from each package's model list: `claude-sonnet-5-5`, `gpt-5.5`, `gemini-3.5-flash`, `openai/gpt-oss-120b`; gateway `anthropic/claude-sonnet-5.5` |
| `@ai-sdk/openai-compatible` / `@ai-sdk/provider`   | 3.0.96 / 4.0.39                      | OpenRouter, NIM, AgentRouter, custom URLs; model spec `v4`                                                                                                                                      |
| `@coinbase/agentkit`                               | 0.10.4                               | Phase 4                                                                                                                                                                                         |
| `@lifi/sdk`                                        | 4.13.0                               | Phase 4                                                                                                                                                                                         |
| `@jup-ag/api`                                      | 6.0.48                               | Phase 4                                                                                                                                                                                         |

## Frameworks

| Package                         | Version       | Notes |
| ------------------------------- | ------------- | ----- |
| `next`                          | 16.4.6        |       |
| `react` / `react-dom`           | 19.3.1        |       |
| `vite` / `@vitejs/plugin-react` | 8.3.8 / 6.3.0 |       |
| `tailwindcss`                   | 4.3.5         |       |

## Repo tooling

| Tool              | Version                        | Notes                                                                                                                                                |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node              | 22.23.1 (local), 24 in CI      | packages declare `>=22`                                                                                                                              |
| pnpm              | 12.8.1                         |                                                                                                                                                      |
| `turbo`           | 2.11.11                        |                                                                                                                                                      |
| `typescript`      | **5.9.x**                      | TypeScript 7 (native compiler) is `latest` (7.0.2), but tsup's type-declaration build uses the TS 5 compiler API. Stay on 5.9 until tsup supports 7. |
| `tsup`            | 9.0.0                          | ESM + CJS + types                                                                                                                                    |
| `@biomejs/biome`  | 2.6.8                          | lint + format                                                                                                                                        |
| `vitest`          | 5.1.0 available; codkit on 3.2 | upgrade separately                                                                                                                                   |
| `@changesets/cli` | 3.0.3                          |                                                                                                                                                      |
| `zod`             | 4.6.7                          |                                                                                                                                                      |
