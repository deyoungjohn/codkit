import { createPolicyEngine, type PolicyInput } from "@codkit/policy";
import { type Address, erc20Abi, parseEther } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evmChain } from "../src/evm.js";
import { agentTools } from "../src/index.js";
import { KEYS, RECIPIENT } from "./anvil.js";
import { createWorld, tusd } from "./world.js";

let world: Awaited<ReturnType<typeof createWorld>>;
let TUSD: Address;
let TOKB: Address;
let ROUTER: Address;
beforeAll(async () => {
  world = await createWorld();
  ({ TUSD, TOKB, ROUTER } = world);
});
afterAll(() => world.stop());

// thin wrappers so the tests read the same as the world they run in
const chain = new Proxy({} as typeof world.chain, { get: (_t, k) => (world.chain as never)[k] });
const setup: typeof world.setup = (o) => world.setup(o);
const toyProvider: typeof world.toyProvider = (n, r) => world.toyProvider(n, r);
const basePolicy = () => world.basePolicy();
const bal: typeof world.bal = (t, w) => world.bal(t, w);
const agent = () => world.agent();

describe("get_balance", () => {
  it("reads the gas token and every configured token in human units", async () => {
    const { call } = setup();
    const r = await call("get_balance", { chain: "anvil" });
    expect(r).toMatchObject({ ok: true, value: { chain: "anvil", address: agent() } });
    expect(r.ok && r.value.balances.TUSD).toBe("1000");
    expect(r.ok && Number(r.value.balances.ETH)).toBeGreaterThan(9000);
    expect(r.ok && r.value.balances.TOKB).toBe("0");
  });

  it("reads any address and rejects a bad one", async () => {
    const { call } = setup();
    const other = await call("get_balance", { chain: "anvil", address: RECIPIENT });
    expect(other.ok && other.value.address).toBe(RECIPIENT);
    expect(await call("get_balance", { chain: "anvil", address: "0x123" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a valid evm address"),
    });
  });
});

describe("transfer", () => {
  it("sends a token within the cap and policy, and records the spend with the tx hash", async () => {
    const { call, engine } = setup();
    const before = await bal(TUSD, RECIPIENT);
    const r = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "12.5", memo: "invoice 7" });
    expect(r).toMatchObject({
      ok: true,
      value: { status: "sent", dryRun: false, token: "TUSD", amount: "12.5", to: RECIPIENT, policy: "allowed" },
    });
    expect((await bal(TUSD, RECIPIENT)) - before).toBe(tusd("12.5"));
    const spends = await engine.spendStore.list();
    expect(spends).toEqual([expect.objectContaining({ status: "committed", amount: tusd("12.5"), ref: r.ok ? r.value.id : "" })]);
  });

  it("sends the gas token", async () => {
    const { call } = setup();
    const before = await chain.publicClient.getBalance({ address: RECIPIENT });
    const r = await call("transfer", { chain: "anvil", token: "eth", to: RECIPIENT, amount: "0.25" });
    expect(r.ok).toBe(true);
    expect((await chain.publicClient.getBalance({ address: RECIPIENT })) - before).toBe(parseEther("0.25"));
  });

  it("refuses above the operator's per-call cap, before policy or anything is sent", async () => {
    const { call, engine } = setup();
    const before = await bal(TUSD, RECIPIENT);
    const r = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "30.01" });
    expect(r).toEqual({ ok: false, error: "per-call cap: 30.01 TUSD is more than the 30 TUSD allowed in one call" });
    expect(await bal(TUSD, RECIPIENT)).toBe(before);
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("lets the model tighten the cap for one call but never loosen it", async () => {
    const { call } = setup();
    const tighter = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "5", maxSpend: "4" });
    expect(tighter).toMatchObject({ ok: false, error: expect.stringContaining("is more than the 4 TUSD") });
    const looser = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "40", maxSpend: "1000" });
    expect(looser).toMatchObject({ ok: false, error: expect.stringContaining("is more than the 30 TUSD") });
  });

  it("cannot move an asset the operator gave no cap", async () => {
    const { call } = setup({ caps: { TUSD: "30" } });
    expect(await call("transfer", { chain: "anvil", token: "TOKB", to: RECIPIENT, amount: "1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("no per-call cap for TOKB"),
    });
  });

  it("is stopped by the policy engine when the cap passes but the policy doesn't", async () => {
    const { call, engine } = setup({ caps: { TUSD: "500" } });
    const r = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "60" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/denied.*exceeds per-tx cap/) });
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("asks a human above the approval threshold: rejected means nothing is sent, approved goes through", async () => {
    const policy: PolicyInput = {
      chains: ["eip155:31337"],
      limits: [{ asset: TUSD, label: "TUSD", perTx: tusd("50"), approvalAbove: tusd("10") }],
    };
    const seen: unknown[] = [];
    const rejected = setup({ policy, approver: async (req) => (seen.push(req.action.kind), false) });
    const before = await bal(TUSD, RECIPIENT);
    expect(await rejected.call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "20" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("approval_rejected"),
    });
    expect(await bal(TUSD, RECIPIENT)).toBe(before);
    expect(seen).toEqual(["token_transfer"]);

    const approved = setup({ policy, approver: async () => true });
    const r = await approved.call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "20" });
    expect(r).toMatchObject({ ok: true, value: { status: "sent", policy: "approved by a human" } });
  });

  it("rejects bad input: unknown token, bad address, bad amount, unknown chain", async () => {
    const { call } = setup();
    expect(await call("transfer", { chain: "anvil", token: "DOGE", to: RECIPIENT, amount: "1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("unknown token DOGE on anvil; known: ETH, TUSD, TOKB"),
    });
    expect(await call("transfer", { chain: "anvil", token: "TUSD", to: "nope", amount: "1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a valid evm address"),
    });
    expect(await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "-1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("invalid input"),
    });
    expect(await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "0.0000001" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("more than 6 decimals"),
    });
    expect(await call("transfer", { chain: "mainnet", token: "TUSD", to: RECIPIENT, amount: "1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("invalid input"),
    });
  });
});

describe("dry run", () => {
  it("previews without sending, reserving or approving anything", async () => {
    const { call, engine } = setup();
    const before = await bal(TUSD, RECIPIENT);
    const r = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "10", dryRun: true });
    expect(r).toMatchObject({
      ok: true,
      value: {
        dryRun: true,
        wouldSucceed: true,
        needsHumanApproval: false,
        policy: { verdict: "allow" },
        simulation: { ok: true },
        note: "Dry run: nothing was sent.",
      },
    });
    expect(r.ok && "id" in r.value).toBe(false);
    expect(await bal(TUSD, RECIPIENT)).toBe(before);
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("is enforced by the operator: the model can't turn it off", async () => {
    const { call } = setup({ dryRun: true });
    const before = await bal(TUSD, RECIPIENT);
    const r = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "10", dryRun: false });
    expect(r).toMatchObject({ ok: true, value: { dryRun: true, enforcedByOperator: true } });
    expect(await bal(TUSD, RECIPIENT)).toBe(before);
  });

  it("reports what would stop the call: a policy denial, a failing simulation, a needed approval", async () => {
    const denied = setup({ caps: { TUSD: "500" } });
    const d = await denied.call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "60", dryRun: true });
    expect(d).toMatchObject({
      ok: true,
      value: { wouldSucceed: false, policy: { verdict: "deny", reasons: [expect.stringContaining("per-tx cap")] } },
    });

    const wide: PolicyInput = {
      chains: ["eip155:31337"],
      limits: [{ asset: TUSD, label: "TUSD", perTx: tusd("100000"), approvalAbove: tusd("2000") }],
    };
    const broke = setup({ policy: wide, caps: { TUSD: "100000" } });
    const s = await broke.call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "5000", dryRun: true });
    expect(s).toMatchObject({ ok: true, value: { wouldSucceed: false, needsHumanApproval: true, simulation: { ok: false } } });
    expect(s.ok && typeof s.value.simulation.error).toBe("string");
  });

  it("releases the reserved spend when the simulation fails for real", async () => {
    const wide: PolicyInput = { chains: ["eip155:31337"], limits: [{ asset: TUSD, label: "TUSD", perTx: tusd("100000") }] };
    const { call, engine } = setup({ policy: wide, caps: { TUSD: "100000" } });
    const r = await call("transfer", { chain: "anvil", token: "TUSD", to: RECIPIENT, amount: "5000" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("simulation_failed") });
    expect(await engine.spendStore.list()).toEqual([]);
  });
});

describe("swaps", () => {
  it("quotes without sending, picking the provider with the best guaranteed output", async () => {
    const { call } = setup({ swap: [toyProvider("cheap", 98n), toyProvider("best", 105n), toyProvider("none", 0n)] });
    const r = await call("quote_swap", { chain: "anvil", from: "TUSD", to: "TOKB", amount: "10" });
    expect(r).toMatchObject({
      ok: true,
      value: {
        provider: "best",
        sell: { token: "TUSD", amount: "10" },
        buy: { token: "TOKB", expected: "10.5", atLeast: "10.44750".replace(/0+$/, "") },
      },
    });
  });

  it("explains when no provider has a route", async () => {
    const { call } = setup({ swap: [toyProvider("alpha", 0n), toyProvider("beta", 0n)] });
    const r = await call("quote_swap", { chain: "anvil", from: "TUSD", to: "TOKB", amount: "10" });
    expect(r).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no swap route for TUSD → TOKB on anvil \(alpha: alpha has no route; beta: beta has no route\)/),
    });
  });

  it("approves exactly the input, swaps, reports what arrived, and counts the spend once", async () => {
    const { call, engine } = setup();
    const before = await bal(TOKB, agent());
    const r = await call("swap", { chain: "anvil", from: "TUSD", to: "TOKB", amount: "10" });
    expect(r).toMatchObject({
      ok: true,
      value: {
        status: "sent",
        dryRun: false,
        provider: "toy",
        needsApproval: true,
        received: { token: "TOKB", amount: "10" },
        policy: "allowed",
      },
    });
    expect(r.ok && typeof r.value.approvalTx).toBe("string");
    expect((await bal(TOKB, agent())) - before).toBe(tusd("10"));
    // the router consumed exactly what was approved: nothing is left over
    expect(
      await chain.publicClient.readContract({ address: TUSD, abi: erc20Abi, functionName: "allowance", args: [agent(), ROUTER] }),
    ).toBe(0n);
    const spends = (await engine.spendStore.list()).filter((s) => s.asset.toLowerCase() === TUSD.toLowerCase() && s.amount === tusd("10"));
    expect(spends).toHaveLength(1); // approval + swap are one policy unit, not 2× the spend
  });

  it("swaps the gas token in with no approval", async () => {
    const { call } = setup();
    const before = await bal(TOKB, agent());
    const r = await call("swap", { chain: "anvil", from: "ETH", to: "TOKB", amount: "0.002" });
    expect(r).toMatchObject({ ok: true, value: { status: "sent", needsApproval: false, received: { token: "TOKB", amount: "0.002" } } });
    expect((await bal(TOKB, agent())) - before).toBe(2000n);
  });

  it("applies the same three gates as transfers", async () => {
    const { call, engine } = setup();
    const before = await bal(TOKB, agent());
    expect(await call("swap", { chain: "anvil", from: "TUSD", to: "TOKB", amount: "31" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("per-call cap"),
    });
    const dry = await call("swap", { chain: "anvil", from: "TUSD", to: "TOKB", amount: "10", dryRun: true });
    expect(dry).toMatchObject({
      ok: true,
      value: { dryRun: true, wouldSucceed: true, quote: { provider: "toy", buy: { token: "TOKB" } } },
    });
    expect(await bal(TOKB, agent())).toBe(before);
    expect(
      await chain.publicClient.readContract({ address: TUSD, abi: erc20Abi, functionName: "allowance", args: [agent(), ROUTER] }),
    ).toBe(0n);
    expect((await engine.spendStore.list()).filter((s) => s.amount === tusd("31"))).toEqual([]);
  });

  it("limits slippage and refuses nonsense pairs", async () => {
    const { call } = setup({ maxSlippageBps: 100 });
    expect(await call("quote_swap", { chain: "anvil", from: "TUSD", to: "TOKB", amount: "1", slippageBps: 300 })).toMatchObject({
      ok: false,
      error: "slippage 300 bps is above the allowed 100 bps",
    });
    expect(await call("quote_swap", { chain: "anvil", from: "TUSD", to: "TUSD", amount: "1" })).toMatchObject({
      ok: false,
      error: "from and to are the same token",
    });
    expect(await call("quote_swap", { chain: "anvil", from: "TUSD", to: "WETH", amount: "1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("unknown token WETH"),
    });
  });

  it("has no swap tools when no chain can swap", () => {
    const engine = createPolicyEngine({ policy: basePolicy() });
    const adapter = evmChain({ chain: "anvil", publicClient: chain.publicClient, walletClient: chain.agent });
    const tools = agentTools({ engine, chains: [adapter], maxPerCall: { ETH: "1" } });
    expect(tools.map((t) => t.name)).toEqual(["get_balance", "transfer"]);
  });
});

describe("configuration", () => {
  it("rejects a setup that couldn't be safe", () => {
    const engine = createPolicyEngine({ policy: basePolicy() });
    const adapter = evmChain({ chain: "anvil", publicClient: chain.publicClient, walletClient: chain.agent });
    expect(() => agentTools({ engine, chains: [], maxPerCall: {} })).toThrow(/at least one chain/);
    expect(() => agentTools({ engine, chains: [adapter, adapter], maxPerCall: {} })).toThrow(/configured twice/);
    expect(() => agentTools({ engine, chains: [adapter], maxPerCall: { ETH: "lots" } })).toThrow(
      /maxPerCall\.ETH must be a decimal number/,
    );
    expect(() => evmChain({ chain: "solana-devnet", publicClient: chain.publicClient, walletClient: chain.agent })).toThrow(
      /not an EVM chain/,
    );
    expect(() =>
      evmChain({
        chain: "anvil",
        publicClient: chain.publicClient,
        walletClient: chain.agent,
        tokens: { eth: { address: TUSD, decimals: 6 } },
      }),
    ).toThrow(/clashes with the gas token/);
  });

  it("uses the deployer key for nothing: the agent's own key signs", () => {
    expect(chain.agent.account.address).not.toBe(chain.deployer.account.address);
    expect(KEYS.agent).not.toBe(KEYS.deployer);
  });
});
