import { describe, expect, it, vi } from "vitest";
import {
  createPolicyEngine,
  isPolicyError,
  PolicyError,
  usdc,
  type Action,
  type PolicyEvent,
  type PolicyInput,
} from "../src/index.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CHAIN = "eip155:84532";
const ALICE = "0x1111111111111111111111111111111111111111";
const MALLORY = "0x6666666666666666666666666666666666666666";

const pay = (amount: bigint, to = ALICE, extra: Partial<Action> = {}): Action => ({
  chain: CHAIN,
  kind: "token_transfer",
  to,
  program: USDC,
  method: "transfer",
  spends: [{ asset: USDC, amount }],
  ...extra,
});

const basePolicy: PolicyInput = {
  limits: [{ asset: USDC, label: "USDC", perTx: usdc(5), perPeriod: { amount: usdc(10), seconds: 3600 }, total: usdc(25) }],
  requireSimulation: false,
};

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

async function expectCode(p: Promise<unknown>, code: PolicyError["code"]) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(isPolicyError(err), `expected PolicyError(${code}), got ${String(err)}`).toBe(true);
  expect((err as PolicyError).code).toBe(code);
  return err as PolicyError;
}

describe("evaluate", () => {
  it("allows an action within every cap", async () => {
    const engine = createPolicyEngine({ policy: basePolicy });
    const d = await engine.evaluate(pay(usdc(1)));
    expect(d.verdict).toBe("allow");
    expect(d.reasons).toEqual([]);
    expect(d.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(["kill_switch", "chain", "deny_list", "allow_list", "per_tx", "per_period", "total"]),
    );
  });

  it("denies above the per-tx cap and reports every failing rule", async () => {
    const engine = createPolicyEngine({ policy: { ...basePolicy, deny: { addresses: [MALLORY] } } });
    const d = await engine.evaluate(pay(usdc(6), MALLORY));
    expect(d.verdict).toBe("deny");
    expect(d.reasons).toHaveLength(2);
    expect(d.reasons.join()).toMatch(/per-tx cap/);
    expect(d.reasons.join()).toMatch(/is denied/);
  });

  it("is read-only", async () => {
    const engine = createPolicyEngine({ policy: basePolicy });
    for (let i = 0; i < 5; i++) await engine.evaluate(pay(usdc(5)));
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("matches EVM addresses case-insensitively", async () => {
    const engine = createPolicyEngine({ policy: { ...basePolicy, allow: { addresses: [ALICE.toUpperCase().replace("0X", "0x")] } } });
    expect((await engine.evaluate(pay(1n, ALICE))).verdict).toBe("allow");
    expect((await engine.evaluate(pay(1n, MALLORY))).verdict).toBe("deny");
  });

  it("keeps non-hex identifiers (e.g. Solana) case-sensitive", async () => {
    const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const engine = createPolicyEngine({
      policy: { limits: [{ asset: mint, perTx: 10n }], allow: { addresses: ["AbC"] }, requireSimulation: false },
    });
    const sol = (to: string): Action => ({ chain: "solana:devnet", kind: "transfer", to, spends: [{ asset: mint, amount: 1n }] });
    expect((await engine.evaluate(sol("AbC"))).verdict).toBe("allow");
    expect((await engine.evaluate(sol("abc"))).verdict).toBe("deny");
  });

  it("enforces program and method allow lists, ignoring them for plain transfers", async () => {
    const engine = createPolicyEngine({
      policy: { ...basePolicy, unknownAssets: "allow", allow: { programs: [USDC], methods: ["transfer"] } },
    });
    expect((await engine.evaluate(pay(1n))).verdict).toBe("allow");
    expect((await engine.evaluate(pay(1n, ALICE, { method: "approve" }))).reasons).toEqual([
      "method approve not in allow list",
    ]);
    const native: Action = { chain: CHAIN, kind: "transfer", to: ALICE, spends: [{ asset: "native", amount: 1n }] };
    expect((await engine.evaluate(native)).verdict).toBe("allow");
  });

  it("denies disallowed chains", async () => {
    const engine = createPolicyEngine({ policy: { ...basePolicy, chains: ["eip155:1"] } });
    expect((await engine.evaluate(pay(1n))).reasons).toEqual([`chain ${CHAIN} not allowed`]);
  });

  it("handles assets without a configured limit according to unknownAssets", async () => {
    const native: Action = { chain: CHAIN, kind: "transfer", to: ALICE, spends: [{ asset: "native", amount: 1n }] };
    for (const mode of ["deny", "require_approval", "allow"] as const) {
      const engine = createPolicyEngine({ policy: { ...basePolicy, unknownAssets: mode } });
      expect((await engine.evaluate(native)).verdict).toBe(mode);
    }
  });

  it("aggregates multiple spends of the same asset in one action", async () => {
    const engine = createPolicyEngine({ policy: basePolicy });
    const d = await engine.evaluate(
      pay(0n, ALICE, {
        spends: [
          { asset: USDC, amount: usdc(3) },
          { asset: USDC.toLowerCase(), amount: usdc(3) },
        ],
      }),
    );
    expect(d.verdict).toBe("deny");
  });

  it("scopes limits to a chain when one is given", async () => {
    const engine = createPolicyEngine({ policy: { limits: [{ asset: "native", chain: "eip155:1", perTx: 1n }], requireSimulation: false } });
    const native = (chain: string): Action => ({ chain, kind: "transfer", to: ALICE, spends: [{ asset: "native", amount: 5n }] });
    expect((await engine.evaluate(native("eip155:1"))).verdict).toBe("deny");
    // no limit on this chain → unknown asset → deny by default, but for a different reason
    expect((await engine.evaluate(native(CHAIN))).reasons[0]).toMatch(/no limit configured/);
  });
});

describe("spend accounting", () => {
  it("enforces the rolling per-period cap and frees budget as the window moves", async () => {
    const c = clock();
    const engine = createPolicyEngine({ policy: basePolicy, now: c.now });
    for (let i = 0; i < 2; i++) await (await engine.authorize(pay(usdc(5)))).commit();
    await expectCode(engine.authorize(pay(usdc(1))), "denied");
    c.advance(3600_000 + 1);
    await expect(engine.authorize(pay(usdc(5)))).resolves.toBeDefined();
  });

  it("enforces the lifetime total cap", async () => {
    const c = clock();
    const engine = createPolicyEngine({ policy: basePolicy, now: c.now });
    for (let i = 0; i < 5; i++) {
      await (await engine.authorize(pay(usdc(5)))).commit();
      c.advance(3600_000 + 1);
    }
    const err = await expectCode(engine.authorize(pay(usdc(1))), "denied");
    expect(err.decision?.reasons.join()).toMatch(/total cap/);
  });

  it("counts reservations, so concurrent authorizations cannot overspend", async () => {
    const engine = createPolicyEngine({ policy: basePolicy });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => engine.authorize(pay(usdc(4)))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });

  it("returns budget on release and ignores double settle", async () => {
    const engine = createPolicyEngine({ policy: basePolicy });
    const a = await engine.authorize(pay(usdc(5)));
    const b = await engine.authorize(pay(usdc(5)));
    await expectCode(engine.authorize(pay(usdc(5))), "denied");
    await a.release();
    await a.commit(); // no-op after release
    await b.commit("0xabc");
    await expect(engine.authorize(pay(usdc(5)))).resolves.toBeDefined();
    const records = await engine.spendStore.list();
    expect(records.find((r) => r.status === "committed")?.ref).toBe("0xabc");
  });

  it("expires stale reservations when reservationTtlMs is set", async () => {
    const c = clock();
    const engine = createPolicyEngine({ policy: basePolicy, now: c.now, reservationTtlMs: 60_000 });
    await engine.authorize(pay(usdc(5)));
    await engine.authorize(pay(usdc(5)));
    await expectCode(engine.authorize(pay(usdc(5))), "denied");
    c.advance(60_001);
    await expect(engine.authorize(pay(usdc(5)))).resolves.toBeDefined();
  });
});

describe("kill switch", () => {
  it("denies everything when engaged at runtime, until resumed", async () => {
    const engine = createPolicyEngine({ policy: basePolicy });
    engine.kill("anomaly detected");
    const err = await expectCode(engine.authorize(pay(1n)), "denied");
    expect(err.message).toMatch(/anomaly detected/);
    engine.resume();
    await expect(engine.authorize(pay(1n))).resolves.toBeDefined();
  });

  it("can be set in the policy", async () => {
    const engine = createPolicyEngine({ policy: { ...basePolicy, killSwitch: true } });
    expect((await engine.evaluate(pay(1n))).verdict).toBe("deny");
  });

  it("aborts an execute() that was waiting for approval", async () => {
    const engine = createPolicyEngine({
      policy: { limits: [{ asset: USDC, approvalAbove: 0n }], requireSimulation: false },
      approver: async () => {
        engine.kill("operator pressed the button");
        return true;
      },
    });
    const execute = vi.fn(async () => "0xhash");
    await expectCode(engine.execute(pay(1n), { execute }), "killed");
    expect(execute).not.toHaveBeenCalled();
    expect(await engine.spendStore.list()).toEqual([]);
  });
});

describe("human approval", () => {
  const policy: PolicyInput = { limits: [{ asset: USDC, perTx: usdc(100), approvalAbove: usdc(2) }], requireSimulation: false };

  it("rejects when approval is needed but no approver is configured", async () => {
    const engine = createPolicyEngine({ policy });
    await expectCode(engine.authorize(pay(usdc(3))), "approval_rejected");
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("does not ask below the threshold", async () => {
    const approver = vi.fn(async () => true);
    const engine = createPolicyEngine({ policy, approver });
    await engine.authorize(pay(usdc(2)));
    expect(approver).not.toHaveBeenCalled();
  });

  it("passes the decision and simulation to the approver and records who approved", async () => {
    const approver = vi.fn(async () => ({ approved: true, by: "alice@team" }));
    const engine = createPolicyEngine({ policy, approver });
    const res = await engine.execute(pay(usdc(3)), {
      simulate: async () => ({ ok: true, details: { gas: "21000" } }),
      execute: async () => "0xhash",
    });
    expect(res.result).toBe("0xhash");
    expect(approver).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ verdict: "require_approval" }),
        simulation: { ok: true, details: { gas: "21000" } },
      }),
    );
  });

  it("releases the reservation when the human says no (or the approver throws)", async () => {
    for (const approver of [async () => false, async () => Promise.reject(new Error("bot offline"))]) {
      const engine = createPolicyEngine({ policy, approver });
      await expectCode(engine.authorize(pay(usdc(3))), "approval_rejected");
      expect(await engine.spendStore.list()).toEqual([]);
    }
  });
});

describe("execute", () => {
  const policy: PolicyInput = { ...basePolicy, requireSimulation: true };

  it("refuses to run without a simulation when required", async () => {
    const engine = createPolicyEngine({ policy });
    await expectCode(engine.execute(pay(1n), { execute: async () => "x" }), "simulation_required");
  });

  it("does not execute when simulation fails or throws, and releases the reservation", async () => {
    const engine = createPolicyEngine({ policy });
    const execute = vi.fn(async () => "x");
    const err = await expectCode(
      engine.execute(pay(1n), { simulate: async () => ({ ok: false, error: "ERC20: insufficient balance" }), execute }),
      "simulation_failed",
    );
    expect(err.simulation?.error).toMatch(/insufficient balance/);
    await expectCode(
      engine.execute(pay(1n), { simulate: () => Promise.reject(new Error("rpc down")), execute }),
      "simulation_failed",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("commits with the result ref on success", async () => {
    const engine = createPolicyEngine({ policy });
    const res = await engine.execute(pay(usdc(1)), {
      simulate: async () => ({ ok: true }),
      execute: async () => ({ hash: "0xfeed" }),
      ref: (r) => r.hash,
    });
    expect(res.simulation).toEqual({ ok: true });
    expect(await engine.spendStore.list()).toEqual([expect.objectContaining({ status: "committed", ref: "0xfeed", amount: usdc(1) })]);
  });

  it("releases and rethrows when execution fails", async () => {
    const engine = createPolicyEngine({ policy });
    await expect(
      engine.execute(pay(1n), { simulate: async () => ({ ok: true }), execute: () => Promise.reject(new Error("nonce too low")) }),
    ).rejects.toThrow("nonce too low");
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("emits events for the whole pipeline, and listener errors don't break it", async () => {
    const events: PolicyEvent["type"][] = [];
    const engine = createPolicyEngine({ policy, onEvent: (e) => events.push(e.type) });
    engine.on(() => {
      throw new Error("bad listener");
    });
    await engine.execute(pay(1n), { simulate: async () => ({ ok: true }), execute: async () => "0x1" });
    expect(events).toEqual(["decision", "simulation", "executed", "committed"]);
  });
});

describe("policy schema", () => {
  it("accepts string / number / bigint amounts", () => {
    const engine = createPolicyEngine({
      policy: { limits: [{ asset: "native", perTx: "1000", total: 5000, perPeriod: { amount: 2000n, seconds: 60 } }] },
    });
    expect(engine.currentPolicy.limits[0]).toMatchObject({ perTx: 1000n, total: 5000n, perPeriod: { amount: 2000n } });
    expect(engine.currentPolicy.requireSimulation).toBe(true);
  });

  it("rejects malformed policies", () => {
    expect(() => createPolicyEngine({ policy: { limits: [{ asset: "native", perTx: "1.5" }] } })).toThrow();
    expect(() => createPolicyEngine({ policy: { limits: [], typo: true } as PolicyInput })).toThrow();
  });

  it("can be swapped at runtime", async () => {
    const engine = createPolicyEngine({ policy: basePolicy });
    engine.setPolicy({ ...basePolicy, deny: { addresses: [ALICE] } });
    expect((await engine.evaluate(pay(1n))).verdict).toBe("deny");
  });
});
