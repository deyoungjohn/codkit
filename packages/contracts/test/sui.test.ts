import { createPolicyEngine } from "@codkit/policy";
import { describe, expect, it } from "vitest";
import { suiEscrow, suiEscrowCreateAction, Transaction } from "../src/sui/index.js";

const ids = {
  packageId: "0x00000000000000000000000000000000000000000000000000000000000000aa",
  reputationId: "0x00000000000000000000000000000000000000000000000000000000000000bb",
};
const SUI = "0x2::sui::SUI";
const PROVIDER = "0x00000000000000000000000000000000000000000000000000000000000000b0";
const ESCROW = "0x00000000000000000000000000000000000000000000000000000000000000ee";

function calls(tx: Transaction) {
  return tx.getData().commands.map((c) => c.MoveCall!);
}

describe("suiEscrow transaction builders", () => {
  const escrow = suiEscrow(ids);

  it("builds create with split coin, option arbiter and the clock", () => {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [1_000_000]);
    escrow.create(tx, { coinType: SUI, payment: coin!, provider: PROVIDER, deadline: 1_900_000_000_000, terms: "spec" });
    const data = tx.getData();
    const call = data.commands[1]!.MoveCall!;
    expect(call).toMatchObject({ package: ids.packageId, module: "escrow", function: "create", typeArguments: [SUI] });
    expect(call.arguments).toHaveLength(7);
    // last input is the shared Clock object 0x6
    const clockInput = data.inputs.at(-1);
    expect(JSON.stringify(clockInput)).toContain("0x0000000000000000000000000000000000000000000000000000000000000006");
  });

  it("passes the reputation object to settling calls", () => {
    const tx = new Transaction();
    escrow.deliver(tx, { coinType: SUI, escrowId: ESCROW, delivery: "ipfs://x" });
    escrow.release(tx, { coinType: SUI, escrowId: ESCROW });
    escrow.claim(tx, { coinType: SUI, escrowId: ESCROW });
    escrow.refund(tx, { coinType: SUI, escrowId: ESCROW });
    escrow.dispute(tx, { coinType: SUI, escrowId: ESCROW });
    expect(calls(tx).map((c) => [c.function, c.arguments.length])).toEqual([
      ["deliver", 3],
      ["release", 2],
      ["claim", 3],
      ["refund", 3],
      ["dispute", 3],
    ]);
    expect(JSON.stringify(tx.getData().inputs)).toContain(ids.reputationId);
  });

  it("exposes event types", () => {
    expect(escrow.eventType("DealCreated")).toBe(`${ids.packageId}::escrow::DealCreated`);
  });
});

describe("suiEscrowCreateAction", () => {
  it("lets the policy engine gate Sui escrow funding", async () => {
    const engine = createPolicyEngine({
      policy: { chains: ["sui:testnet"], limits: [{ asset: SUI, perTx: 5_000_000_000n }], requireSimulation: false },
    });
    const ok = suiEscrowCreateAction(ids, { coinType: SUI, provider: PROVIDER, amount: 1_000_000_000n });
    const big = suiEscrowCreateAction(ids, { coinType: SUI, provider: PROVIDER, amount: 9_000_000_000n });
    expect((await engine.evaluate(ok)).verdict).toBe("allow");
    expect((await engine.evaluate(big)).verdict).toBe("deny");
    expect((await engine.evaluate({ ...ok, chain: "sui:mainnet" })).verdict).toBe("deny");
  });
});
