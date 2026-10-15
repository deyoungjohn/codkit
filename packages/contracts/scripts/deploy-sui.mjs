#!/usr/bin/env node
// Publish the Move package (escrow + reputation + anchor) from YOUR active Sui address and record it.
//
//   node scripts/deploy-sui.mjs --network testnet [--expect-address 0x…] [--dry-run] [--gas-budget 300000000] [--client-config <path>]
//
// Uses the Sui CLI's active address for that environment (`sui client active-address`).
// --expect-address aborts unless that active address is the wallet you mean to publish from
// (the publisher receives the UpgradeCap). Check it before every non-local publish.
// Fund it first: `sui client faucet` (testnet/devnet) or https://faucet.sui.io.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { root, writeDeployment } from "./registry.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const network = arg("network") ?? "testnet";
const dryRun = process.argv.includes("--dry-run");
const config = arg("client-config");
const base = [...(config ? ["--client.config", config] : []), "--client.env", network];

const sui = (args) => {
  const r = spawnSync("sui", ["client", ...base, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }
  return r.stdout;
};

const sender = sui(["active-address"]).trim();
const expected = arg("expect-address");
if (expected && expected.toLowerCase() !== sender.toLowerCase()) {
  console.error(`active Sui address is ${sender}, not ${expected}; run \`sui client switch --address ${expected}\``);
  process.exit(1);
}
if (!expected && !network.includes("local")) console.warn(`! publishing from ${sender}; pass --expect-address to check it's the intended wallet`);
// testnet / mainnet are declared by the package (real publish, recorded in the package's lock).
// Local networks use an ephemeral publication file outside the repo.
const ephemeral = !["testnet", "mainnet"].includes(network);
const publishCmd = ephemeral
  ? ["test-publish", "--build-env", "testnet", "--pubfile-path", join(root, "evm", "cache", `Pub.${network}.toml`)]
  : ["publish"];
console.log(`> publishing ${join(root, "sui")} to ${network} from ${sender}${dryRun ? " (dry run)" : ""}`);
const out = sui([...publishCmd, join(root, "sui"), "--json", "--gas-budget", arg("gas-budget") ?? "300000000", ...(dryRun ? ["--dry-run"] : [])]);
const res = JSON.parse(out.slice(out.indexOf("{")));
const status = res.effects?.status?.status ?? res.effects?.V2?.status ?? "unknown";
if (status !== "success" && status !== "unknown") throw new Error(`publish failed: ${JSON.stringify(res.effects?.status)}`);
const changes = res.objectChanges ?? [];
const packageId = changes.find((c) => c.type === "published")?.packageId;
const reputationId = changes.find((c) => c.type === "created" && c.objectType?.endsWith("::reputation::Reputation"))?.objectId;
const upgradeCap = changes.find((c) => c.type === "created" && c.objectType === "0x2::package::UpgradeCap")?.objectId;
console.log({ status, packageId, reputationId, upgradeCap, digest: res.digest });
if (dryRun) {
  console.log("dry run: nothing published, nothing recorded");
  process.exit(0);
}
if (!packageId || !reputationId) throw new Error("could not find packageId / Reputation in publish output");
const explorer = ["testnet", "devnet", "mainnet"].includes(network) ? `https://suiscan.xyz/${network}` : null;
writeDeployment(`sui-${network}`, {
  network: `sui:${network}`,
  deployer: sender,
  deployedAt: new Date().toISOString(),
  commit: spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  packageId,
  reputationId,
  upgradeCap,
  digest: res.digest,
  ...(explorer && { url: `${explorer}/object/${packageId}`, tx: `${explorer}/tx/${res.digest}` }),
});
