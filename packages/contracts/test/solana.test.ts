import { AccountRole, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  KIT_ESCROW_PROGRAM_ID,
  claimInstruction,
  createDealInstruction,
  decodeDeal,
  decodeReputation,
  deliverInstruction,
  findAssociatedTokenAddress,
  findDealAddress,
  findReputationAddress,
  refundInstruction,
  releaseInstruction,
  solanaEscrowCreateAction,
} from "../src/solana/index.js";

const CLIENT = "FvWqH2t3cuCcAVVzTde4nhxn2KXQqXm1SjcKoTFgzMow" as Address;
const PROVIDER = "CB9gprAF1FPQarAHQGrueJuymzDXPd62yp973578wCEm" as Address;
const ARBITER = "3jEt1VX5WQ2P9sQ6C5vkqHoiyiZwQBpA9HTaoj824Nod" as Address;
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as Address; // devnet USDC

describe("solana addresses (checked against `solana find-program-derived-address`)", () => {
  it("derives the deal, reputation and associated token addresses", async () => {
    expect(await findDealAddress(CLIENT, 42n)).toBe("CB9gprAF1FPQarAHQGrueJuymzDXPd62yp973578wCEm");
    expect(await findReputationAddress(CLIENT)).toBe("3jEt1VX5WQ2P9sQ6C5vkqHoiyiZwQBpA9HTaoj824Nod");
    expect(await findAssociatedTokenAddress(CLIENT, MINT)).toBe("FLJFJemB5ULMsCqp2VYgYMSXmdM8aSsQF84J99ScjjMq");
  });
});

describe("solana instructions (layout from idl/kit_escrow.json)", () => {
  it("encodes create with Anchor's discriminator and borsh args", async () => {
    const ix = await createDealInstruction({
      client: CLIENT,
      dealId: 42n,
      provider: PROVIDER,
      arbiter: ARBITER,
      mint: MINT,
      amount: 25_000_000n,
      deadline: 1_800_000_000,
      reviewPeriod: 3600,
      termsHash: new Uint8Array(32).fill(7),
    });
    expect(ix.programAddress).toBe(KIT_ESCROW_PROGRAM_ID);
    expect(ix.deal).toBe("CB9gprAF1FPQarAHQGrueJuymzDXPd62yp973578wCEm");
    const d = ix.data!;
    expect([...d.slice(0, 8)]).toEqual([24, 30, 200, 40, 5, 28, 7, 119]);
    const dv = new DataView(d.buffer, d.byteOffset);
    expect(dv.getBigUint64(8, true)).toBe(42n);
    expect(d[48]).toBe(1); // Some(arbiter)
    expect(dv.getBigUint64(81, true)).toBe(25_000_000n);
    expect(dv.getBigInt64(89, true)).toBe(1_800_000_000n);
    expect(dv.getBigInt64(97, true)).toBe(3600n);
    expect([...d.slice(105)]).toEqual(new Array(32).fill(7));
    expect(d.length).toBe(8 + 8 + 32 + 33 + 8 + 8 + 8 + 32);

    const roles = ix.accounts!.map((a) => a.role);
    expect(roles).toEqual([
      AccountRole.WRITABLE_SIGNER, // client
      AccountRole.WRITABLE, // deal
      AccountRole.READONLY, // mint
      AccountRole.WRITABLE, // client token
      AccountRole.WRITABLE, // vault
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
    ]);
    expect(ix.accounts![3]!.address).toBe("FLJFJemB5ULMsCqp2VYgYMSXmdM8aSsQF84J99ScjjMq");
    expect(ix.accounts![4]!.address).toBe(await findAssociatedTokenAddress(ix.deal, MINT));
  });

  it("encodes None as a single zero byte and rejects oversized hashes", async () => {
    const ix = await createDealInstruction({ client: CLIENT, dealId: 1n, provider: PROVIDER, mint: MINT, amount: 1n, deadline: new Date(1_800_000_000_000) });
    expect(ix.data![48]).toBe(0);
    expect(ix.data!.length).toBe(8 + 8 + 32 + 1 + 8 + 8 + 8 + 32);
    await expect(createDealInstruction({ client: CLIENT, dealId: 1n, provider: PROVIDER, mint: MINT, amount: 1n, deadline: 1, termsHash: new Uint8Array(33) })).rejects.toThrow(/32 bytes/);
  });

  it("orders settlement accounts like the Anchor structs", async () => {
    const deal = { address: await findDealAddress(CLIENT, 1n), client: CLIENT, provider: PROVIDER, mint: MINT };
    const rel = await releaseInstruction({ signer: CLIENT, deal });
    const cl = await claimInstruction({ signer: PROVIDER, deal });
    const rf = await refundInstruction({ signer: PROVIDER, deal });
    expect([...rel.data!]).toEqual([253, 249, 15, 206, 28, 127, 193, 241]);
    expect([...cl.data!]).toEqual([62, 198, 214, 193, 213, 159, 108, 210]);
    expect(rel.accounts!.length).toBe(11);
    expect(rel.accounts![4]!.address).toBe(PROVIDER);
    expect(rel.accounts![5]!.address).toBe(await findAssociatedTokenAddress(PROVIDER, MINT));
    expect(rel.accounts![7]!.address).toBe(await findReputationAddress(PROVIDER));
    expect(rf.accounts!.length).toBe(10);
    expect(rf.accounts![5]!.address).toBe(await findAssociatedTokenAddress(CLIENT, MINT));
    const dl = deliverInstruction({ provider: PROVIDER, deal: deal.address, deliveryHash: "ipfs://x" });
    expect(dl.accounts!.map((a) => a.role)).toEqual([AccountRole.READONLY_SIGNER, AccountRole.WRITABLE]);
  });
});

describe("solana account decoding", () => {
  const pk = (seed: number) => new Uint8Array(32).fill(seed);
  const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
  const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

  it("decodes a Deal with and without an arbiter", () => {
    const disc = new Uint8Array([125, 223, 160, 234, 71, 162, 182, 219]);
    const tail = cat(pk(4), u64(7n), u64(25n), u64(100n), u64(60n), u64(0n), new Uint8Array([1]), pk(8), pk(9), new Uint8Array([254]));
    const withArb = decodeDeal(cat(disc, pk(1), pk(2), new Uint8Array([1]), pk(3), tail));
    expect(withArb).toMatchObject({ dealId: 7n, amount: 25n, deadline: 100n, reviewPeriod: 60n, status: "Delivered", bump: 254 });
    expect(withArb.arbiter).not.toBeNull();
    const noArb = decodeDeal(cat(disc, pk(1), pk(2), new Uint8Array([0]), tail));
    expect(noArb.arbiter).toBeNull();
    expect(noArb.mint).toBe(withArb.mint);
    expect(() => decodeDeal(cat(new Uint8Array(8), pk(1)))).toThrow(/not a kit_escrow Deal/);
  });

  it("decodes a Reputation and computes the score", () => {
    const disc = new Uint8Array([55, 148, 90, 71, 68, 183, 193, 28]);
    const r = decodeReputation(cat(disc, pk(5), u64(3n), u64(1n), u64(0n), u64(30n), u64(0n), new Uint8Array([255])));
    expect(r).toMatchObject({ completed: 3n, refunded: 1n, disputed: 0n, volume: 30n, score: 7500 });
  });
});

it("builds a policy action for funding", () => {
  expect(solanaEscrowCreateAction({ mint: MINT, provider: PROVIDER, amount: 5n })).toEqual({
    chain: "solana:devnet",
    kind: "escrow_fund",
    to: PROVIDER,
    program: KIT_ESCROW_PROGRAM_ID,
    method: "create",
    spends: [{ asset: MINT, amount: 5n }],
  });
});
