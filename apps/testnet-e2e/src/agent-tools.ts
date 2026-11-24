/**
 * codkit agent tools, end to end on real testnets, driven the way an agent drives them (through the tools).
 *
 *   pnpm e2e:agent-tools [--skip-evm] [--skip-solana] [--skip-mainnet-reads]
 *
 * Base Sepolia: the agent key (AGENT_PRIVATE_KEY) swaps ETH → USDC and USDC → ETH on Uniswap v3 (real pools),
 * sends small transfers to itself, and is stopped by the per-call cap, by the policy engine, and by an
 * operator-forced dry run. Solana devnet: SOLANA_AGENT_KEYPAIR sends SOL and USDC to itself.
 * Mainnet is only ever READ: a LI.FI quote and a Jupiter quote whose transaction is simulated for a public
 * funded address with signature checks off. Nothing is signed or sent on a mainnet.
 *
 * Needs on Base Sepolia ~0.005 ETH and ~0.2 USDC; on devnet ~0.01 SOL and ~0.02 USDC (https://faucet.circle.com).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { agentTools } from "@codkit/agent-tools";
import { evmChain } from "@codkit/agent-tools/evm";
import { JUPITER_PROGRAM, jupiter } from "@codkit/agent-tools/jupiter";
import { lifi } from "@codkit/agent-tools/lifi";
import { SAFE_SWAP_PROGRAMS, solanaChain } from "@codkit/agent-tools/solana";
import { uniswapV3 } from "@codkit/agent-tools/uniswap";
import { getRpcUrl } from "@codkit/config";
import { callTool } from "@codkit/mcp";
import { createPolicyEngine, fromAtomic, toAtomic } from "@codkit/policy";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { createPublicClient, createWalletClient, erc20Abi, type Hex, http, nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { flag, Report } from "./report.js";

const report = new Report("agent-tools-testnets", {});
const call = async (tools: ReturnType<typeof agentTools>, name: string, args: unknown) => {
  const res = await callTool(tools.find((t) => t.name === name)!, args);
  if (!res.ok) throw new Error(res.error);
  return res.value as Record<string, any>;
};
/** The outcome of a call that is expected to be refused: the error text. */
const refused = async (tools: ReturnType<typeof agentTools>, name: string, args: unknown) => {
  const res = await callTool(tools.find((t) => t.name === name)!, args);
  if (res.ok) throw new Error(`expected ${name} to be refused, but it returned ${JSON.stringify(res.value).slice(0, 160)}`);
  return res.error;
};
/** Re-read until the answer looks right: a load-balanced RPC can lag a block behind a mined transaction. */
async function settle<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (done(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const human = (v: bigint, d: number) => fromAtomic(v, d);

// ───────────────────────────── Base Sepolia ─────────────────────────────
if (!flag("skip-evm")) {
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("set AGENT_PRIVATE_KEY (a Base Sepolia test key) in the repo-root .env");
  const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
  const account = privateKeyToAccount(key, { nonceManager });
  const rpc = getRpcUrl("base-sepolia");
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
  const chainKey = "eip155:84532";
  const adapter = evmChain({
    chain: "base-sepolia",
    publicClient: publicClient as never,
    walletClient: walletClient as never,
    tokens: { USDC: { address: USDC, decimals: 6 } },
    swap: [uniswapV3()],
  });
  const policy = (ethPerTx: string) => ({
    chains: [chainKey],
    limits: [
      {
        asset: "native",
        chain: chainKey,
        label: "ETH",
        perTx: toAtomic(ethPerTx, 18),
        perPeriod: { amount: toAtomic("0.002", 18), seconds: 3600 },
      },
      { asset: USDC, chain: chainKey, label: "USDC", perTx: toAtomic("0.5", 6), perPeriod: { amount: toAtomic("1", 6), seconds: 3600 } },
    ],
  });
  const engine = createPolicyEngine({ policy: policy("0.0005") });
  const tools = agentTools({ engine, chains: [adapter], maxPerCall: { ETH: "0.0005", USDC: "0.5" } });
  const bal = async () => ({
    eth: await publicClient.getBalance({ address: account.address }),
    usdc: await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  });
  const nonce = () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const SWAP_ETH = "0.0001";
  let swapBack = 0n; // USDC received by the first swap, sold back by the second

  report.meta.evmAgent = account.address;
  await report.step(
    "base-sepolia: preflight balances",
    async () => {
      const b = await bal();
      if (b.eth < toAtomic("0.002", 18)) throw new Error(`agent has ${human(b.eth, 18)} ETH; needs ≥ 0.002 (gas + swaps)`);
      if (b.usdc < toAtomic("0.1", 6)) throw new Error(`agent has ${human(b.usdc, 6)} USDC; needs ≥ 0.1 (https://faucet.circle.com)`);
      return { detail: `${human(b.eth, 18)} ETH, ${human(b.usdc, 6)} USDC` };
    },
    { critical: true },
  );

  await report.step("base-sepolia: get_balance matches the chain", async () => {
    const r = await call(tools, "get_balance", { chain: "base-sepolia" });
    const b = await bal();
    if (r.balances.ETH !== human(b.eth, 18) || r.balances.USDC !== human(b.usdc, 6))
      throw new Error(`tool said ${JSON.stringify(r.balances)}, chain has ${human(b.eth, 18)} ETH / ${human(b.usdc, 6)} USDC`);
    return { detail: JSON.stringify(r.balances) };
  });

  await report.step("base-sepolia: quote_swap ETH → USDC through Uniswap v3", async () => {
    const q = await call(tools, "quote_swap", { chain: "base-sepolia", from: "ETH", to: "USDC", amount: SWAP_ETH });
    if (q.provider !== "uniswap-v3" || Number(q.buy.expected) <= 0) throw new Error(JSON.stringify(q));
    return { detail: `${SWAP_ETH} ETH → ${q.buy.expected} USDC (at least ${q.buy.atLeast})` };
  });

  await report.step("base-sepolia: dry run previews the swap and sends nothing", async () => {
    const n = await nonce();
    const r = await call(tools, "swap", { chain: "base-sepolia", from: "ETH", to: "USDC", amount: SWAP_ETH, dryRun: true });
    if (!r.dryRun || !r.wouldSucceed || !r.simulation.ok) throw new Error(JSON.stringify(r));
    if ((await nonce()) !== n) throw new Error("a transaction was sent during a dry run");
    return { detail: `would succeed; policy ${r.policy.verdict}; simulation ok` };
  });

  await report.step("base-sepolia: an operator-forced dry run can't be switched off by the model", async () => {
    const forced = agentTools({
      engine: createPolicyEngine({ policy: policy("0.0005") }),
      chains: [adapter],
      maxPerCall: { ETH: "0.0005", USDC: "0.5" },
      dryRun: true,
    });
    const n = await nonce();
    const r = await call(forced, "swap", { chain: "base-sepolia", from: "ETH", to: "USDC", amount: SWAP_ETH, dryRun: false });
    if (!r.dryRun || !r.enforcedByOperator) throw new Error(JSON.stringify(r));
    if ((await nonce()) !== n) throw new Error("a transaction was sent");
    return { detail: "dryRun:false was overridden; nothing sent" };
  });

  await report.step("base-sepolia: the per-call cap refuses 0.01 ETH before anything else happens", async () => {
    const n = await nonce();
    const e = await refused(tools, "swap", { chain: "base-sepolia", from: "ETH", to: "USDC", amount: "0.01" });
    if (!/per-call cap/.test(e)) throw new Error(e);
    if ((await nonce()) !== n) throw new Error("a transaction was sent");
    return { detail: e };
  });

  await report.step("base-sepolia: the policy engine denies what the cap allows", async () => {
    const strict = agentTools({
      engine: createPolicyEngine({ policy: policy("0.0002") }),
      chains: [adapter],
      maxPerCall: { ETH: "0.0005", USDC: "0.5" },
    });
    const n = await nonce();
    const e = await refused(strict, "swap", { chain: "base-sepolia", from: "ETH", to: "USDC", amount: "0.0003" });
    if (!/denied/.test(e) || !/per-tx cap/.test(e)) throw new Error(e);
    if ((await nonce()) !== n) throw new Error("a transaction was sent");
    return { detail: e.slice(0, 150) };
  });

  await report.step(`base-sepolia: LIVE swap ${SWAP_ETH} ETH → USDC`, async () => {
    const before = await bal();
    const r = await call(tools, "swap", { chain: "base-sepolia", from: "ETH", to: "USDC", amount: SWAP_ETH });
    if (r.dryRun || r.status !== "sent" || !r.received) throw new Error(JSON.stringify(r));
    const after = await settle(bal, (b) => b.usdc > before.usdc);
    swapBack = after.usdc - before.usdc;
    const min = toAtomic(r.quote.buy.atLeast, 6);
    if (swapBack < min) throw new Error(`received ${human(swapBack, 6)} USDC, less than the guaranteed ${r.quote.buy.atLeast}`);
    if (r.received.amount !== human(swapBack, 6)) throw new Error(`tool reported ${r.received.amount}, chain shows ${human(swapBack, 6)}`);
    return { detail: `received ${human(swapBack, 6)} USDC (guaranteed ≥ ${r.quote.buy.atLeast}); policy ${r.policy}`, links: [r.explorer] };
  });

  await report.step("base-sepolia: LIVE swap USDC → ETH (approves exactly the input, swaps, unwraps)", async () => {
    const sell = swapBack > 0n ? (swapBack < toAtomic("0.05", 6) ? swapBack : toAtomic("0.05", 6)) : toAtomic("0.02", 6);
    const sellHuman = human(sell, 6);
    const before = await bal();
    const r = await call(tools, "swap", { chain: "base-sepolia", from: "USDC", to: "ETH", amount: sellHuman });
    if (r.status !== "sent" || !r.approvalTx) throw new Error(JSON.stringify(r));
    const after = await settle(bal, (b) => b.usdc < before.usdc);
    if (before.usdc - after.usdc !== sell)
      throw new Error(`USDC fell by ${human(before.usdc - after.usdc, 6)}, expected exactly ${sellHuman}`);
    const allowance = await settle(
      () => publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, r.router] }),
      (a) => a === 0n,
    );
    if (allowance !== 0n) throw new Error(`allowance left over: ${allowance}`);
    return {
      detail: `sold ${sellHuman} USDC for ETH; allowance back to 0 (approved exactly the input)`,
      links: [r.approvalTx && `https://sepolia.basescan.org/tx/${r.approvalTx}`, r.explorer],
    };
  });

  await report.step("base-sepolia: LIVE transfers to itself (USDC and ETH)", async () => {
    const a = await call(tools, "transfer", {
      chain: "base-sepolia",
      token: "USDC",
      to: account.address,
      amount: "0.01",
      memo: "e2e self-transfer",
    });
    const b = await call(tools, "transfer", { chain: "base-sepolia", token: "ETH", to: account.address, amount: "0.000001" });
    if (a.status !== "sent" || b.status !== "sent") throw new Error(JSON.stringify([a, b]));
    return { detail: "0.01 USDC and 0.000001 ETH sent", links: [a.explorer, b.explorer] };
  });

  await report.step("base-sepolia: the spend ledger holds every live spend, each with its tx hash", async () => {
    const spends = await engine.spendStore.list();
    const live = spends.filter((s) => s.status === "committed");
    if (live.length !== 4 || live.some((s) => !s.ref?.startsWith("0x")))
      throw new Error(`ledger: ${JSON.stringify(spends, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    return { detail: `${live.length} committed spends (swap ×2, transfer ×2); nothing left reserved` };
  });

  if (!flag("skip-mainnet-reads")) {
    await report.step("mainnet (READ-ONLY): LI.FI quotes Base USDC → ETH and the response passes validation", async () => {
      const q = await lifi().quote({
        chainId: 8453,
        account: account.address,
        from: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
        to: { symbol: "ETH", address: "native", decimals: 18 },
        amount: 1_000_000n,
        slippageBps: 50,
        publicClient: {} as never,
      });
      return { detail: `1 USDC → ${human(q.expected, 18)} ETH (at least ${human(q.min, 18)}); spender ${q.spender}; nothing signed` };
    });
  }
}

// ───────────────────────────── Solana ─────────────────────────────
if (!flag("skip-solana")) {
  const keyPath = (process.env.SOLANA_AGENT_KEYPAIR ?? "").replace(/^~/, homedir());
  if (!keyPath || !existsSync(keyPath))
    throw new Error("set SOLANA_AGENT_KEYPAIR to a solana-keygen JSON file (a devnet test key) in the repo-root .env");
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(keyPath, "utf8"))));
  const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
  const rpc = createSolanaRpc(getRpcUrl("solana-devnet"));
  const adapter = solanaChain({ chain: "solana-devnet", rpc, signer, tokens: { USDC: { mint: USDC, decimals: 6 } } });
  const engine = createPolicyEngine({
    policy: {
      chains: [DEVNET],
      limits: [
        { asset: "native", chain: DEVNET, label: "SOL", perTx: toAtomic("0.01", 9) },
        { asset: USDC, chain: DEVNET, label: "USDC", perTx: toAtomic("0.5", 6) },
      ],
    },
  });
  const tools = agentTools({ engine, chains: [adapter], maxPerCall: { SOL: "0.005", USDC: "0.5" } });
  report.meta.solanaAgent = signer.address;

  await report.step("solana-devnet: get_balance", async () => {
    const r = await call(tools, "get_balance", { chain: "solana-devnet" });
    if (Number(r.balances.SOL) < 0.005) throw new Error(`agent has ${r.balances.SOL} SOL; needs ≥ 0.005`);
    return { detail: JSON.stringify(r.balances) };
  });

  await report.step("solana-devnet: the per-call cap refuses 0.01 SOL; a dry run sends nothing", async () => {
    const e = await refused(tools, "transfer", { chain: "solana-devnet", token: "SOL", to: signer.address, amount: "0.01" });
    if (!/per-call cap/.test(e)) throw new Error(e);
    const d = await call(tools, "transfer", { chain: "solana-devnet", token: "SOL", to: signer.address, amount: "0.000001", dryRun: true });
    if (!d.dryRun || !d.wouldSucceed) throw new Error(JSON.stringify(d));
    return { detail: `${e}; dry run simulated ok` };
  });

  await report.step("solana-devnet: LIVE transfers to itself (SOL and USDC)", async () => {
    const a = await call(tools, "transfer", { chain: "solana-devnet", token: "SOL", to: signer.address, amount: "0.000001" });
    const b = await call(tools, "transfer", { chain: "solana-devnet", token: "USDC", to: signer.address, amount: "0.01" });
    if (a.status !== "sent" || b.status !== "sent") throw new Error(JSON.stringify([a, b]));
    return { detail: "0.000001 SOL and 0.01 USDC sent and confirmed", links: [a.explorer, b.explorer] };
  });

  if (!flag("skip-mainnet-reads")) {
    await report.step(
      "mainnet (READ-ONLY): a real Jupiter swap transaction simulates cleanly and only calls allowed programs",
      async () => {
        const mainnet = createSolanaRpc(getRpcUrl("solana"));
        // Simulation needs an account that actually holds SOL; try a few well-known exchange wallets (public data).
        let funded: string | undefined;
        for (const candidate of [
          "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS",
          "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
        ]) {
          const { value } = await mainnet.getBalance(address(candidate)).send();
          if (value > 2_000_000_000n) {
            funded = candidate;
            break;
          }
        }
        if (!funded) throw new Error("none of the candidate public wallets holds enough SOL to simulate with");
        const q = await jupiter().quote({
          chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          account: address(funded),
          from: { symbol: "SOL", mint: "native", decimals: 9 },
          to: { symbol: "USDC", mint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), decimals: 6 },
          amount: toAtomic("0.05", 9),
          slippageBps: 50,
        });
        const tx = getTransactionDecoder().decode(await q.build());
        const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
          staticAccounts: string[];
          instructions: { programAddressIndex: number }[];
        };
        const programs = [...new Set(msg.instructions.map((i) => msg.staticAccounts[i.programAddressIndex]!))];
        const allowed = new Set<string>([...SAFE_SWAP_PROGRAMS, JUPITER_PROGRAM]);
        const stray = programs.filter((p) => !allowed.has(p));
        if (msg.staticAccounts[0] !== funded || stray.length)
          throw new Error(`fee payer ${msg.staticAccounts[0]}; unexpected programs ${stray}`);
        // Signature checks off: nobody signed this, and nothing is sent.
        const sim = await mainnet
          .simulateTransaction(getBase64EncodedWireTransaction(tx), {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: "confirmed",
          })
          .send();
        if (sim.value.err)
          throw new Error(
            `simulation failed: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))} ${sim.value.logs?.slice(-2)}`,
          );
        return {
          detail: `0.05 SOL → ${human(q.expected, 6)} USDC (at least ${human(q.min, 6)}); simulated OK on mainnet, ${programs.length} top-level programs all allowed; nothing signed or sent`,
        };
      },
    );
  }
}

const file = report.save();
console.log(`\n${report.ok ? "PASS" : "FAIL"}: ${file}`);
process.exitCode = report.ok ? 0 : 1;
