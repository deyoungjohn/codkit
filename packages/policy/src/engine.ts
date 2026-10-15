import { PolicyError } from "./errors.js";
import { parsePolicy, type Limit, type Policy, type PolicyInput } from "./schema.js";
import { MemorySpendStore, type SpendStore } from "./store.js";
import type {
  Action,
  Approver,
  Check,
  Decision,
  PolicyEvent,
  SimulationResult,
  Spend,
  Verdict,
} from "./types.js";

export interface PolicyEngineOptions {
  policy: PolicyInput;
  store?: SpendStore;
  /** Asked when a decision is `require_approval`. Without one, those actions are denied. */
  approver?: Approver;
  /** Ignore reservations older than this when summing spend (crash recovery). Default: never expire. */
  reservationTtlMs?: number;
  /** Canonicalise addresses for comparison. Default: lowercase `0x…` hex, leave everything else as-is. */
  normalize?: (value: string, chain: string) => string;
  onEvent?: (event: PolicyEvent) => void;
  now?: () => number;
}

/** A successful `authorize()`: spend is reserved until you `commit()` or `release()` it. */
export interface Authorization {
  id: string;
  decision: Decision;
  approvedBy?: string;
  commit(ref?: string): Promise<void>;
  release(reason?: string): Promise<void>;
}

export interface ExecuteOptions<T> {
  /** Dry-run the action. Mandatory when the policy has `requireSimulation` (the default). */
  simulate?: () => Promise<SimulationResult>;
  execute: () => Promise<T>;
  /** Extract a reference (tx hash, signature) from the result for the spend log. */
  ref?: (result: T) => string | undefined;
}

export interface ExecuteResult<T> {
  result: T;
  decision: Decision;
  simulation?: SimulationResult;
  authorizationId: string;
}

const defaultNormalize = (value: string): string => (/^0x/i.test(value) ? value.toLowerCase() : value);

export class PolicyEngine {
  private policy: Policy;
  private readonly store: SpendStore;
  private readonly approver: Approver | undefined;
  private readonly ttl: number | undefined;
  private readonly norm: (value: string, chain: string) => string;
  private readonly listeners = new Set<(e: PolicyEvent) => void>();
  private readonly now: () => number;
  private killed: { reason?: string } | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(opts: PolicyEngineOptions) {
    this.policy = parsePolicy(opts.policy);
    this.store = opts.store ?? new MemorySpendStore();
    this.approver = opts.approver;
    this.ttl = opts.reservationTtlMs;
    this.norm = opts.normalize ?? defaultNormalize;
    this.now = opts.now ?? Date.now;
    if (opts.onEvent) this.listeners.add(opts.onEvent);
  }

  // ---------------------------------------------------------------- control

  get currentPolicy(): Policy {
    return this.policy;
  }

  setPolicy(input: PolicyInput): void {
    this.policy = parsePolicy(input);
  }

  get isKilled(): boolean {
    return this.killed !== null || this.policy.killSwitch;
  }

  /** Engage the kill switch: every subsequent action is denied, in-flight `execute()`s abort before sending. */
  kill(reason?: string): void {
    this.killed = reason === undefined ? {} : { reason };
    this.emit({ type: "kill_switch", engaged: true, ...(reason !== undefined && { reason }) });
  }

  resume(): void {
    this.killed = null;
    this.emit({ type: "kill_switch", engaged: false });
  }

  on(listener: (e: PolicyEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get spendStore(): SpendStore {
    return this.store;
  }

  // ------------------------------------------------------------- evaluation

  /** Read-only: what would happen to this action right now? Does not reserve anything. */
  async evaluate(action: Action): Promise<Decision> {
    const decision = await this.withLock(() => this.decide(action));
    this.emit({ type: "decision", decision });
    return decision;
  }

  /**
   * Evaluate, reserve the spend, and get human approval if required.
   * Throws `PolicyError` if denied or rejected. Use this when something other
   * than `execute()` performs the action (e.g. the x402 client signs a payment).
   */
  async authorize(action: Action, opts: { simulation?: SimulationResult } = {}): Promise<Authorization> {
    const auth = await this.reserve(action);
    try {
      await this.approveIfNeeded(auth, opts.simulation);
    } catch (e) {
      await auth.release("approval rejected");
      throw e;
    }
    return auth;
  }

  /**
   * The full guarded pipeline: evaluate + reserve → simulate → human approval
   * (if required) → kill-switch re-check → execute → commit. Any failure
   * releases the reservation.
   */
  async execute<T>(action: Action, opts: ExecuteOptions<T>): Promise<ExecuteResult<T>> {
    if (this.policy.requireSimulation && !opts.simulate) {
      throw new PolicyError("simulation_required", "policy requires a simulation before execution");
    }
    const auth = await this.reserve(action);
    let simulation: SimulationResult | undefined;
    try {
      if (opts.simulate) {
        try {
          simulation = await opts.simulate();
        } catch (e) {
          simulation = { ok: false, error: errorMessage(e) };
        }
        this.emit({ type: "simulation", action, result: simulation });
        if (!simulation.ok) {
          this.emit({ type: "failed", action, stage: "simulation", error: simulation.error ?? "simulation failed" });
          throw new PolicyError(
            "simulation_failed",
            `simulation failed: ${simulation.error ?? "unknown error"}`,
            auth.decision,
            simulation,
          );
        }
      }
      await this.approveIfNeeded(auth, simulation);
      if (this.isKilled) {
        throw new PolicyError("killed", `kill switch engaged${this.killed?.reason ? `: ${this.killed.reason}` : ""}`);
      }
    } catch (e) {
      await auth.release(errorMessage(e));
      throw e;
    }

    let result: T;
    try {
      result = await opts.execute();
    } catch (e) {
      this.emit({ type: "failed", action, stage: "execution", error: errorMessage(e) });
      await auth.release(`execution failed: ${errorMessage(e)}`);
      throw e;
    }
    this.emit({ type: "executed", action, result });
    await auth.commit(opts.ref?.(result));
    return {
      result,
      decision: auth.decision,
      authorizationId: auth.id,
      ...(simulation && { simulation }),
    };
  }

  // -------------------------------------------------------------- internals

  private async reserve(action: Action): Promise<Authorization> {
    const id = crypto.randomUUID();
    const spends = [...aggregate(action.spends, (a) => this.norm(a, action.chain))].filter(([, amt]) => amt !== 0n);
    const recordIds = spends.map(([asset]) => `${id}:${asset}`);
    const decision = await this.withLock(async () => {
      const d = await this.decide(action);
      if (d.verdict !== "deny") {
        const at = this.now();
        for (const [asset, amount] of spends) {
          await this.store.reserve({ id: `${id}:${asset}`, chain: action.chain, asset, amount, at, status: "reserved" });
        }
      }
      return d;
    });
    this.emit({ type: "decision", decision });
    if (decision.verdict === "deny") {
      throw new PolicyError("denied", `denied: ${decision.reasons.join("; ")}`, decision);
    }

    let settled = false;
    const auth: Authorization = {
      id,
      decision,
      commit: async (ref) => {
        if (settled) return;
        settled = true;
        await this.withLock(async () => {
          for (const rid of recordIds) await this.store.commit(rid, ref);
        });
        this.emit({ type: "committed", action, reservationId: id, ...(ref !== undefined && { ref }) });
      },
      release: async (reason) => {
        if (settled) return;
        settled = true;
        await this.withLock(async () => {
          for (const rid of recordIds) await this.store.release(rid);
        });
        this.emit({ type: "released", action, reservationId: id, ...(reason !== undefined && { reason }) });
      },
    };
    return auth;
  }

  private async approveIfNeeded(auth: Authorization, simulation?: SimulationResult): Promise<void> {
    const { decision } = auth;
    if (decision.verdict !== "require_approval") return;
    const { action } = decision;
    if (!this.approver) {
      this.emit({ type: "approval", action, approved: false, note: "no approver configured" });
      throw new PolicyError(
        "approval_rejected",
        `needs human approval but no approver is configured: ${decision.reasons.join("; ")}`,
        decision,
      );
    }
    let res;
    try {
      res = await this.approver({ action, decision, ...(simulation && { simulation }) });
    } catch (e) {
      res = { approved: false, note: `approver error: ${errorMessage(e)}` };
    }
    const r = typeof res === "boolean" ? { approved: res } : res;
    this.emit({ type: "approval", action, ...r });
    if (!r.approved) {
      throw new PolicyError(
        "approval_rejected",
        `approval rejected${r.note ? `: ${r.note}` : ""}`,
        decision,
      );
    }
    if (r.by !== undefined) auth.approvedBy = r.by;
  }

  private async decide(action: Action): Promise<Decision> {
    const p = this.policy;
    const chain = action.chain;
    const n = (v: string) => this.norm(v, chain);
    const checks: Check[] = [];
    const add = (name: Check["name"], verdict: Verdict, reason?: string) =>
      checks.push(reason === undefined ? { name, verdict } : { name, verdict, reason });

    // kill switch
    if (this.isKilled) {
      add("kill_switch", "deny", `kill switch engaged${this.killed?.reason ? `: ${this.killed.reason}` : ""}`);
    } else add("kill_switch", "allow");

    // chain
    if (p.chains && !p.chains.includes(chain)) add("chain", "deny", `chain ${chain} not allowed`);
    else add("chain", "allow");

    // deny list
    const denyHits: string[] = [];
    if (p.deny?.addresses?.some((a) => n(a) === n(action.to))) denyHits.push(`address ${action.to} is denied`);
    if (action.program && p.deny?.programs?.some((a) => n(a) === n(action.program!)))
      denyHits.push(`program ${action.program} is denied`);
    if (action.method && p.deny?.methods?.includes(action.method)) denyHits.push(`method ${action.method} is denied`);
    if (denyHits.length) add("deny_list", "deny", denyHits.join("; "));
    else add("deny_list", "allow");

    // allow list: each configured, non-empty list must match
    const allowMisses: string[] = [];
    const allow = p.allow;
    if (allow?.addresses?.length && !allow.addresses.some((a) => n(a) === n(action.to)))
      allowMisses.push(`address ${action.to} not in allow list`);
    if (allow?.programs?.length && action.program && !allow.programs.some((a) => n(a) === n(action.program!)))
      allowMisses.push(`program ${action.program} not in allow list`);
    if (allow?.methods?.length && action.method && !allow.methods.includes(action.method))
      allowMisses.push(`method ${action.method} not in allow list`);
    if (allowMisses.length) add("allow_list", "deny", allowMisses.join("; "));
    else add("allow_list", "allow");

    // spend limits
    const now = this.now();
    const reservedAfter = this.ttl === undefined ? undefined : now - this.ttl;
    for (const [asset, amount] of aggregate(action.spends, n)) {
      if (amount === 0n) continue;
      const limits = p.limits.filter((l) => n(l.asset) === asset && (l.chain === undefined || l.chain === chain));
      if (limits.length === 0) {
        add(
          "known_asset",
          p.unknownAssets,
          p.unknownAssets === "allow" ? undefined : `no limit configured for asset ${asset} on ${chain}`,
        );
        continue;
      }
      for (const limit of limits) {
        const name = limitName(limit);
        const scope = { asset, ...(limit.chain !== undefined && { chain: limit.chain }) };
        if (limit.perTx !== undefined) {
          if (amount > limit.perTx) add("per_tx", "deny", `${name}: ${amount} exceeds per-tx cap ${limit.perTx}`);
          else add("per_tx", "allow");
        }
        if (limit.perPeriod) {
          const since = now - limit.perPeriod.seconds * 1000;
          const spent = await this.store.sum({ ...scope, since, ...(reservedAfter !== undefined && { reservedAfter }) });
          if (spent + amount > limit.perPeriod.amount)
            add(
              "per_period",
              "deny",
              `${name}: ${spent} spent + ${amount} exceeds ${limit.perPeriod.amount} per ${limit.perPeriod.seconds}s`,
            );
          else add("per_period", "allow");
        }
        if (limit.total !== undefined) {
          const spent = await this.store.sum({ ...scope, ...(reservedAfter !== undefined && { reservedAfter }) });
          if (spent + amount > limit.total)
            add("total", "deny", `${name}: ${spent} spent + ${amount} exceeds total cap ${limit.total}`);
          else add("total", "allow");
        }
        if (limit.approvalAbove !== undefined) {
          if (amount > limit.approvalAbove)
            add("approval_threshold", "require_approval", `${name}: ${amount} above approval threshold ${limit.approvalAbove}`);
          else add("approval_threshold", "allow");
        }
      }
    }

    const verdict: Verdict = checks.some((c) => c.verdict === "deny")
      ? "deny"
      : checks.some((c) => c.verdict === "require_approval")
        ? "require_approval"
        : "allow";
    return {
      verdict,
      reasons: checks.filter((c) => c.verdict !== "allow" && c.reason).map((c) => c.reason!),
      checks,
      action,
      evaluatedAt: now,
    };
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private emit(event: PolicyEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // listeners must never break the guard path
      }
    }
  }
}

export function createPolicyEngine(opts: PolicyEngineOptions): PolicyEngine {
  return new PolicyEngine(opts);
}

function aggregate(spends: Spend[], norm: (asset: string) => string): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const s of spends) {
    if (s.amount < 0n) throw new Error(`negative spend for ${s.asset}`);
    const k = norm(s.asset);
    m.set(k, (m.get(k) ?? 0n) + s.amount);
  }
  return m;
}

function limitName(l: Limit): string {
  return l.label ?? `${l.asset}${l.chain ? `@${l.chain}` : ""}`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
