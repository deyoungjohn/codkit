/**
 * codkit end-to-end on Solana, against the deployed `kit_escrow` program.
 *
 *   pnpm e2e:solana [--cluster devnet] [--mint <SPL mint the agent holds>] [--program <id>]
 *   (local rehearsal: SOLANA_RPC_URL=http://127.0.0.1:8899 SOLANA_WS_URL=ws://127.0.0.1:8900 … --cluster localnet --program <id>)
 *
 * Agent: SOLANA_AGENT_KEYPAIR (path to a `solana-keygen` JSON file) with ~0.05 devnet SOL.
 * Keep it separate from the program's upgrade authority. By default the run creates its own
 * 6-decimal test mint (the agent is mint authority), so no token faucet is needed; pass
 * --mint to use e.g. devnet USDC instead. A provider keypair is generated per run; the agent
 * pays every fee, the provider only co-signs, and everything is handed back at the end.
 *
 * Steps: preflight → test mint → policy-guarded create (simulated first) → deliver → release
 * (provider paid, vault closed, reputation recorded) → double payout refused → receipts
 * anchored with an SPL memo, read back from the chain and verified → provider returns tokens.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { deployments } from "@codkit/contracts";
import {
  createDealInstruction,
  deliverInstruction,
  fetchDeal,
  fetchReputation,
  findAssociatedTokenAddress,
  releaseInstruction,
  solanaEscrowCreateAction,
  TOKEN_PROGRAM_ID,
} from "@codkit/contracts/solana";
import { createPolicyEngine, fromAtomic, isPolicyError } from "@codkit/policy";
import { ed25519Signer, ReceiptLog, recordPolicyEvents, verifyLog } from "@codkit/receipts";
import { anchorMemoInstruction, parseAnchorMemo } from "@codkit/receipts/solana";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { arg, Report } from "./report.js";

const cluster = arg("cluster") ?? "devnet";
const RPC_URL = process.env.SOLANA_RPC_URL || `https://api.${cluster}.solana.com`;
const WS_URL = process.env.SOLANA_WS_URL || RPC_URL.replace(/^http/, "ws");
const explorer = (sig: string) =>
  cluster === "localnet" ? `https://explorer.solana.com/tx/${sig}?cluster=custom` : `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;

/** The JSON the deploy step recorded (no rebuild of @codkit/contracts needed), else the built registry. */
const recorded = (name: string): unknown => {
  const file = new URL(`../../../packages/contracts/deployments/${name}.json`, import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
};
const dep = (arg("program") ? { programId: arg("program") } : (recorded(`solana-${cluster}`) ?? (deployments as Record<string, unknown>)[`solana-${cluster}`])) as
  | { programId: string; upgradeAuthority?: string }
  | undefined;
if (!dep) throw new Error(`no Solana deployment recorded for ${cluster}`);
const PROGRAM = address(dep.programId);

const keyPath = (process.env.SOLANA_AGENT_KEYPAIR ?? "").replace(/^~/, homedir());
if (!keyPath || !existsSync(keyPath)) throw new Error("set SOLANA_AGENT_KEYPAIR to a solana-keygen JSON file (a testnet-only agent key)");
const agent = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(keyPath, "utf8"))));
if (dep.upgradeAuthority && agent.address === dep.upgradeAuthority) {
  throw new Error("SOLANA_AGENT_KEYPAIR is the program's upgrade authority; use a separate agent key");
}
const provider = await generateKeyPairSigner();

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

/** Agent pays the fee; any other signers ride along on the instructions' account metas. */
async function build(instructions: Instruction[]) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(agent, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  assertIsTransactionWithBlockhashLifetime(tx);
  return tx;
}

async function simulate(instructions: Instruction[]) {
  const tx = await build(instructions);
  const { value } = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", commitment: "confirmed", replaceRecentBlockhash: true })
    .send();
  return { ok: !value.err, logs: value.logs ?? [], err: value.err };
}

async function send(instructions: Instruction[]): Promise<string> {
  const tx = await build(instructions);
  await sendAndConfirm(tx, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}

const tokenBalance = async (account: Address) => {
  const { value } = await rpc.getAccountInfo(account, { encoding: "base64", commitment: "confirmed" }).send();
  if (!value) return null;
  const bytes = Uint8Array.from(atob((value.data as [string, string])[0]), (c) => c.charCodeAt(0));
  return new DataView(bytes.buffer).getBigUint64(64, true);
};

const DECIMALS = 6;
const AMOUNT = 100_000n; // 0.10 tokens
const report = new Report(`solana-${cluster}`, { agent: agent.address, provider: provider.address, programId: PROGRAM });

const receipts = new ReceiptLog({ signer: ed25519Signer() });
let mint = arg("mint") ? address(arg("mint")!) : undefined;
let engine: ReturnType<typeof createPolicyEngine> | undefined;
let deal: Awaited<ReturnType<typeof fetchDeal>> = null;

try {
  await report.step(
    "preflight balance",
    async () => {
      const { value } = await rpc.getBalance(agent.address, { commitment: "confirmed" }).send();
      if (value < 30_000_000n) throw new Error(`agent has ${fromAtomic(value, 9)} SOL; need ≥ 0.03 devnet SOL (faucet.solana.com)`);
      return { detail: `${fromAtomic(value, 9)} SOL` };
    },
    { critical: true },
  );

  await report.step(
    mint ? "token: use the given mint" : "token: create a 6-decimal test mint and mint 1.0 to the agent",
    async () => {
      if (mint) return { detail: mint };
      const m = await generateKeyPairSigner();
      const space = BigInt(getMintSize());
      const rent = await rpc.getMinimumBalanceForRentExemption(space).send();
      const sig = await send([
        getCreateAccountInstruction({ payer: agent, newAccount: m, lamports: rent, space, programAddress: TOKEN_PROGRAM_ID }),
        getInitializeMint2Instruction({ mint: m.address, decimals: DECIMALS, mintAuthority: agent.address }),
        await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: agent, owner: agent.address, mint: m.address }),
        getMintToInstruction({
          mint: m.address,
          token: await findAssociatedTokenAddress(agent.address, m.address),
          mintAuthority: agent,
          amount: 1_000_000n,
        }),
      ]);
      mint = m.address;
      return { detail: mint, links: [explorer(sig)] };
    },
    { critical: true },
  );

  engine = createPolicyEngine({
    policy: {
      chains: [`solana:${cluster}`],
      allow: { programs: [PROGRAM] },
      limits: [{ asset: mint!, label: "TOKEN", decimals: DECIMALS, perTx: 500_000n }],
    },
  });
  recordPolicyEvents(engine, receipts);

  await report.step(
    "escrow: create + fund 0.10 (policy-guarded, simulated before sending)",
    async () => {
      const ix = await createDealInstruction({
        client: agent,
        dealId: BigInt(Date.now()),
        provider: provider.address,
        mint: mint!,
        amount: AMOUNT,
        deadline: new Date(Date.now() + 3_600_000),
        termsHash: "codkit e2e: deliver a hash",
        programId: PROGRAM,
      });
      const { result: sig } = await engine!.execute(solanaEscrowCreateAction({ mint: mint!, provider: provider.address, amount: AMOUNT, cluster, programId: PROGRAM }), {
        simulate: async () => {
          const s = await simulate([ix]);
          return { ok: s.ok, details: { logs: s.logs.slice(-3) }, ...(!s.ok && { reason: JSON.stringify(s.err) }) };
        },
        execute: () => send([ix]),
        ref: (s) => s,
      });
      deal = await fetchDeal(rpc, ix.deal);
      if (deal?.status !== "Funded") throw new Error(`deal status ${deal?.status}`);
      const held = await tokenBalance(await findAssociatedTokenAddress(ix.deal, mint!));
      if (held !== AMOUNT) throw new Error(`vault holds ${held}`);
      return { detail: `deal ${ix.deal.slice(0, 8)}…, vault holds 0.10`, links: [explorer(sig)] };
    },
    { critical: true },
  );

  await report.step("guardrail: over-cap funding is refused before signing", async () => {
    const err = await engine!
      .execute(solanaEscrowCreateAction({ mint: mint!, provider: provider.address, amount: 5_000_000n, cluster, programId: PROGRAM }), {
        simulate: async () => ({ ok: true }),
        execute: async () => {
          throw new Error("must not get here");
        },
      })
      .then(() => null, (e: unknown) => e);
    if (!isPolicyError(err) || err.code !== "denied") throw new Error(`expected denial, got ${String(err)}`);
    return { detail: err.message };
  });

  await report.step("escrow: provider delivers (agent pays the fee)", async () => {
    const sig = await send([deliverInstruction({ provider, deal: deal!.address, deliveryHash: "ipfs://codkit-e2e-result", programId: PROGRAM })]);
    deal = await fetchDeal(rpc, deal!.address);
    if (deal?.status !== "Delivered") throw new Error(`deal status ${deal?.status}`);
    return { links: [explorer(sig)] };
  });

  await report.step("escrow: agent releases", async () => {
    const sig = await send([await releaseInstruction({ signer: agent, deal: deal!, programId: PROGRAM })]);
    deal = await fetchDeal(rpc, deal!.address);
    const paid = await tokenBalance(await findAssociatedTokenAddress(provider.address, mint!));
    const vault = await tokenBalance(await findAssociatedTokenAddress(deal!.address, mint!));
    if (deal?.status !== "Released" || paid !== AMOUNT) throw new Error(`status ${deal?.status}, provider holds ${paid}`);
    if (vault !== null) throw new Error("vault was not closed");
    return { detail: "provider received 0.10; vault closed, rent back to the agent", links: [explorer(sig)] };
  });

  await report.step("reputation recorded", async () => {
    const rep = await fetchReputation(rpc, provider.address, { programId: PROGRAM });
    if (rep.completed !== 1n) throw new Error(JSON.stringify(rep, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    return { detail: `completed ${rep.completed}, score ${rep.score}` };
  });

  await report.step("guardrail: a second payout fails in simulation", async () => {
    const s = await simulate([await releaseInstruction({ signer: agent, deal: deal!, programId: PROGRAM })]);
    if (s.ok) throw new Error("second release simulated successfully");
    const why = s.logs.find((l) => l.includes("Error Code")) ?? JSON.stringify(s.err);
    return { detail: why.replace(/^Program log: /, "").slice(0, 120) };
  });

  await report.step("receipts: anchor head in an SPL memo, read it back and verify", async () => {
    let sig = "";
    const pub = await receipts.publish({
      anchorer: {
        chain: `solana:${cluster}`,
        anchor: async (cp) => {
          sig = await send([anchorMemoInstruction(cp, agent.address) as unknown as Instruction]);
          return { chain: `solana:${cluster}`, tx: sig, url: explorer(sig) };
        },
      },
    });
    // read the memo back from the chain rather than trusting what we sent
    const tx = await rpc.getTransaction(sig as never, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "json" }).send();
    const memoLog = tx?.meta?.logMessages?.find((l) => l.includes("kit-receipts:v1:")) ?? "";
    const onchain = parseAnchorMemo(memoLog.slice(memoLog.indexOf("kit-receipts:v1:")).replace(/"$/, ""));
    if (!onchain || onchain.head !== pub.checkpoint.head || onchain.seq !== pub.checkpoint.seq) throw new Error(`memo mismatch: ${memoLog}`);
    const v = await verifyLog(await receipts.list(), { anchor: { ...pub.checkpoint, ...onchain } });
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return { detail: `${pub.checkpoint.count} receipts verified against the head in the memo`, links: [explorer(sig)] };
  });
} catch {
  // critical step failed; fall through to cleanup + report
} finally {
  await report.step("cleanup: provider returns the tokens and closes its account", async () => {
    if (!mint) return { detail: "nothing to return" };
    const from = await findAssociatedTokenAddress(provider.address, mint);
    const bal = await tokenBalance(from);
    if (bal === null) return { detail: "nothing to return" };
    const sig = await send([
      ...(bal > 0n
        ? [
            getTransferCheckedInstruction({
              source: from,
              mint,
              destination: await findAssociatedTokenAddress(agent.address, mint),
              authority: provider,
              amount: bal,
              decimals: DECIMALS,
            }),
          ]
        : []),
      getCloseAccountInstruction({ account: from, destination: agent.address, owner: provider }),
    ]);
    return { detail: `${fromAtomic(bal, DECIMALS)} tokens back; token-account rent back to the agent`, links: [explorer(sig)] };
  });
  const file = report.save();
  console.log(`\n${report.ok ? "PASS" : "FAIL"} — report: ${file}`);
  process.exitCode = report.ok ? 0 : 1;
  process.exit();
}

export type { KeyPairSigner };
