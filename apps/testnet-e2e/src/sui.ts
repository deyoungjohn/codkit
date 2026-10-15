/**
 * codkit end-to-end on Sui, against the published Move package.
 *
 *   pnpm --filter testnet-e2e sui -- --network testnet
 *
 * Signer: SUI_PRIVATE_KEY (`suiprivkey…`, from `sui keytool export --key-identity <addr>`), or the
 * active address in your Sui CLI config (`--client-config`, default ~/.sui/sui_config/client.yaml).
 * Needs ~0.2 SUI (`sui client faucet`). A provider keypair is generated per run, gets a little gas,
 * and sends everything back at the end.
 *
 * Steps: preflight → policy check of the escrow funding → fund provider gas → escrow create →
 * deliver → release → receipts anchored via kit_escrow::anchor and verified → provider refunds.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deployments } from "@codkit/contracts";
import { suiEscrow, suiEscrowCreateAction } from "@codkit/contracts/sui";
import { createPolicyEngine, fromAtomic } from "@codkit/policy";
import { ed25519Signer, ReceiptLog, recordPolicyEvents, verifyLog } from "@codkit/receipts";
import { suiAnchorer } from "@codkit/receipts/sui";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { arg, Report } from "./report.js";

const SUI = "0x2::sui::SUI";
const MIST = 1_000_000_000n;
const network = arg("network") ?? "testnet";
const URLS: Record<string, string> = {
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
  localnet: "http://127.0.0.1:9000",
};
const explorer = (digest: string) => (["testnet", "devnet"].includes(network) ? `https://suiscan.xyz/${network}/tx/${digest}` : undefined);

type Dep = { packageId: string; reputationId: string };
const dep: Dep = arg("deployments")
  ? JSON.parse(readFileSync(arg("deployments")!, "utf8"))
  : ((deployments as Record<string, unknown>)[`sui-${network}`] as Dep | undefined) ??
    (() => {
      throw new Error(`no Sui deployment recorded for ${network} — run deploy-sui first`);
    })();

/** Signer from SUI_PRIVATE_KEY or the Sui CLI keystore's active address (ed25519 only). */
function loadSigner(): Ed25519Keypair {
  if (process.env.SUI_PRIVATE_KEY) return Ed25519Keypair.fromSecretKey(process.env.SUI_PRIVATE_KEY);
  const cfgPath = arg("client-config") ?? join(homedir(), ".sui", "sui_config", "client.yaml");
  if (!existsSync(cfgPath)) throw new Error("set SUI_PRIVATE_KEY or install the Sui CLI");
  const cfg = readFileSync(cfgPath, "utf8");
  const keystore = /File:\s*"?([^"\n]+)"?/.exec(cfg)?.[1]?.trim();
  const active = /active_address:\s*"?(0x[0-9a-f]+)"?/.exec(cfg)?.[1];
  if (!keystore || !active) throw new Error(`could not read keystore/active_address from ${cfgPath}`);
  for (const k of JSON.parse(readFileSync(keystore, "utf8")) as string[]) {
    const bytes = Buffer.from(k, "base64");
    if (bytes[0] !== 0) continue; // 0 = ed25519
    const kp = Ed25519Keypair.fromSecretKey(bytes.subarray(1));
    if (kp.toSuiAddress() === active) return kp;
  }
  throw new Error(`active address ${active} has no ed25519 key in ${keystore} — use SUI_PRIVATE_KEY`);
}

const client = new SuiGrpcClient({ network: network as "testnet", baseUrl: URLS[network] ?? network });
const agent = loadSigner();
const provider = Ed25519Keypair.generate();
const escrow = suiEscrow(dep);
const report = new Report(`sui-${network}`, { agent: agent.toSuiAddress(), provider: provider.toSuiAddress(), packageId: dep.packageId });

async function exec(signer: Ed25519Keypair, tx: Transaction) {
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, events: true, objectTypes: true } });
  const t = r.Transaction ?? r.FailedTransaction;
  if (!r.Transaction || !t.effects?.status.success) throw new Error(`tx failed: ${JSON.stringify(t.effects?.status)}`);
  await client.waitForTransaction({ digest: t.digest });
  return t;
}
const balance = async (owner: string) => BigInt((await client.getBalance({ owner })).balance.balance);

const AMOUNT = MIST / 100n; // 0.01 SUI
const engine = createPolicyEngine({
  policy: { chains: [`sui:${network}`], allow: { programs: [dep.packageId] }, limits: [{ asset: SUI, label: "SUI", decimals: 9, perTx: MIST / 10n }], requireSimulation: false },
});
const receipts = new ReceiptLog({ signer: ed25519Signer() });
recordPolicyEvents(engine, receipts);

let escrowId = "";
try {
  await report.step(
    "preflight balance",
    async () => {
      const b = await balance(agent.toSuiAddress());
      if (b < MIST / 5n) throw new Error(`agent has ${fromAtomic(b, 9)} SUI; need ≥ 0.2 (sui client faucet)`);
      return { detail: `${fromAtomic(b, 9)} SUI` };
    },
    { critical: true },
  );

  await report.step("policy: authorize escrow funding (0.01 SUI ≤ 0.1 cap)", async () => {
    const auth = await engine.authorize(suiEscrowCreateAction(dep, { coinType: SUI, provider: provider.toSuiAddress(), amount: AMOUNT, network }));
    await auth.commit();
    const denied = await engine.evaluate(suiEscrowCreateAction(dep, { coinType: SUI, provider: provider.toSuiAddress(), amount: MIST, network }));
    if (denied.verdict !== "deny") throw new Error("1 SUI should be over the cap");
    return { detail: `1 SUI denied: ${denied.reasons[0]}` };
  });

  await report.step(
    "fund provider gas (0.05 SUI)",
    async () => {
      const tx = new Transaction();
      const [c] = tx.splitCoins(tx.gas, [MIST / 20n]);
      tx.transferObjects([c!], provider.toSuiAddress());
      const t = await exec(agent, tx);
      return { links: [explorer(t.digest)] };
    },
    { critical: true },
  );

  await report.step(
    "escrow: create + fund 0.01 SUI",
    async () => {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [AMOUNT]);
      escrow.create(tx, { coinType: SUI, payment: coin!, provider: provider.toSuiAddress(), deadline: Date.now() + 3_600_000, terms: "codkit e2e" });
      const t = await exec(agent, tx);
      escrowId = t.effects!.changedObjects.find((o) => o.idOperation === "Created" && (t.objectTypes?.[o.objectId] ?? "").includes("::escrow::Escrow<"))?.objectId ?? "";
      if (!escrowId) throw new Error("escrow object not found");
      return { detail: escrowId, links: [explorer(t.digest)] };
    },
    { critical: true },
  );

  await report.step("escrow: provider delivers", async () => {
    const tx = new Transaction();
    escrow.deliver(tx, { coinType: SUI, escrowId, delivery: "walrus://codkit-e2e" });
    return { links: [explorer((await exec(provider, tx)).digest)] };
  });

  await report.step("escrow: agent releases", async () => {
    const before = await balance(provider.toSuiAddress());
    const tx = new Transaction();
    escrow.release(tx, { coinType: SUI, escrowId });
    const t = await exec(agent, tx);
    const gained = (await balance(provider.toSuiAddress())) - before;
    if (gained !== AMOUNT) throw new Error(`provider gained ${gained} MIST`);
    const released = t.events?.some((e) => e.eventType.endsWith("::escrow::Released"));
    if (!released) throw new Error("no Released event");
    return { detail: "provider received 0.01 SUI; Released event emitted", links: [explorer(t.digest)] };
  });

  await report.step("receipts: anchor head via kit_escrow::anchor and verify", async () => {
    let digest = "";
    const pub = await receipts.publish({
      anchorer: suiAnchorer({
        packageId: dep.packageId,
        network,
        execute: async (tx) => {
          const t = await exec(agent, tx);
          if (!t.events?.some((e) => e.eventType.endsWith("::anchor::Anchored"))) throw new Error("no Anchored event");
          digest = t.digest;
          return t.digest;
        },
      }),
    });
    const v = await verifyLog(await receipts.list(), { anchor: pub.checkpoint });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return { detail: `${pub.checkpoint.count} receipts, head ${pub.checkpoint.head.slice(0, 18)}…`, links: [explorer(digest)] };
  });
} catch {
  // critical failure — still clean up and write the report
} finally {
  await report.step("cleanup: provider returns all SUI to agent", async () => {
    const b = await balance(provider.toSuiAddress());
    if (b === 0n) return { detail: "nothing to return" };
    const tx = new Transaction();
    tx.transferObjects([tx.gas], agent.toSuiAddress());
    const t = await exec(provider, tx);
    return { detail: `~${fromAtomic(b, 9)} SUI minus gas`, links: [explorer(t.digest)] };
  });
  const file = report.save();
  console.log(`\n${report.ok ? "PASS" : "FAIL"} — report: ${file}`);
  process.exitCode = report.ok ? 0 : 1;
}
