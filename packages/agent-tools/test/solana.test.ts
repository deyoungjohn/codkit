import { type AnyKitTool, callTool } from "@codkit/mcp";
import { createPolicyEngine, type PolicyInput, toAtomic } from "@codkit/policy";
import {
  type Address,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type KeyPairSigner,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentTools } from "../src/index.js";
import { JUPITER_PROGRAM } from "../src/jupiter.js";
import { type SolanaSwapProvider, solanaChain } from "../src/solana.js";
import { account, startStubRpc, tokenAccountData, TOKEN_2022 } from "./solana-rpc.js";

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SYSTEM = "11111111111111111111111111111111";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const usdc = (v: string) => toAtomic(v, 6);
const sol = (v: string) => toAtomic(v, 9);

let stub: Awaited<ReturnType<typeof startStubRpc>>;
let agent: KeyPairSigner;
let recipient: Address;
let agentUsdcAta: Address;
let recipientUsdcAta: Address;
beforeAll(async () => {
  stub = await startStubRpc();
  agent = await generateKeyPairSigner();
  recipient = (await generateKeyPairSigner()).address;
  agentUsdcAta = (await findAssociatedTokenPda({ owner: agent.address, mint: address(USDC_MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  recipientUsdcAta = (await findAssociatedTokenPda({ owner: recipient, mint: address(USDC_MINT), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
});
afterAll(() => stub.close());

const policy = (): PolicyInput => ({
  chains: [DEVNET],
  limits: [
    { asset: "native", label: "SOL", perTx: sol("1") },
    { asset: USDC_MINT, label: "USDC", perTx: usdc("50") },
  ],
});

function setup(o: { swap?: SolanaSwapProvider[]; dryRun?: boolean; swapAllowedPrograms?: string[] } = {}) {
  const engine = createPolicyEngine({ policy: policy() });
  const adapter = solanaChain({
    chain: "solana-devnet",
    rpc: createSolanaRpc(stub.url),
    signer: agent,
    tokens: { USDC: { mint: USDC_MINT, decimals: 6 } },
    ...(o.swap && { swap: o.swap }),
    ...(o.swapAllowedPrograms && { swapAllowedPrograms: o.swapAllowedPrograms }),
    confirmTimeoutMs: 2000,
  });
  const tools = agentTools({
    engine,
    chains: [adapter],
    maxPerCall: { SOL: "0.5", USDC: "30" },
    ...(o.dryRun !== undefined && { dryRun: o.dryRun }),
  });
  const call = async (name: string, args: unknown) => {
    const res = await callTool(tools.find((t: AnyKitTool) => t.name === name)!, args);
    return res.ok ? { ok: true as const, value: res.value as Record<string, any> } : { ok: false as const, error: res.error };
  };
  return { engine, call, adapter };
}

const reset = () => {
  stub.state.lamports = 5_000_000_000n;
  stub.state.tokenBalances = {};
  stub.state.mintOwners = {};
  stub.state.simulate = () => ({});
  stub.state.status = () => ({ confirmationStatus: "confirmed" });
  stub.state.multipleAccounts = [];
  stub.state.sent = [];
  stub.resetMulti();
};

/** Decode a transaction the stub received: fee payer and each instruction's program, accounts and data. */
function decodeSent(wire: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
    staticAccounts: Address[];
    instructions: { programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array }[];
  };
  return {
    feePayer: msg.staticAccounts[0]!,
    signedByAgent: tx.signatures[agent.address] != null,
    ixs: msg.instructions.map((ix) => ({
      program: msg.staticAccounts[ix.programAddressIndex]!,
      accounts: (ix.accountIndices ?? []).map((i) => msg.staticAccounts[i]!),
      data: ix.data ?? new Uint8Array(),
    })),
  };
}

describe("solana balances and transfers", () => {
  it("reads SOL and token balances, treating a missing token account as zero", async () => {
    reset();
    stub.state.lamports = 2_500_000_000n;
    const { call } = setup();
    expect(await call("get_balance", { chain: "solana-devnet" })).toMatchObject({
      ok: true,
      value: { address: agent.address, balances: { SOL: "2.5", USDC: "0" } },
    });
    stub.state.tokenBalances[agentUsdcAta] = usdc("12.34");
    expect(await call("get_balance", { chain: "solana-devnet" })).toMatchObject({ value: { balances: { SOL: "2.5", USDC: "12.34" } } });
  });

  it("sends SOL: one System transfer from the agent, fee paid by the agent, spend recorded with the signature", async () => {
    reset();
    const { call, engine } = setup();
    const r = await call("transfer", { chain: "solana-devnet", token: "SOL", to: recipient, amount: "0.25", memo: "rent" });
    expect(r).toMatchObject({ ok: true, value: { status: "sent", token: "SOL", amount: "0.25", to: recipient } });
    expect(stub.state.sent).toHaveLength(1);
    const tx = decodeSent(stub.state.sent[0]!);
    expect(tx).toMatchObject({ feePayer: agent.address, signedByAgent: true });
    expect(tx.ixs).toHaveLength(1);
    expect(tx.ixs[0]).toMatchObject({ program: SYSTEM, accounts: [agent.address, recipient] });
    const data = new DataView(tx.ixs[0]!.data.buffer, tx.ixs[0]!.data.byteOffset);
    expect([data.getUint32(0, true), data.getBigUint64(4, true)]).toEqual([2, sol("0.25")]); // System::Transfer(lamports)
    expect(await engine.spendStore.list()).toEqual([
      expect.objectContaining({ status: "committed", amount: sol("0.25"), ref: r.ok ? r.value.id : "" }),
    ]);
  });

  it("sends a token: creates the recipient's token account if needed, then transfers with the right decimals", async () => {
    reset();
    const { call } = setup();
    expect(await call("transfer", { chain: "solana-devnet", token: "USDC", to: recipient, amount: "7.5" })).toMatchObject({
      ok: true,
      value: { status: "sent", token: "USDC", amount: "7.5" },
    });
    const tx = decodeSent(stub.state.sent[0]!);
    expect(tx.ixs.map((i) => i.program)).toEqual([ATA_PROGRAM, TOKEN_PROGRAM_ADDRESS]);
    expect(tx.ixs[0]!.accounts).toEqual(expect.arrayContaining([agent.address, recipientUsdcAta, recipient, USDC_MINT]));
    const transfer = tx.ixs[1]!;
    expect(transfer.accounts).toEqual([agentUsdcAta, USDC_MINT, recipientUsdcAta, agent.address]);
    const d = new DataView(transfer.data.buffer, transfer.data.byteOffset);
    expect([d.getUint8(0), d.getBigUint64(1, true), d.getUint8(9)]).toEqual([12, usdc("7.5"), 6]); // TransferChecked(amount, decimals)
  });

  it("refuses a Token-2022 mint instead of mishandling it", async () => {
    reset();
    stub.state.mintOwners[USDC_MINT] = TOKEN_2022;
    const { call } = setup();
    expect(await call("transfer", { chain: "solana-devnet", token: "USDC", to: recipient, amount: "1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Token-2022 mints aren't supported yet"),
    });
    expect(stub.state.sent).toHaveLength(0);
    reset();
  });

  it("honours the caps and a dry run, sending nothing", async () => {
    reset();
    const { call, engine } = setup();
    expect(await call("transfer", { chain: "solana-devnet", token: "SOL", to: recipient, amount: "0.6" })).toEqual({
      ok: false,
      error: "per-call cap: 0.6 SOL is more than the 0.5 SOL allowed in one call",
    });
    const dry = await call("transfer", { chain: "solana-devnet", token: "SOL", to: recipient, amount: "0.1", dryRun: true });
    expect(dry).toMatchObject({ ok: true, value: { dryRun: true, wouldSucceed: true, simulation: { ok: true } } });
    expect(stub.state.sent).toHaveLength(0);
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("stops on a failed simulation and releases the spend", async () => {
    reset();
    stub.state.simulate = () => ({ err: { InstructionError: [0, { Custom: 1 }] }, logs: ["Program log: insufficient funds"] });
    const { call, engine } = setup();
    const r = await call("transfer", { chain: "solana-devnet", token: "SOL", to: recipient, amount: "0.1" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/simulation_failed.*InstructionError.*insufficient funds/) });
    expect(stub.state.sent).toHaveLength(0);
    expect(await engine.spendStore.list()).toEqual([]);
    reset();
  });

  it("releases the spend when the transaction fails onchain, or never confirms", async () => {
    reset();
    stub.state.status = () => ({ err: { InstructionError: [0, "Custom"] } });
    const failed = setup();
    expect(await failed.call("transfer", { chain: "solana-devnet", token: "SOL", to: recipient, amount: "0.1" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("failed onchain"),
    });
    expect(await failed.engine.spendStore.list()).toEqual([]);

    stub.state.status = () => null; // never lands
    const stuck = setup();
    expect(await stuck.call("transfer", { chain: "solana-devnet", token: "SOL", to: recipient, amount: "0.1" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not confirmed within 2s.*may still land/),
    });
    reset();
  });
});

/** A transaction shaped like an aggregator's: v0, unsigned, calling the given programs. */
async function aggregatorTx(feePayer: Address, programs: string[]) {
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" as never, lastValidBlockHeight: 1000n },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions(
        programs.map((p) => ({ programAddress: address(p), accounts: [], data: new Uint8Array([1, 2, 3]) })),
        m,
      ),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(msg)));
}

const toyJupiter = (build: () => Promise<Uint8Array>, over: Partial<{ expected: bigint; min: bigint }> = {}): SolanaSwapProvider => ({
  name: "toy-jupiter",
  supports: () => true,
  quote: async ({ slippageBps }) => {
    const expected = over.expected ?? usdc("7");
    return { expected, min: over.min ?? (expected * BigInt(10_000 - slippageBps)) / 10_000n, program: JUPITER_PROGRAM, build };
  },
});

describe("solana swaps", () => {
  const swapArgs = { chain: "solana-devnet", from: "SOL", to: "USDC", amount: "0.1" };
  /** Accounts watched for a SOL → USDC swap: the agent, then its USDC token account. */
  const world = (o: { solAfter: bigint; usdcBefore?: bigint; usdcAfter: bigint }) => {
    const solBefore = 5_000_000_000n;
    stub.state.multipleAccounts = [
      [account(solBefore), account(1_000_000, tokenAccountData(o.usdcBefore ?? 0n))], // simulate: before
      [account(1_000_000, tokenAccountData(o.usdcBefore ?? 0n))], // send: before
      [account(1_000_000, tokenAccountData(o.usdcAfter))], // send: after
    ];
    stub.state.simulate = () => ({ accounts: [account(o.solAfter), account(1_000_000, tokenAccountData(o.usdcAfter))] });
  };

  it("signs an aggregator transaction that passes the checks, sends it, and reports what arrived", async () => {
    reset();
    world({ solAfter: 5_000_000_000n - sol("0.1") - 5_000n, usdcAfter: usdc("6.97") });
    const { call, engine } = setup({ swap: [toyJupiter(async () => aggregatorTx(agent.address, [JUPITER_PROGRAM, SYSTEM]))] });
    const r = await call("swap", swapArgs);
    expect(r).toMatchObject({
      ok: true,
      value: { status: "sent", provider: "toy-jupiter", program: JUPITER_PROGRAM, received: { token: "USDC", amount: "6.97" } },
    });
    const tx = decodeSent(stub.state.sent[0]!);
    expect(tx).toMatchObject({ feePayer: agent.address, signedByAgent: true });
    expect((await engine.spendStore.list())[0]).toMatchObject({ status: "committed", amount: sol("0.1") });
  });

  it("previews a swap in a dry run without signing anything", async () => {
    reset();
    world({ solAfter: 5_000_000_000n - sol("0.1"), usdcAfter: usdc("6.97") });
    const { call } = setup({ swap: [toyJupiter(async () => aggregatorTx(agent.address, [JUPITER_PROGRAM]))] });
    expect(await call("swap", { ...swapArgs, dryRun: true })).toMatchObject({
      ok: true,
      value: { dryRun: true, wouldSucceed: true, quote: { provider: "toy-jupiter", buy: { token: "USDC" } } },
    });
    expect(stub.state.sent).toHaveLength(0);
  });

  it("refuses a transaction that would take more SOL than the swap's input", async () => {
    reset();
    world({ solAfter: 5_000_000_000n - sol("0.1") - sol("1"), usdcAfter: usdc("6.97") }); // an extra 1 SOL drained
    const { call, engine } = setup({ swap: [toyJupiter(async () => aggregatorTx(agent.address, [JUPITER_PROGRAM]))] });
    expect(await call("swap", swapArgs)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/simulation_failed.*balance check failed: it would take 1\.1 SOL for a 0\.1 SOL swap/),
    });
    expect(stub.state.sent).toHaveLength(0);
    expect(await engine.spendStore.list()).toEqual([]);
  });

  it("refuses a transaction that would return less than the guaranteed minimum", async () => {
    reset();
    world({ solAfter: 5_000_000_000n - sol("0.1"), usdcAfter: usdc("5") }); // min is 6.965
    const { call } = setup({ swap: [toyJupiter(async () => aggregatorTx(agent.address, [JUPITER_PROGRAM]))] });
    expect(await call("swap", swapArgs)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/less USDC than the guaranteed minimum 6\.965/),
    });
    expect(stub.state.sent).toHaveLength(0);
  });

  it("refuses a transaction whose fee payer isn't the agent", async () => {
    reset();
    world({ solAfter: 5_000_000_000n - sol("0.1"), usdcAfter: usdc("6.97") });
    const other = (await generateKeyPairSigner()).address;
    const { call } = setup({ swap: [toyJupiter(async () => aggregatorTx(other, [JUPITER_PROGRAM]))] });
    expect(await call("swap", swapArgs)).toMatchObject({ ok: false, error: expect.stringContaining("fee payer is not the agent") });
    expect(stub.state.sent).toHaveLength(0);
  });

  it("refuses a transaction that calls a program outside the allowlist, unless the operator adds it", async () => {
    reset();
    const unknown = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    world({ solAfter: 5_000_000_000n - sol("0.1"), usdcAfter: usdc("6.97") });
    const build = async () => aggregatorTx(agent.address, [JUPITER_PROGRAM, unknown]);
    expect(await setup({ swap: [toyJupiter(build)] }).call("swap", swapArgs)).toMatchObject({
      ok: false,
      error: expect.stringContaining(`calls ${unknown}, which is not an allowed program`),
    });
    reset();
    world({ solAfter: 5_000_000_000n - sol("0.1"), usdcAfter: usdc("6.97") });
    expect(await setup({ swap: [toyJupiter(build)], swapAllowedPrograms: [unknown] }).call("swap", swapArgs)).toMatchObject({
      ok: true,
      value: { status: "sent" },
    });
  });

  it("sells a token for SOL by checking the token and SOL balances the other way round", async () => {
    reset();
    const solBefore = 5_000_000_000n;
    stub.state.multipleAccounts = [
      [account(solBefore), account(1_000_000, tokenAccountData(usdc("20")))],
      [account(solBefore), account(1_000_000, tokenAccountData(usdc("20")))].slice(0, 1),
    ];
    // swapping 10 USDC for SOL: USDC drops by 10, SOL rises by ~0.1
    stub.state.simulate = () => ({
      accounts: [account(solBefore + sol("0.1") - 5_000n), account(1_000_000, tokenAccountData(usdc("10")))],
    });
    const provider: SolanaSwapProvider = {
      name: "toy",
      supports: () => true,
      quote: async () => ({
        expected: sol("0.1"),
        min: sol("0.099"),
        program: JUPITER_PROGRAM,
        build: async () => aggregatorTx(agent.address, [JUPITER_PROGRAM]),
      }),
    };
    const { call } = setup({ swap: [provider] });
    expect(await call("swap", { chain: "solana-devnet", from: "USDC", to: "SOL", amount: "10", dryRun: true })).toMatchObject({
      ok: true,
      value: { wouldSucceed: true },
    });
    stub.state.simulate = () => ({ accounts: [account(solBefore), account(1_000_000, tokenAccountData(usdc("10")))] }); // SOL doesn't rise
    expect(await call("swap", { chain: "solana-devnet", from: "USDC", to: "SOL", amount: "10", dryRun: true })).toMatchObject({
      ok: true,
      value: { wouldSucceed: false, simulation: { ok: false, error: expect.stringContaining("less SOL than the guaranteed minimum") } },
    });
    reset();
  });
});

describe("solanaChain configuration", () => {
  it("rejects what can't work", () => {
    const rpc = createSolanaRpc(stub.url);
    expect(() => solanaChain({ chain: "base-sepolia", rpc, signer: agent })).toThrow(/not a Solana chain/);
    expect(() => solanaChain({ chain: "solana-devnet", rpc, signer: agent, tokens: { sol: { mint: USDC_MINT, decimals: 6 } } })).toThrow(
      /clashes with the gas token/,
    );
    expect(() => solanaChain({ chain: "solana-devnet", rpc, signer: agent, tokens: { X: { mint: "not-a-mint", decimals: 6 } } })).toThrow(
      /not a Solana address/,
    );
  });
});
