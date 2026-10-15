/**
 * codkit end-to-end on an EVM testnet, against the deployed contracts.
 *
 *   AGENT_PRIVATE_KEY=0x… pnpm --filter testnet-e2e evm -- --network base-sepolia [--walrus] [--skip-x402]
 *
 * The AGENT wallet plays the AI agent / client. It needs ~0.002 ETH for gas and ~0.15 USDC
 * (https://faucet.circle.com). A PROVIDER wallet is generated per run (or PROVIDER_PRIVATE_KEY),
 * gets a little gas, and returns all USDC to the agent at the end.
 *
 * Steps: preflight → fund provider (guarded) → escrow create/fund/deliver/release (guarded)
 * → reputation check → guardrails on a real chain (over-cap, non-allow-listed, simulated revert)
 * → x402 payment via the public facilitator → receipts anchored onchain (+ Walrus) and verified
 * → provider refunds the agent. Writes reports/<network>-<time>.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { deployments, dealIdFromLogs, escrowAbi, escrowTxs, hashText, readDeal, readReputation } from "@codkit/contracts";
import { createBudgetedFetch, registerExactEvmScheme, x402Client } from "@codkit/pay";
import { paywall } from "@codkit/pay/hono";
import { createPolicyEngine, fromAtomic, isPolicyError, usdc } from "@codkit/policy";
import { createEvmGuard, evmExplorerTxUrl } from "@codkit/policy/evm";
import { ed25519Signer, parseJsonl, ReceiptLog, recordPolicyEvents, verifyLog } from "@codkit/receipts";
import { evmAnchorer, readEvmAnchors } from "@codkit/receipts/evm";
import { readWalrusUri, walrusUploader } from "@codkit/receipts/walrus";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseEther, type Address, type Chain, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { arg, flag, Report } from "./report.js";


/** The JSON the deploy script just wrote (no rebuild of @codkit/contracts needed), else the built registry. */
const recorded = (name: string): unknown => {
  const file = new URL(`../../../packages/contracts/deployments/${name}.json`, import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
};
const NETWORKS: Record<string, { chain: Chain; rpc: string; usdc?: Address; x402: boolean }> = {
  "base-sepolia": { chain: baseSepolia, rpc: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", x402: true },
  local: { chain: foundry, rpc: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545", x402: false },
};

const network = arg("network") ?? "base-sepolia";
const net = NETWORKS[network];
if (!net) throw new Error(`unknown network ${network}`);
const agentKey = (process.env.AGENT_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY) as Hex | undefined;
if (!agentKey) throw new Error("set AGENT_PRIVATE_KEY (a funded testnet-only key)");

type Dep = { contracts: Record<"Escrow" | "Reputation" | "ReceiptAnchor", { address: Address }> };
const dep: Dep = arg("deployments")
  ? JSON.parse(readFileSync(arg("deployments")!, "utf8"))
  : ((recorded(network) ?? (deployments as Record<string, unknown>)[network]) as Dep | undefined) ??
    (() => {
      throw new Error(`no deployment recorded for ${network} — run the deploy script first`);
    })();
const USDC = (arg("usdc") as Address | undefined) ?? net.usdc;
if (!USDC) throw new Error("pass --usdc <token address> on this network");
const ESCROW = dep.contracts.Escrow.address;
const REPUTATION = dep.contracts.Reputation.address;
const ANCHOR = dep.contracts.ReceiptAnchor.address;
const chainId = net.chain.id;
const link = (h: Hex | string) => evmExplorerTxUrl(chainId, h as Hex);

const transport = http(net.rpc);
const pc = createPublicClient({ chain: net.chain, transport, pollingInterval: chainId === 31337 ? 50 : 1500 });
const agent = privateKeyToAccount(agentKey);
const agentWallet = createWalletClient({ account: agent, chain: net.chain, transport });
const providerKey = (process.env.PROVIDER_PRIVATE_KEY as Hex | undefined) ?? generatePrivateKey();
const provider = privateKeyToAccount(providerKey);
const providerWallet = createWalletClient({ account: provider, chain: net.chain, transport });
const wait = async (hash: Hex) => {
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
};
const usdcBalance = (who: Address) => pc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });

const report = new Report(network, { agent: agent.address, provider: provider.address, escrow: ESCROW, reputation: REPUTATION, anchor: ANCHOR, usdc: USDC });

// The agent's guardrails — every agent tx below goes through these.
const engine = createPolicyEngine({
  policy: {
    chains: [`eip155:${chainId}`],
    allow: { programs: [USDC, ESCROW, ANCHOR] },
    limits: [
      { asset: USDC, label: "USDC", decimals: 6, perTx: usdc("0.50"), perPeriod: { amount: usdc("1"), seconds: 86_400 } },
      { asset: "native", label: "ETH", decimals: 18, perTx: parseEther("0.001"), perPeriod: { amount: parseEther("0.003"), seconds: 86_400 } },
    ],
  },
});
const receipts = new ReceiptLog({ signer: ed25519Signer() });
recordPolicyEvents(engine, receipts);
const guard = createEvmGuard({ engine, chainId, account: agent.address, reader: pc, sender: agentWallet, abis: [escrowAbi] });
const tx = escrowTxs(ESCROW);
const AMOUNT = usdc("0.10");

try {
  await report.step(
    "preflight balances",
    async () => {
      const [eth, bal] = await Promise.all([pc.getBalance({ address: agent.address }), usdcBalance(agent.address)]);
      if (eth < parseEther("0.0008")) throw new Error(`agent has ${fromAtomic(eth, 18)} ETH; need ≥ 0.0008 for gas`);
      if (bal < usdc("0.12")) throw new Error(`agent has ${fromAtomic(bal, 6)} USDC; need ≥ 0.12 (https://faucet.circle.com)`);
      return { detail: `${fromAtomic(eth, 18)} ETH, ${fromAtomic(bal, 6)} USDC` };
    },
    { critical: true },
  );

  await report.step(
    "fund provider gas (guarded native transfer)",
    async () => {
      const { result } = await guard.send({ to: provider.address, value: parseEther("0.0003") });
      await wait(result);
      return { detail: "0.0003 ETH", links: [link(result)] };
    },
    { critical: true },
  );

  const before = await usdcBalance(provider.address);
  const dealId = await report.step(
    "escrow: approve + createAndFund 0.10 USDC (guarded)",
    async () => {
      const a = await guard.send(tx.approve(USDC, AMOUNT));
      await wait(a.result);
      const c = await guard.send(
        tx.createAndFund({ provider: provider.address, token: USDC, amount: AMOUNT, deadline: new Date(Date.now() + 3_600_000), termsHash: hashText("codkit e2e: deliver a hash") }),
      );
      const r = await wait(c.result);
      const id = dealIdFromLogs(r.logs);
      if (id === undefined) throw new Error("no DealCreated event");
      return { value: id, detail: `deal #${id}`, links: [link(a.result), link(c.result)] };
    },
    { critical: true },
  );

  await report.step("escrow: provider delivers", async () => {
    const h = await providerWallet.sendTransaction(tx.deliver(dealId!, hashText("ipfs://codkit-e2e-result")));
    await wait(h);
    const d = await readDeal(pc, ESCROW, dealId!);
    if (d.status !== "Delivered") throw new Error(`status ${d.status}`);
    return { links: [link(h)] };
  });

  await report.step("escrow: agent releases (guarded)", async () => {
    const r = await guard.send(tx.release(dealId!));
    await wait(r.result);
    const d = await readDeal(pc, ESCROW, dealId!);
    const gained = (await usdcBalance(provider.address)) - before;
    if (d.status !== "Released" || gained !== AMOUNT) throw new Error(`status ${d.status}, provider +${gained}`);
    return { detail: "provider received 0.10 USDC", links: [link(r.result)] };
  });

  await report.step("reputation recorded", async () => {
    const rep = await readReputation(pc, REPUTATION, provider.address);
    if (rep.completed < 1) throw new Error(JSON.stringify(rep));
    return { detail: `completed ${rep.completed}, score ${rep.score}` };
  });

  await report.step("guardrail: over-cap approval is refused before signing", async () => {
    const err = await guard.send(tx.approve(USDC, usdc("5"))).then(() => null, (e: unknown) => e);
    if (!isPolicyError(err) || err.code !== "denied") throw new Error(`expected denial, got ${String(err)}`);
    return { detail: err.message };
  });

  await report.step("guardrail: non-allow-listed contract is refused", async () => {
    const err = await guard.send(escrowTxs(REPUTATION).release(1n)).then(() => null, (e: unknown) => e);
    if (!isPolicyError(err) || err.code !== "denied") throw new Error(`expected denial, got ${String(err)}`);
    return { detail: err.message };
  });

  await report.step("guardrail: simulation catches a revert (release twice)", async () => {
    const err = await guard.send(tx.release(dealId!)).then(() => null, (e: unknown) => e);
    if (!isPolicyError(err) || err.code !== "simulation_failed") throw new Error(`expected simulation_failed, got ${String(err)}`);
    return { detail: err.message.slice(0, 120) };
  });

  if (net.x402 && !flag("skip-x402")) {
    await report.step("x402: pay $0.001 via the public facilitator (budgeted)", async () => {
      const app = new Hono();
      app.use(paywall({ payTo: provider.address, network: `eip155:${chainId}`, routes: { "GET /data": "$0.001" } }));
      app.get("/data", (c) => c.json({ ok: true }));
      const server = serve({ fetch: app.fetch, port: 0 });
      await new Promise((r) => server.once("listening", r));
      const port = (server.address() as { port: number }).port;
      try {
        const client = new x402Client();
        registerExactEvmScheme(client, { signer: agent });
        let settledTx = "";
        const fetchPaid = createBudgetedFetch({
          engine,
          client,
          onPayment: (o) => {
            if (o.status === "settled") settledTx = o.transaction;
          },
        });
        const res = await fetchPaid(`http://127.0.0.1:${port}/data`);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        if (!settledTx) throw new Error("no settlement reported");
        return { detail: "settled onchain", links: [link(settledTx)] };
      } finally {
        server.close();
      }
    });
  }

  await report.step("receipts: anchor head on ReceiptAnchor" + (flag("walrus") ? " + upload to Walrus" : ""), async () => {
    const pub = await receipts.publish({
      anchorer: evmAnchorer({ chainId, wallet: agentWallet, contract: ANCHOR, waitFor: pc }),
      ...(flag("walrus") && { uploader: walrusUploader() }),
    });
    const latest = await pc.getBlockNumber();
    const anchors = await readEvmAnchors(pc, { contract: ANCHOR, logger: agent.address, fromBlock: latest > 50n ? latest - 50n : 0n });
    const found = anchors.find((a) => a.head === pub.checkpoint.head);
    if (!found) throw new Error("anchor event not found");
    const log = pub.upload ? parseJsonl(await readWalrusUri(pub.upload.uri)) : await receipts.list();
    const v = await verifyLog(log, { anchor: found });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return { detail: `${pub.checkpoint.count} receipts verified against the onchain head`, links: [link(found.tx), pub.upload?.url] };
  });
} catch {
  // critical step failed; fall through to cleanup + report
} finally {
  await report.step("cleanup: provider returns USDC to agent", async () => {
    const bal = await usdcBalance(provider.address);
    if (bal === 0n) return { detail: "nothing to return" };
    const h = await providerWallet.sendTransaction({
      to: USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [agent.address, bal] }),
    });
    await wait(h);
    return { detail: `${fromAtomic(bal, 6)} USDC`, links: [link(h)] };
  });
  const file = report.save();
  console.log(`\n${report.ok ? "PASS" : "FAIL"} — report: ${file}`);
  process.exitCode = report.ok ? 0 : 1;
}
