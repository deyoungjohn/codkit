/**
 * Publish the Move escrow to a local Sui network and run the full lifecycle
 * through the TS builders: create → deliver → release, then read reputation.
 *
 *   sui start --with-faucet --force-regenesis      # in another terminal
 *   pnpm --filter @iamyoungjohn-kit/contracts example:sui
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { suiEscrow, Transaction } from "../src/sui/index.js";

const SUI = "0x2::sui::SUI";
const url = process.env.SUI_URL ?? "http://127.0.0.1:9000";
const client = new SuiGrpcClient({ network: "localnet", baseUrl: url });
const include = { effects: true, objectTypes: true, events: true } as const;

async function run(signer: Ed25519Keypair, tx: Transaction, label: string) {
  const res = await client.signAndExecuteTransaction({ transaction: tx, signer, include });
  const t = res.Transaction ?? res.FailedTransaction;
  if (!res.Transaction || !t.effects?.status.success) {
    throw new Error(`${label} failed: ${JSON.stringify(t.effects?.status)}`);
  }
  await client.waitForTransaction({ digest: t.digest });
  console.log(`  ✓ ${label} (${t.digest})`);
  return t;
}

const created = (t: Awaited<ReturnType<typeof run>>, typeIncludes: string) =>
  t.effects!.changedObjects.find(
    (o) => o.idOperation === "Created" && (t.objectTypes?.[o.objectId] ?? "").includes(typeIncludes),
  )?.objectId;

const [client_, provider] = [Ed25519Keypair.generate(), Ed25519Keypair.generate()];
for (const k of [client_, provider]) {
  await requestSuiFromFaucetV2({ host: process.env.SUI_FAUCET ?? getFaucetHost("localnet"), recipient: k.toSuiAddress() });
}
console.log(`client   ${client_.toSuiAddress()}\nprovider ${provider.toSuiAddress()}`);

// 1. publish
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "../sui");
const { modules, dependencies } = JSON.parse(
  execFileSync("sui", ["move", "build", "--dump-bytecode-as-base64", "--path", pkgDir], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
) as { modules: string[]; dependencies: string[] };
const pubTx = new Transaction();
pubTx.transferObjects([pubTx.publish({ modules, dependencies })], client_.toSuiAddress());
const pub = await run(client_, pubTx, "publish");
const packageId = pub.effects!.changedObjects.find((o) => o.outputState === "PackageWrite")!.objectId;
const reputationId = created(pub, "::reputation::Reputation")!;
console.log(`  package ${packageId}\n  reputation ${reputationId}`);
const escrow = suiEscrow({ packageId, reputationId });

// 2. client locks 0.5 SUI for the provider
const AMOUNT = 500_000_000n;
const tx1 = new Transaction();
const [coin] = tx1.splitCoins(tx1.gas, [AMOUNT]);
escrow.create(tx1, {
  coinType: SUI,
  payment: coin!,
  provider: provider.toSuiAddress(),
  deadline: Date.now() + 86_400_000,
  terms: "translate 3 docs",
});
const c = await run(client_, tx1, "create");
const escrowId = created(c, "::escrow::Escrow<")!;
console.log(`  escrow ${escrowId}; events: ${c.events?.map((e) => e.eventType.split("::").pop()).join(", ")}`);

// 3. provider delivers
const tx2 = new Transaction();
escrow.deliver(tx2, { coinType: SUI, escrowId, delivery: "walrus://blob/123" });
await run(provider, tx2, "deliver");

// 4. client releases
const before = (await client.getBalance({ owner: provider.toSuiAddress() })).balance.balance;
const tx3 = new Transaction();
escrow.release(tx3, { coinType: SUI, escrowId });
await run(client_, tx3, "release");
const after = (await client.getBalance({ owner: provider.toSuiAddress() })).balance.balance;
console.log(`  provider balance +${BigInt(after) - BigInt(before)} MIST`);

const obj = await client.getObject({ objectId: escrowId, include: { json: true } });
console.log("  escrow state:", JSON.stringify((obj.object as { json?: unknown }).json));
if (BigInt(after) - BigInt(before) !== AMOUNT) throw new Error("provider was not paid the escrowed amount");
console.log("\nok");
