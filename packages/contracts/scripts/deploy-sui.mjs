#!/usr/bin/env node
// Publish the Move package (escrow + reputation + anchor) from YOUR active Sui address and record it.
//
//   node scripts/deploy-sui.mjs --network testnet [--expect-address 0x…] [--fresh] [--dry-run] [--gas-budget 300000000] [--client-config <path>]
//
// Uses the Sui CLI's active address for that environment (`sui client active-address`).
// --expect-address aborts unless that active address is the wallet you mean to publish from
// (the publisher receives the UpgradeCap). Check it before every non-local publish.
// --fresh publishes a new package even though sui/Published.toml already records one for
// this network (new package ID; the old package stays on chain). Without it, the script stops.
// Fund it first: `sui client faucet` (testnet/devnet) or https://faucet.sui.io.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    // the CLI prints build progress on stderr and the actual error on stdout
    console.error([r.stderr, r.stdout].filter(Boolean).join("\n").trim());
    restorePubfile();
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
// An existing publication for this network blocks `sui client publish`.
const pubfile = join(root, "sui", "Published.toml");
let pubfileOriginal = null;
function restorePubfile() {
  if (pubfileOriginal !== null) writeFileSync(pubfile, pubfileOriginal);
  pubfileOriginal = null;
}
if (!ephemeral && existsSync(pubfile)) {
  const text = readFileSync(pubfile, "utf8");
  const block = new RegExp(`\\[published\\.${network}\\][\\s\\S]*?(?=\\n\\[|$)`);
  const m = text.match(block);
  if (m) {
    const at = m[0].match(/published-at = "([^"]+)"/)?.[1];
    if (!process.argv.includes("--fresh")) {
      console.error(
        `${network} already has a publication of this package (${at}) in sui/Published.toml.\n` +
          `Pass --fresh to publish a new package with new IDs (the old one stays on chain),\n` +
          `or upgrade it in place with \`sui client upgrade\` using the UpgradeCap.`,
      );
      process.exit(1);
    }
    console.log(`> --fresh: replacing the ${network} publication ${at}`);
    pubfileOriginal = text;
    writeFileSync(pubfile, text.replace(block, "").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n");
  }
}
console.log(`> publishing ${join(root, "sui")} to ${network} from ${sender}${dryRun ? " (dry run)" : ""}`);
const out = sui([...publishCmd, join(root, "sui"), "--json", "--gas-budget", arg("gas-budget") ?? "300000000", ...(dryRun ? ["--dry-run"] : [])]);
const res = JSON.parse(out.slice(out.indexOf("{")));
const status = res.effects?.status?.status ?? res.effects?.V2?.status ?? "unknown";
if (status !== "success" && status !== "unknown") {
  restorePubfile();
  throw new Error(`publish failed: ${JSON.stringify(res.effects?.status)}`);
}
if (dryRun) restorePubfile(); // a dry run must leave Published.toml as it was
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
