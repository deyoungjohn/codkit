/**
 * Full escrow lifecycle on a throwaway local chain (needs Foundry's `anvil`):
 * an AI-agent client pays a provider through escrow, with every client tx
 * guarded by policy + simulation.
 *
 *   pnpm --filter @codkit/contracts example
 */
import { createPolicyEngine, fromAtomic, usdc } from "@codkit/policy";
import { createEvmGuard } from "@codkit/policy/evm";
import { dealIdFromLogs, deployData, escrowAbi, escrowTxs, hashText, readDeal, readReputation } from "../src/index.js";
import { artifact, deployed, KEYS, startAnvil, wallet } from "../test/anvil.js";

const { url, stop, publicClient: pc } = await startAnvil();
try {
  const [deployer, client, provider] = [wallet(url, KEYS.deployer), wallet(url, KEYS.client), wallet(url, KEYS.provider)];
  const wait = (hash: `0x${string}`) => pc.waitForTransactionReceipt({ hash });

  const reputation = await deployed(pc, await deployer.sendTransaction({ data: deployData.reputation(deployer.account.address) }));
  const escrow = await deployed(pc, await deployer.sendTransaction({ data: deployData.escrow(reputation) }));
  await wait(await deployer.sendTransaction(deployData.setWriter(reputation, escrow)));
  const mock = artifact("Mocks.sol", "MockERC20");
  const token = await deployed(pc, await deployer.deployContract({ abi: mock.abi, bytecode: mock.bytecode }));
  await wait(await deployer.writeContract({ address: token, abi: mock.abi, functionName: "mint", args: [client.account.address, usdc(100)] }));
  console.log(`deployed  escrow ${escrow}  reputation ${reputation}  token ${token}`);

  const engine = createPolicyEngine({
    policy: { allow: { programs: [token, escrow] }, limits: [{ asset: token, label: "USD", perTx: usdc(50) }] },
    onEvent: (e) => {
      if (e.type === "decision") console.log(`  policy ${e.decision.action.method ?? e.decision.action.kind}: ${e.decision.verdict} ${e.decision.reasons.join("; ")}`);
    },
  });
  const agent = createEvmGuard({ engine, chainId: 31337, account: client.account.address, reader: pc, sender: client, abis: [escrowAbi] });
  const tx = escrowTxs(escrow);

  console.log("\n1. agent approves + funds a 20 USD deal");
  await wait((await agent.send(tx.approve(token, usdc(20)))).result);
  const r = await wait(
    (await agent.send(tx.createAndFund({ provider: provider.account.address, token, amount: usdc(20), deadline: new Date(Date.now() + 86_400_000), termsHash: hashText("summarise 10 papers") }))).result,
  );
  const id = dealIdFromLogs(r.logs)!;
  console.log(`  deal #${id}: ${(await readDeal(pc, escrow, id)).status}`);

  console.log("\n2. provider delivers");
  await wait(await provider.sendTransaction(tx.deliver(id, hashText("ipfs://summary"))));
  console.log(`  deal #${id}: ${(await readDeal(pc, escrow, id)).status}`);

  console.log("\n3. agent releases payment");
  await wait((await agent.send(tx.release(id))).result);
  const rep = await readReputation(pc, reputation, provider.account.address);
  console.log(`  deal #${id}: ${(await readDeal(pc, escrow, id)).status}; provider reputation ${rep.completed} completed, ${fromAtomic(rep.volume, 6)} USD volume`);

  console.log("\n4. agent tries to approve 80 USD (over its 50 USD per-tx cap)");
  await agent.send(tx.approve(token, usdc(80))).catch((e: Error) => console.log(`  blocked: ${e.message}`));
} finally {
  stop();
}
