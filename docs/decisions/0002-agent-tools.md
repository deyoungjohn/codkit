# 0002: Agent tools (`@codkit/agent-tools`)

- Status: accepted, with three deviations from HANDOFF flagged below for the owner
- Date: 2026-11-24
- Scope: Phase 4 (balance, transfer, swap quote, swap) on EVM and Solana

## Decision

A new package, `@codkit/agent-tools`, with four zod-typed tools: `get_balance`, `transfer`, `quote_swap`, `swap`. They are `KitTool`s from `@codkit/mcp`, so one definition runs in the Vercel AI SDK, an MCP server, the existing OpenAI-compatible agent loop and WebMCP.

- **Core is chain-agnostic.** It imports no chain SDK. Chain code sits behind adapters in subpaths: `./evm` (viem), `./solana` (`@solana/kit`). Swap providers are separate subpaths too: `./uniswap`, `./lifi`, `./jupiter`.
- **Every tool that moves funds has the same three gates, in this order:**
  1. **Per-call cap.** The operator sets `maxPerCall` per asset (human units). The model may pass `maxSpend` to tighten it for one call, never to loosen it. An asset with no cap can't be moved by the tools at all.
  2. **Dry run.** Operator-forced (`dryRun: true` in the config) or requested by the model per call. The model can't switch off an operator-forced dry run. A dry run does everything except send: it prepares the transaction, checks the cap, asks the policy engine for its verdict (including "needs human approval") and simulates.
  3. **`@codkit/policy`.** Caps, allow/deny lists, approval, mandatory simulation, kill switch, through `engine.execute`.
- **The AI SDK adapter lives in `@codkit/mcp/ai-sdk`**, not in agent-tools, because it converts any `KitTool` (policy, pay, receipts and escrow tools too).
- **Payments stay in `@codkit/pay`.**

## Evidence (checked 2026-11-24)

| Question                                                      | Finding                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does LI.FI route swaps on testnets?                           | **No.** It lists Base Sepolia, Sepolia, OP Sepolia and Arbitrum Sepolia as chains, but quotes for USDC↔ETH on Base Sepolia and a Base Sepolia → OP Sepolia bridge both return HTTP 404 `No available quotes` (code 1002).                                                                                                                          |
| Does LI.FI work on mainnet without a key?                     | Yes. A Base USDC→ETH quote returned HTTP 200 (route via sushiswap) with a ready `transactionRequest` (`to`, `data`, `value`, `gasLimit`, `gasPrice`, `from`, `chainId`) and `estimate.approvalAddress`.                                                                                                                                            |
| Does Jupiter work on devnet?                                  | **No**, mainnet only. Both `lite-api.jup.ag/swap/v1` and `api.jup.ag/swap/v1` answered a SOL→USDC quote without a key.                                                                                                                                                                                                                             |
| Is there a testnet that can execute a real swap?              | **Yes: Uniswap v3 on Base Sepolia.** The factory (`0x4752…aD24`) has code, and WETH/USDC pools exist at all four fee tiers with non-zero liquidity (the 0.3% pool holds about 3.3×10¹⁴ liquidity units).                                                                                                                                           |
| Is `@coinbase/agentkit` worth using for EVM balance/transfer? | **No.** 35 direct dependencies (Privy, ZeroDev, Zora, Across, Allora, Coinbase CDP …), 825 MB installed, pins `@solana/kit` 2.3 (codkit uses 8), and `import("@coinbase/agentkit")` fails on Node 22 here (`ERR_PACKAGE_PATH_NOT_EXPORTED` for a kit subpath). Its transfers would also bypass the policy engine. viem does the same job directly. |
| Vercel AI SDK                                                 | `ai` 7.0.180 with `@ai-sdk/openai-compatible` 3.0.94 (`createOpenAICompatible`), peer `zod ^3.25.76 \|\| ^4.1.8`. v7 differs from older majors: loop control is `isStepCount(n)` (not `stepCountIs`), and there is a built-in `toolApproval` option.                                                                                               |

## Deviations from HANDOFF (1 and 2 confirmed by the owner 2026-11-24; the owner will run LI.FI/Jupiter on mainnet themselves; 3 still to confirm)

1. **AgentKit is not used.** See above. HANDOFF listed it for EVM; viem replaces it.
2. **The "execute a testnet swap" check uses Uniswap v3 on Base Sepolia, not LI.FI or Jupiter.** Both are mainnet only, and mainnet is off-limits for the tooling. LI.FI and Jupiter are still shipped as providers (quotes are read-only and safe): LI.FI's execution path is tested against a mainnet fork on Anvil, and Jupiter's by simulating the unsigned transaction on mainnet. Neither is ever sent to mainnet by codkit's tests or examples.
3. **The AI SDK export is `@codkit/mcp/ai-sdk`**, and agent-tools documents it. Same capability, wider reach.

## Consequences

- Testnet liquidity can disappear or be drained; the live testnet check then needs another pair. The pool can be re-checked with the factory call used above.
- LI.FI and Jupiter rate-limit keyless calls and may require keys later; both take an optional key.
- Policy limits are keyed by asset address, as everywhere else in codkit. Swap actions declare the asset leaving the wallet as the spend, so existing per-asset caps apply to swaps.
