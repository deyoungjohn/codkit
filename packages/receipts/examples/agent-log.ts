/**
 * An agent's verifiable audit trail, end to end on a throwaway local chain:
 * policy decisions are recorded as signed, hash-chained receipts, the head is
 * anchored onchain, and a third party verifies the log against the anchor.
 *
 *   pnpm --filter @codkit/receipts example             # local anvil (needs Foundry)
 *   pnpm --filter @codkit/receipts example -- --walrus # also upload the log to Walrus testnet
 */
import { spawn } from "node:child_process";
import { receiptAnchorBytecode } from "@codkit/contracts";
import { createPolicyEngine, usdc } from "@codkit/policy";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { evmAnchorer, readEvmAnchors } from "../src/anchors/evm.js";
import { readWalrusUri, walrusUploader } from "../src/anchors/walrus.js";
import { ed25519Signer, parseJsonl, ReceiptLog, recordPolicyEvents, verifyLog } from "../src/index.js";

const useWalrus = process.argv.includes("--walrus");
const port = 8600 + Math.floor(Math.random() * 300);
const anvil = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
try {
  const transport = http(`http://127.0.0.1:${port}`);
  const pc = createPublicClient({ chain: foundry, transport, pollingInterval: 50 });
  for (let i = 0; i < 100 && !(await pc.getChainId().catch(() => 0)); i++) await new Promise((r) => setTimeout(r, 100));
  // anvil dev key #0 — public, local only
  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const wallet = createWalletClient({ account, chain: foundry, transport, pollingInterval: 50 });
  const contract = (await pc.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ data: receiptAnchorBytecode }) })).contractAddress!;

  // 1. the agent: policy engine + receipt log recording every policy event
  const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const engine = createPolicyEngine({ policy: { limits: [{ asset: USDC, label: "USDC", perTx: usdc(5) }] } });
  const signer = ed25519Signer(); // persist signer.secretKey in a real agent
  const log = new ReceiptLog({ signer });
  const recorder = recordPolicyEvents(engine, log);

  const pay = (amount: bigint) =>
    engine
      .execute(
        { chain: "eip155:84532", kind: "token_transfer", to: "0x1111111111111111111111111111111111111111", spends: [{ asset: USDC, amount }] },
        { simulate: async () => ({ ok: true }), execute: async () => `0x${"ab".repeat(32)}`, ref: (h) => h },
      )
      .catch(() => undefined);
  await pay(usdc(2));
  await pay(usdc(50)); // denied
  await log.append("agent.note", { reasoning: "Vendor quoted 50 USDC; over cap, asked human instead." });
  await recorder.flush();

  // 2. publish: (walrus upload) + anchor head onchain + record the anchor
  const res = await log.publish({
    anchorer: evmAnchorer({ chainId: 31337, wallet, contract, waitFor: pc }),
    ...(useWalrus && { uploader: walrusUploader() }),
  });
  console.log("receipts:");
  for (const r of await log.list()) console.log(`  #${r.seq} ${r.type.padEnd(18)} ${r.hash.slice(0, 18)}…`);
  console.log(`anchored head #${res.checkpoint.seq} in tx ${res.anchor?.tx}`);
  if (res.upload) console.log(`full log: ${res.upload.uri}  ${res.upload.url}`);

  // 3. an auditor: fetch the anchor from chain, fetch the log, verify
  const [anchor] = await readEvmAnchors(pc, { contract, logger: account.address });
  const published = res.upload ? parseJsonl(await readWalrusUri(res.upload.uri)) : await log.list();
  const verdict = await verifyLog(published, { anchor: anchor!, trustedActors: [signer.id] });
  console.log(`auditor: ${verdict.ok ? "✓ log is intact and matches the onchain anchor" : `✗ ${JSON.stringify(verdict.errors)}`}`);

  const tampered = published.map((r) => (r.seq === 1 ? { ...r, data: { ...(r.data as object), forged: true } } : r));
  const t = await verifyLog(tampered, { anchor: anchor! });
  console.log(`tampered copy: ${t.ok ? "passed?!" : `✗ caught — ${t.errors[0]!.reason}`}`);
} finally {
  anvil.kill();
}
