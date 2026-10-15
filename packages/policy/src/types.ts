/**
 * Chain-agnostic description of something an agent wants to do.
 *
 * Adapters (EVM, Solana, x402, ...) turn chain-specific transactions into an
 * `Action`; the engine only ever sees this shape.
 */
export interface Action {
  /** CAIP-2 chain id, e.g. `eip155:84532`, `solana:devnet`. */
  chain: string;
  /** Free-form category, e.g. `transfer`, `contract_call`, `x402_payment`. */
  kind: string;
  /** Counterparty that ends up receiving value (or the contract called when no value moves). */
  to: string;
  /** Contract / program being invoked, if any. */
  program?: string;
  /** Function name or selector being invoked, if any. */
  method?: string;
  /** Value leaving the agent's wallet. Empty for pure calls. */
  spends: Spend[];
  /** Anything useful for logs, receipts or the approval UI. */
  meta?: Record<string, unknown>;
}

export interface Spend {
  /** `native` or a token address / mint. */
  asset: string;
  /** Atomic units (wei, lamports, USDC 6-decimals units, ...). */
  amount: bigint;
}

export type Verdict = "allow" | "deny" | "require_approval";

export type CheckName =
  | "kill_switch"
  | "chain"
  | "deny_list"
  | "allow_list"
  | "known_asset"
  | "per_tx"
  | "per_period"
  | "total"
  | "approval_threshold";

/** Result of a single rule. Every rule is evaluated so UIs can show the full picture. */
export interface Check {
  name: CheckName;
  verdict: Verdict;
  reason?: string;
}

export interface Decision {
  verdict: Verdict;
  /** Human-readable reasons for every non-`allow` check. */
  reasons: string[];
  checks: Check[];
  action: Action;
  evaluatedAt: number;
}

export interface SimulationResult {
  ok: boolean;
  error?: string;
  /** Adapter-specific extras (gas estimate, logs, balance changes ...). */
  details?: Record<string, unknown>;
}

export interface ApprovalRequest {
  action: Action;
  decision: Decision;
  simulation?: SimulationResult;
}

export type ApprovalResponse = boolean | { approved: boolean; by?: string; note?: string };

/** Called when an action needs a human. Wire it to a CLI prompt, Telegram bot, dashboard button ... */
export type Approver = (request: ApprovalRequest) => Promise<ApprovalResponse>;

export type PolicyEvent =
  | { type: "decision"; decision: Decision }
  | { type: "approval"; action: Action; approved: boolean; by?: string; note?: string }
  | { type: "simulation"; action: Action; result: SimulationResult }
  | { type: "executed"; action: Action; result: unknown }
  | { type: "failed"; action: Action; stage: "simulation" | "execution"; error: string }
  | { type: "committed"; action: Action; reservationId: string; ref?: string }
  | { type: "released"; action: Action; reservationId: string; reason?: string }
  | { type: "kill_switch"; engaged: boolean; reason?: string };
