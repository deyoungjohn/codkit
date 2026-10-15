# @iamyoungjohn-kit/policy

Guardrails for AI agents that move money. Chain-agnostic TypeScript core with thin chain adapters.

- **Spend caps**: per transaction, rolling per-period, lifetime total, per asset (optionally per chain)
- **Allow / deny lists**: counterparties, contracts/programs, methods
- **Human approval** above a threshold, through any callback (CLI, Telegram, dashboard button)
- **Mandatory simulation** before execution (`requireSimulation`, on by default)
- **Kill switch**: in the policy, or `engine.kill()` at runtime; it also aborts in-flight executions
- **Reservations**: spend is reserved atomically on authorize, so concurrent agent calls can't overspend
- **Events** for every decision, simulation, approval, execution. Feed them to receipts or the demo dashboard

The core imports no chain SDK. The EVM adapter lives at `@iamyoungjohn-kit/policy/evm`, and `viem` is an optional peer.

## Quick start

```ts
import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";

const engine = createPolicyEngine({
  policy: {
    chains: ["eip155:84532"],
    deny: { addresses: ["0xBad…"] },
    allow: { programs: ["0x036CbD53842c5426634e7929541eC2318f3dCF7e"] },
    limits: [{
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", label: "USDC",
      perTx: usdc(5), perPeriod: { amount: usdc(20), seconds: 86_400 }, total: usdc(100),
      approvalAbove: usdc(2),
    }],
    // unknownAssets: "deny" (default) | "require_approval" | "allow"
    // requireSimulation: true (default)
  },
  approver: async ({ action, decision, simulation }) => askHumanSomehow(action),
  onEvent: (e) => dashboard.push(e),
});

// Full pipeline: evaluate+reserve → simulate → approve → kill-switch check → execute → commit
await engine.execute(action, { simulate, execute, ref: (r) => r.hash });

// Or just check (read-only), or authorize when something else performs the action:
const decision = await engine.evaluate(action);       // { verdict, reasons, checks }
const auth = await engine.authorize(action);          // throws PolicyError if denied/rejected
await auth.commit(txHash);                            // or auth.release()
```

An `Action` is the chain-agnostic shape every adapter produces:

```ts
{ chain: "eip155:84532", kind: "token_transfer", to: "0xRecipient", program: "0xUSDC",
  method: "transfer", spends: [{ asset: "0xUSDC", amount: 1_000_000n }] }
```

Amounts are always atomic units (`bigint`). Use `toAtomic("1.5", 6)`, `usdc("1.5")`, and `fromAtomic`. In policy JSON, amounts may be strings or numbers.

## EVM adapter (viem)

```ts
import { createEvmGuard } from "@iamyoungjohn-kit/policy/evm";

const guard = createEvmGuard({ engine, chainId: 84532, account: account.address, reader: publicClient, sender: walletClient });
await guard.send({ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) });
```

- It decodes ERC20 `transfer` / `transferFrom` / `approve`. Approvals count as spend, so an unlimited approval is denied by any cap.
- Other contract calls show only their native `value` as spend. Restrict them with `allow.programs` / `allow.methods`, and pass `abis` to get method names instead of selectors.
- Simulation uses `eth_call` + `eth_estimateGas` from the agent's address.

## Notes

- `MemorySpendStore` is the default. Implement `SpendStore` (5 methods) over Redis or SQLite if budgets must survive restarts.
- Reservations never expire unless you set `reservationTtlMs`. That is the conservative choice for signed-but-unsettled payments.
- EVM hex addresses are compared case-insensitively. Other identifiers (Solana base58) are compared exactly. Override this with `normalize`.

## Examples

```bash
pnpm --filter @iamyoungjohn-kit/policy example        # no chain: decisions, approval, budget, kill switch
pnpm --filter @iamyoungjohn-kit/policy example:evm    # Base Sepolia dry run (simulation catches the revert)
```
