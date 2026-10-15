#!/usr/bin/env node
// Markdown "Deployed contracts" table from Foundry broadcasts, for your submission README.
//
//   forge script script/Deploy.s.sol --rpc-url base_sepolia --account dev --broadcast
//   node scripts/deployments-table.mjs                 # every chain found in evm/broadcast
//   node scripts/deployments-table.mjs --chain 84532   # one chain
// Sui and Solana deployments recorded in deployments/{sui,solana}-*.json (non-local) are appended when no --chain is given.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPLORERS = {
  1: ["Ethereum", "https://etherscan.io"],
  11155111: ["Sepolia", "https://sepolia.etherscan.io"],
  8453: ["Base", "https://basescan.org"],
  84532: ["Base Sepolia", "https://sepolia.basescan.org"],
  10: ["Optimism", "https://optimistic.etherscan.io"],
  11155420: ["OP Sepolia", "https://sepolia-optimism.etherscan.io"],
  42161: ["Arbitrum", "https://arbiscan.io"],
  421614: ["Arbitrum Sepolia", "https://sepolia.arbiscan.io"],
  137: ["Polygon", "https://polygonscan.com"],
  80002: ["Polygon Amoy", "https://amoy.polygonscan.com"],
  31337: ["Anvil (local)", null],
};

export function deploymentsTable(broadcastDir, only) {
  const rows = [];
  if (!existsSync(broadcastDir)) return { rows, markdown: "_No deployments found — run the deploy script with --broadcast._" };
  for (const script of readdirSync(broadcastDir)) {
    for (const chainId of readdirSync(join(broadcastDir, script))) {
      if (only && chainId !== String(only)) continue;
      const file = join(broadcastDir, script, chainId, "run-latest.json");
      if (!existsSync(file)) continue;
      const run = JSON.parse(readFileSync(file, "utf8"));
      for (const tx of run.transactions ?? []) {
        if (tx.transactionType !== "CREATE" && tx.transactionType !== "CREATE2") continue;
        rows.push({ chainId: Number(chainId), contract: tx.contractName, address: tx.contractAddress, tx: tx.hash, script });
      }
    }
  }
  const head = "| Contract | Network | Address | Deploy tx |\n| --- | --- | --- | --- |";
  const body = rows.map((r) => {
    const [name, url] = EXPLORERS[r.chainId] ?? [`chain ${r.chainId}`, null];
    const addr = url ? `[\`${r.address}\`](${url}/address/${r.address})` : `\`${r.address}\``;
    const tx = url ? `[${r.tx.slice(0, 10)}…](${url}/tx/${r.tx})` : `\`${r.tx.slice(0, 10)}…\``;
    return `| ${r.contract} | ${name} (${r.chainId}) | ${addr} | ${tx} |`;
  });
  return { rows, markdown: rows.length ? [head, ...body].join("\n") : "_No deployments found._" };
}

/** Rows for Sui publications (deployments/sui-<network>.json written by deploy-sui.mjs). */
export function suiRows(deploymentsDir) {
  if (!existsSync(deploymentsDir)) return [];
  return readdirSync(deploymentsDir)
    .filter((f) => /^sui-.+\.json$/.test(f) && !/local/.test(f))
    .sort()
    .flatMap((f) => {
      const d = JSON.parse(readFileSync(join(deploymentsDir, f), "utf8"));
      const net = f.replace(/^sui-|\.json$/g, "");
      const name = `Sui ${net}`;
      const obj = (id) => `[\`${id}\`](https://suiscan.xyz/${net}/object/${id})`;
      const tx = d.digest ? `[${d.digest.slice(0, 10)}…](https://suiscan.xyz/${net}/tx/${d.digest})` : "";
      return [
        `| kit_escrow package | ${name} | ${obj(d.packageId)} | ${tx} |`,
        ...(d.reputationId ? [`| Reputation (shared object) | ${name} | ${obj(d.reputationId)} | ${tx} |`] : []),
      ];
    });
}

/** Rows for Solana programs (deployments/solana-<cluster>.json). */
export function solanaRows(deploymentsDir) {
  if (!existsSync(deploymentsDir)) return [];
  return readdirSync(deploymentsDir)
    .filter((f) => /^solana-.+\.json$/.test(f) && !/local/.test(f))
    .sort()
    .map((f) => {
      const d = JSON.parse(readFileSync(join(deploymentsDir, f), "utf8"));
      const cluster = f.replace(/^solana-|\.json$/g, "");
      const q = cluster === "mainnet" ? "" : `?cluster=${cluster}`;
      const tx = d.tx ? `[${d.tx.slice(0, 10)}…](https://explorer.solana.com/tx/${d.tx}${q})` : "";
      return `| kit_escrow program | Solana ${cluster} | [\`${d.programId}\`](https://explorer.solana.com/address/${d.programId}${q}) | ${tx} |`;
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const i = process.argv.indexOf("--chain");
  const { rows, markdown } = deploymentsTable(join(root, "evm", "broadcast"), i > 0 ? process.argv[i + 1] : undefined);
  const sui = i > 0 ? [] : [...suiRows(join(root, "deployments")), ...solanaRows(join(root, "deployments"))];
  if (!sui.length) console.log(markdown);
  else console.log([rows.length ? markdown : "| Contract | Network | Address | Deploy tx |\n| --- | --- | --- | --- |", ...sui].join("\n"));
}
