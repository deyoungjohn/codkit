#!/usr/bin/env node
// Deploy Reputation + Escrow + ReceiptAnchor with YOUR wallet, verify source, record addresses.
//
//   node scripts/deploy-evm.mjs --network base-sepolia --account <cast-keystore-name> [--verify] [--dry-run]
//
// Signer: --account uses a Foundry keystore (`cast wallet import <name> --interactive`; Foundry
// prompts for its password). Or set DEPLOYER_PRIVATE_KEY in the environment (testnet-only key).
// Verification: Etherscan if ETHERSCAN_API_KEY is set (one key works across chains), else Sourcify.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root, writeDeployment } from "./registry.mjs";

const NETWORKS = {
  "base-sepolia": { chainId: 84532, rpc: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", explorer: "https://sepolia.basescan.org" },
  sepolia: { chainId: 11155111, rpc: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
  "arbitrum-sepolia": { chainId: 421614, rpc: process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io" },
  "optimism-sepolia": { chainId: 11155420, rpc: process.env.OPTIMISM_SEPOLIA_RPC_URL ?? "https://sepolia.optimism.io", explorer: "https://sepolia-optimism.etherscan.io" },
  local: { chainId: 31337, rpc: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545", explorer: null },
};

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const flag = (name) => process.argv.includes(`--${name}`);

const network = arg("network") ?? "base-sepolia";
const net = NETWORKS[network];
if (!net) throw new Error(`unknown network ${network}; one of ${Object.keys(NETWORKS).join(", ")}`);
const account = arg("account");
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!account && !key) {
  console.error("Pass --account <cast keystore name> (recommended) or set DEPLOYER_PRIVATE_KEY.");
  process.exit(1);
}
const dryRun = flag("dry-run");
const verify = flag("verify") && !dryRun && network !== "local";

const args = ["script", "script/Deploy.s.sol", "--rpc-url", net.rpc, "--chain", String(net.chainId)];
args.push(...(account ? ["--account", account] : ["--private-key", key]));
if (!dryRun) args.push("--broadcast", "--slow");
if (verify) {
  args.push("--verify");
  if (process.env.ETHERSCAN_API_KEY) args.push("--etherscan-api-key", process.env.ETHERSCAN_API_KEY);
  else args.push("--verifier", "sourcify");
}

console.log(`> forge ${args.map((a) => (a === key ? "<DEPLOYER_PRIVATE_KEY>" : a)).join(" ")}`);
const res = spawnSync("forge", args, { cwd: join(root, "evm"), stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);
if (dryRun) {
  console.log("dry run: nothing broadcast, nothing recorded");
  process.exit(0);
}

const file = join(root, "evm", "broadcast", "Deploy.s.sol", String(net.chainId), "run-latest.json");
if (!existsSync(file)) throw new Error(`no broadcast found at ${file}`);
const run = JSON.parse(readFileSync(file, "utf8"));
const created = run.transactions.filter((t) => t.transactionType === "CREATE");
const contracts = Object.fromEntries(
  created.map((t) => [
    t.contractName,
    { address: t.contractAddress, tx: t.hash, ...(net.explorer && { url: `${net.explorer}/address/${t.contractAddress}` }) },
  ]),
);
for (const name of ["Reputation", "Escrow", "ReceiptAnchor"]) if (!contracts[name]) throw new Error(`${name} missing from broadcast`);
writeDeployment(network, {
  network,
  chainId: net.chainId,
  deployer: created[0].transaction.from,
  deployedAt: new Date().toISOString(),
  verified: verify ? (process.env.ETHERSCAN_API_KEY ? "etherscan" : "sourcify") : null,
  commit: spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  contracts,
});
