> **Integrated into codkit (2026-11-17).** This plan was written for a new repo; it now lives inside codkit. How it maps:
> - `@SCOPE` is `@codkit`, on public npm, MIT (open decisions 1–3). Chains: EVM + Solana first, Sui later (4). Templates: Next.js and Vite (5).
> - `payments/` is the existing `@codkit/pay`. `agent-tools/` builds on `@codkit/mcp` and `@codkit/policy`.
> - `contracts/` stays at `packages/contracts/{evm,solana,sui}`; remappings and git dependencies point there.
> - Phase 0 outcome: [decisions/0001-wallet-kit.md](decisions/0001-wallet-kit.md) and [VERSIONS.md](../VERSIONS.md).
> - The working brief is the root [CLAUDE.md](../CLAUDE.md).

# Handoff: Hackathon Toolkit

Read this first. It sets out the decisions made so far, why they were made, and the build plan. Treat the "Open decisions" as blocking: ask the owner before Phase 1.

## Who this is for

The owner is an experienced software and smart contract engineer who competes in web3 and AI hackathons. Domains: onchain finance and trading, AI agents and agentic DeFi, consumer apps and payments, developer tools and infra. Builds span EVM, Solana, Sui and whatever chain each sponsor uses.

## The goal

Ship hackathon projects faster by owning the glue code that gets rewritten every event. The goal is **not** to rebuild open-source tools or re-wrap one-line installs.

## Decisions already made

1. **One monorepo, packages only.** This repo holds reusable packages. It holds **no hackathon project code.**
2. **Each hackathon project lives in its own separate repo** and installs only the packages it needs from this one.
3. **Don't wrap what installs in one line.** viem, wagmi, @solana/kit, Anchor, Foundry, Vercel AI SDK and similar are used directly. A package here exists only if it saves real setup time or hides vendor churn.
4. **Don't rebuild infrastructure.** No custom WalletConnect relay, MPC/embedded wallets, bundlers, paymasters, RPC or indexers.
5. **Don't build a wallet modal from scratch.** Free multichain connect kits already exist (see Phase 0). Wrap one behind a thin interface so vendors can be swapped by editing one file.
6. **Avoid Reown AppKit's paid tiers.** Its community license caps free use (reported 500 MAU / 2.5M RPC calls per month), Pro is $89/month, and Starter projects are paused at limits. WalletConnect connection-only use is free via the WalletConnect dashboard, so keep it only as an optional QR/mobile connector.

## How projects consume this repo

Each language uses its own native mechanism:

| Layer | How a project installs it |
|---|---|
| TypeScript packages | Publish to npm under one scope (`@SCOPE/*`). `pnpm add @SCOPE/wallet`. Versioned with Changesets. |
| Solidity library | `forge install OWNER/REPO`, with a remapping pointing into `contracts/evm/src`. |
| Anchor / Rust crates | Cargo git dependency: `SCOPE-solana = { git = "...", package = "..." }`. |
| Sui Move package | `Move.toml` git dependency with `subdir = "contracts/sui"`. |
| New-project scaffold | `pnpm create @SCOPE/app my-project` generates a fresh standalone repo that depends on the packages above. |

Prefer npm over git dependencies for TypeScript. Git-subdirectory installs are fragile across package managers, and npm gives semver plus fast installs on hackathon wifi.

## Repo layout

```
/
├── packages/
│   ├── config/        # chain registry, RPC resolution, typed env validation
│   ├── wallet/        # thin multichain connect interface over a 3rd-party kit
│   ├── ui/            # ConnectButton, TokenAmountInput, TxStatusToast, AddressPill
│   ├── agent-tools/   # chain-agnostic agent tools (balance, transfer, quote, swap)
│   ├── payments/      # x402 client/server helpers
│   └── create-app/    # scaffolder CLI (create-app)
├── contracts/
│   ├── evm/           # Foundry library: audited-base mixins, deploy scripts
│   ├── solana/        # Anchor workspace: reusable crates + deploy scripts
│   └── sui/           # Move package
├── templates/         # what create-app copies (next-evm, next-solana, next-multichain, agent)
├── examples/          # tiny smoke-test apps that consume the published packages
└── .changeset/
```

`examples/` is not project code. It holds minimal apps that prove each package installs and works from npm.

## Tooling for this repo

- pnpm workspaces + Turborepo
- TypeScript strict, `tsup` for builds (ESM + CJS + types)
- Vitest (TS), Foundry tests (EVM), LiteSVM / Surfpool (Solana), `sui move test`
- Biome for lint and format
- Changesets for versions and publishing
- GitHub Actions: build, test, publish on merge to main

## Build plan

### Phase 0: Spikes (decide before building)
1. **Wallet kit evaluation.** Build the same connect flow in `examples/` with each candidate and score them on chain coverage (EVM, Solana, Sui), bundle size, headless/custom UI support, SSR/Next.js behaviour, licence, and recent commit activity:
   - TrustConnect SDK (Trust Wallet): free and open source; EVM, Solana, Bitcoin. No Sui seen in docs.
   - `@dzapio/wallet`: EVM, Solana, Bitcoin, Sui behind one provider.
   - `@sodax/wallet-sdk-react`: wraps wagmi, Solana wallet-adapter, Sui dapp-kit; adds Stellar and Injective.
   - Baseline: wagmi (EIP-6963) + Solana framework-kit + `@mysten/dapp-kit`, wired by hand.

   These were judged from docs only. Read the code and issue trackers before choosing. If none covers Sui well, use the hand-wired baseline for Sui.
2. **Version pinning.** Check current majors of wagmi/viem, @solana/kit, Anchor (1.0 shipped April 2026), @mysten/sui, AgentKit and x402 packages. Record them in `VERSIONS.md`.

**Done when:** a written decision in `docs/decisions/0001-wallet-kit.md` and a `VERSIONS.md`.

### Phase 1: Foundation
- Monorepo, Turborepo, tsup, Biome, Vitest, Changesets, CI.
- `@SCOPE/config`: chain registry (id, name, ecosystem, RPC URLs, explorer, native token), env schema with zod, `getRpcUrl(chain)` with fallback order.
- First publish of `@SCOPE/config@0.1.0`.

**Done when:** an `examples/` app installs `@SCOPE/config` from npm and resolves an RPC for one EVM chain, Solana devnet and Sui testnet.

### Phase 2: Wallet + UI
- `@SCOPE/wallet`: one interface, `useWallet()` returning `{ ecosystem, address, connect, disconnect, signMessage, sendTransaction, switchChain }`, with an adapter for the kit chosen in Phase 0. WalletConnect is an opt-in connector.
- `@SCOPE/ui`: shadcn-style components that copy into a project or import directly: ConnectButton, TokenAmountInput, TxStatusToast, AddressPill, ChainSwitcher.

**Done when:** one example app connects an EVM, Solana and Sui wallet, signs a message on each, and sends a testnet transfer on each.

### Phase 3: Contracts
- `contracts/evm`: Foundry lib on OpenZeppelin v5; deploy scripts that write addresses to a JSON file that `@SCOPE/config` can read.
- `contracts/solana`: Anchor workspace, Codama client generation.
- `contracts/sui`: Move package plus TS client generation.
- Codegen script: ABI/IDL → typed TS clients for each ecosystem.

**Done when:** a fresh external repo runs `forge install`, a cargo git dependency and a Move git dependency, and builds against each.

### Phase 4: Agents + payments
- `@SCOPE/agent-tools`: zod-typed tools `getBalance`, `transfer`, `quoteSwap`, `swap`. Providers: AgentKit for EVM, LI.FI for EVM swaps/bridging, Jupiter for Solana swaps. Exports for both the Vercel AI SDK and an MCP server.
- `@SCOPE/payments`: x402 server middleware (Hono/Next route) and client `fetch` wrapper.
- Every tool that moves funds needs a dry-run mode and a per-call spend cap.

**Done when:** an agent example quotes and executes a testnet swap through the Vercel AI SDK, and the same tools run from the MCP server; a paid endpoint example settles via x402 on testnet.

### Phase 5: Scaffolder
- `create-app`: prompts for ecosystem(s), agent yes/no and payments yes/no, copies a template from `templates/`, installs only the matching `@SCOPE/*` packages, and writes `.env.example`.

**Done when:** `pnpm create @SCOPE/app demo` produces a standalone repo that runs `pnpm dev` with a working connect button in under 5 minutes.

### Later
- More chains as sponsors require (add an adapter to `wallet`, entries to `config`).
- The toolkit itself, polished and documented, can be entered as a dev-tools hackathon project.

## Open decisions (ask the owner)

1. npm scope / package name prefix.
2. Public npm, or GitHub Packages (private)?
3. Licence (MIT suggested).
4. Chain priority for Phases 1–3: EVM + Solana + Sui, or start narrower?
5. Next.js only for templates, or also Vite?

## Things to verify, not assume

- All package versions and APIs: these ecosystems break often, and parts of this plan come from a web chat with search, not from running code.
- Wallet kit claims (free, chain coverage) against current docs and licences.
- Reown pricing and licence terms if WalletConnect is used beyond connection-only.
