import { createPolicyEngine, usdc } from "@iamyoungjohn-kit/policy";
import { createEvmGuard, type EvmGuard } from "@iamyoungjohn-kit/policy/evm";
import type { Address, PublicClient } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dealIdFromLogs,
  deployData,
  escrowAbi,
  escrowTxs,
  hashText,
  readDeal,
  readReputation,
} from "../src/index.js";
import { artifact, deployed, KEYS, startAnvil, wallet } from "./anvil.js";

let stop: () => void;
let pc: PublicClient;
let url: string;
let escrow: Address;
let reputation: Address;
let token: Address;
let guard: EvmGuard;
let engine: ReturnType<typeof createPolicyEngine>;
const w = {} as Record<keyof typeof KEYS, ReturnType<typeof wallet>>;

beforeAll(async () => {
  ({ url, stop, publicClient: pc } = await startAnvil());
  for (const k of Object.keys(KEYS) as (keyof typeof KEYS)[]) w[k] = wallet(url, KEYS[k]);
  const deployer = w.deployer;

  reputation = await deployed(pc, await deployer.sendTransaction({ data: deployData.reputation(deployer.account.address) }));
  escrow = await deployed(pc, await deployer.sendTransaction({ data: deployData.escrow(reputation) }));
  await pc.waitForTransactionReceipt({ hash: await deployer.sendTransaction(deployData.setWriter(reputation, escrow)) });

  const mock = artifact("Mocks.sol", "MockERC20");
  token = await deployed(pc, await deployer.deployContract({ abi: mock.abi, bytecode: mock.bytecode }));
  await pc.waitForTransactionReceipt({
    hash: await deployer.writeContract({ address: token, abi: mock.abi, functionName: "mint", args: [w.client.account.address, usdc(1000)] }),
  });

  // The client is an AI agent: every tx it sends goes through policy + simulation.
  engine = createPolicyEngine({
    policy: {
      allow: { programs: [token, escrow] },
      limits: [{ asset: token, label: "mUSD", perTx: usdc(50), perPeriod: { amount: usdc(100), seconds: 86_400 } }],
    },
  });
  guard = createEvmGuard({ engine, chainId: 31337, account: w.client.account.address, reader: pc, sender: w.client, abis: [escrowAbi] });
}, 30_000);

afterAll(() => stop?.());

const balanceOf = (who: Address) =>
  pc.readContract({ address: token, abi: artifact("Mocks.sol", "MockERC20").abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;

describe("escrow on anvil, driven by a policy-guarded agent", () => {
  it("runs create → fund → deliver → release and updates reputation", async () => {
    const tx = escrowTxs(escrow);
    const provider = w.provider.account.address;

    const approve = await guard.send(tx.approve(token, usdc(25)));
    await pc.waitForTransactionReceipt({ hash: approve.result });

    const deadline = new Date(Date.now() + 3 * 86_400_000);
    const created = await guard.send(
      tx.createAndFund({ provider, token, amount: usdc(25), deadline, arbiter: w.arbiter.account.address, termsHash: hashText("market report") }),
    );
    expect(guard.toAction(tx.createAndFund({ provider, token, amount: 1n, deadline })).method).toBe("createAndFund");
    const id = dealIdFromLogs((await pc.waitForTransactionReceipt({ hash: created.result })).logs)!;
    expect(id).toBe(1n);
    expect((await readDeal(pc, escrow, id)).status).toBe("Funded");

    await pc.waitForTransactionReceipt({ hash: await w.provider.sendTransaction(tx.deliver(id, hashText("ipfs://report"))) });
    const delivered = await readDeal(pc, escrow, id);
    expect(delivered).toMatchObject({ status: "Delivered", deliveryHash: hashText("ipfs://report"), amount: usdc(25) });
    expect(delivered.deliveredAt).toBeInstanceOf(Date);

    await pc.waitForTransactionReceipt({ hash: (await guard.send(tx.release(id))).result });
    expect((await readDeal(pc, escrow, id)).status).toBe("Released");
    expect(await balanceOf(provider)).toBe(usdc(25));
    expect(await readReputation(pc, reputation, provider)).toEqual({ completed: 1, refunded: 0, disputed: 0, volume: usdc(25), score: 1 });
  });

  it("blocks an over-cap approval before it reaches the chain", async () => {
    await expect(guard.send(escrowTxs(escrow).approve(token, usdc(500)))).rejects.toMatchObject({ code: "denied" });
  });

  it("blocks calls to contracts outside the allow list", async () => {
    const rogue = escrowTxs("0x000000000000000000000000000000000000dEaD");
    await expect(guard.send(rogue.release(1n))).rejects.toMatchObject({ code: "denied" });
  });

  it("catches a reverting call in simulation (release twice)", async () => {
    await expect(guard.send(escrowTxs(escrow).release(1n))).rejects.toMatchObject({ code: "simulation_failed" });
  });
});
