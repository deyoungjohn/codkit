/**
 * Drive the example dapp in headless Chromium with test wallets:
 * connect EVM + Solana through the ConnectButton, sign on each, send a transfer on each.
 *
 *   pnpm --filter example-dapp-vite e2e              # local: anvil + a stub Solana RPC
 *   pnpm --filter example-dapp-vite e2e -- --testnet # real self-transfers on Base Sepolia + Solana devnet
 *
 * Testnet mode signs with the e2e agent keys from the repo-root .env (AGENT_PRIVATE_KEY,
 * SOLANA_AGENT_KEYPAIR) and sends tiny amounts to the same address, so only fees are spent.
 *
 * Needs Foundry (anvil) and a Playwright Chromium (`npx playwright@1.64.1 install chromium`).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createServer as createHttpServer } from "node:http";
import { type AddressInfo, connect, createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRpcUrl } from "@codkit/config";
import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  getBase58Encoder,
  getPublicKeyFromAddress,
  verifySignature,
} from "@solana/kit";
import { chromium } from "playwright-core";
import { createPublicClient, http, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { createServer as createViteServer } from "vite";
import { installWallets } from "./wallets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.env.E2E_SCREENSHOT_DIR ?? join(root, "e2e", "out");
// Anvil dev account #0 and #1 (public, local only)
const ALICE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const BOB = "0x70997970C51812dC3A010c7d01b54e0aEA6e9Cc8";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createNetServer();
    s.listen(0, () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

async function startAnvil() {
  const port = await freePort();
  const proc = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    const up = await new Promise<boolean>((r) => {
      const s = connect(port, "127.0.0.1", () => {
        s.end();
        r(true);
      });
      s.on("error", () => r(false));
    });
    if (up) return { url: `http://127.0.0.1:${port}`, stop: () => proc.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("anvil did not start");
}

/** Stub Solana RPC: a blockhash, and "confirmed" for every signature. */
async function stubSolanaRpc() {
  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "*");
      if (req.method === "OPTIONS") return res.end(); // the browser's CORS preflight
      const { id, method, params } = JSON.parse(body);
      const context = { slot: 1 };
      const result =
        method === "getLatestBlockhash"
          ? { context, value: { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM", lastValidBlockHeight: 100 } }
          : method === "getSignatureStatuses"
            ? {
                context,
                value: (params[0] as string[]).map(() => ({
                  slot: 1,
                  confirmations: 1,
                  err: null,
                  confirmationStatus: "confirmed",
                  status: { Ok: null },
                })),
              }
            : undefined;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code: -32601, message: method } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const step = async (name: string, fn: () => Promise<void>) => {
  process.stdout.write(`• ${name} … `);
  const t = Date.now();
  await fn();
  console.log(`ok (${Date.now() - t}ms)`);
};

const testnet = process.argv.includes("--testnet");
const anvil = testnet ? undefined : await startAnvil();
const solRpc = testnet ? undefined : await stubSolanaRpc();

let evmAccount = ALICE;
let evmRpc = anvil?.url ?? "";
let evmTo: `0x${string}` = BOB;
let solSigner = await generateKeyPairSigner();
let solTo = (await generateKeyPairSigner()).address as string;
if (testnet) {
  const key = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  const kp = (process.env.SOLANA_AGENT_KEYPAIR ?? "").replace(/^~/, homedir());
  if (!key || !kp) throw new Error("testnet mode needs AGENT_PRIVATE_KEY and SOLANA_AGENT_KEYPAIR in the repo-root .env");
  evmAccount = privateKeyToAccount(key);
  evmRpc = getRpcUrl("base-sepolia");
  evmTo = evmAccount.address; // self-transfer: only gas is spent
  solSigner = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(kp, "utf8"))));
  solTo = solSigner.address;
}
const solanaDevnet = createSolanaRpc(getRpcUrl("solana-devnet"));

Object.assign(
  process.env,
  testnet
    ? { VITE_EVM_CHAINS: "base-sepolia", VITE_SOLANA_CHAINS: "solana-devnet" }
    : {
        VITE_EVM_CHAINS: "anvil",
        VITE_ANVIL_RPC_URL: anvil!.url,
        VITE_SOLANA_CHAINS: "solana-devnet",
        VITE_SOLANA_DEVNET_RPC_URL: solRpc!.url,
      },
);
const vite = await createViteServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { port: await freePort(), host: "127.0.0.1" },
  logLevel: "error",
});
await vite.listen();
const appUrl = vite.resolvedUrls!.local[0]!;
// the full Chromium build in new-headless mode (no separate headless-shell download needed)
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();
const consoleErrors: string[] = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
if (process.env.E2E_DEBUG) page.on("console", (m) => console.log(`[page:${m.type()}] ${m.text()}`));
let failed = false;

try {
  const recorded = await installWallets(
    page,
    { account: evmAccount, chain: testnet ? baseSepolia : foundry, rpcUrl: evmRpc },
    {
      signer: solSigner,
      ...(testnet && {
        send: async (b64: string) => {
          await solanaDevnet.sendTransaction(b64 as never, { encoding: "base64", preflightCommitment: "confirmed" }).send();
        },
      }),
    },
  );
  await page.goto(appUrl);
  if (process.env.E2E_DEBUG)
    console.log(
      "[debug]",
      await page.evaluate(() => ({
        evm: typeof (window as never as Record<string, unknown>).__codkitEvm,
        sol: typeof (window as never as Record<string, unknown>).__codkitSolana,
      })),
    );

  await step("connect the EVM wallet through the picker (EIP-6963)", async () => {
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await page.getByRole("button", { name: /Codkit Test EVM/ }).click();
    await page.getByTestId("evm-status").getByText("Codkit Test EVM").waitFor();
  });

  await step("the picker closed after connecting; reopened, it starts on Solana (Wallet Standard)", async () => {
    await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 5_000 }); // closes once connect() resolves
    await page.getByRole("button", { name: "Add wallet" }).click();
    const tab = page.getByRole("tab", { name: "Solana" });
    if ((await tab.getAttribute("aria-selected")) !== "true") throw new Error("picker did not switch to the Solana tab");
    await page.screenshot({ path: join(shots, "picker.png") });
    await page.getByRole("button", { name: /Codkit Test Solana/ }).click();
    await page.getByTestId("solana-status").getByText("Codkit Test Solana").waitFor();
  });

  const evm = page.getByRole("region", { name: "evm panel" });
  const sol = page.getByRole("region", { name: "solana panel" });

  await step("sign a message on EVM; the signature verifies", async () => {
    await evm.getByRole("button", { name: "Sign message" }).click();
    const sig = (await page.getByTestId("evm-signature").textContent()) as `0x${string}`;
    if (!(await verifyMessage({ address: evmAccount.address, message: "Hello from codkit", signature: sig })))
      throw new Error("bad EVM signature");
  });

  await step("sign a message on Solana; the signature verifies", async () => {
    await sol.getByRole("button", { name: "Sign message" }).click();
    const sig = (await page.getByTestId("solana-signature").textContent())!;
    const key = await getPublicKeyFromAddress(address(solSigner.address));
    const ok = await verifySignature(key, getBase58Encoder().encode(sig) as never, new TextEncoder().encode("Hello from codkit"));
    if (!ok) throw new Error("bad Solana signature");
  });

  await step(
    testnet
      ? "send 0.000001 ETH to self on Base Sepolia; the toast confirms"
      : "send 0.5 ETH on EVM; the toast confirms and the balance moves",
    async () => {
      const pc = createPublicClient({ chain: testnet ? baseSepolia : foundry, transport: http(evmRpc) });
      const before = await pc.getBalance({ address: evmTo });
      await evm.getByLabel("Recipient").fill(evmTo);
      await evm.getByLabel("Amount").fill(testnet ? "0.000001" : "0.5");
      await evm.getByRole("button", { name: "Send" }).click();
      await page.locator(".ck-toast-confirmed").first().waitFor({ timeout: 90_000 });
      if (testnet) console.log(`\n    ${await page.locator(".ck-toast").first().getByRole("link", { name: "View" }).getAttribute("href")}`);
      else if ((await pc.getBalance({ address: evmTo })) - before !== 500_000_000_000_000_000n)
        throw new Error("BOB did not receive 0.5 ETH");
    },
  );

  await step(
    testnet
      ? "send 0.000001 SOL to self on devnet; the toast confirms"
      : "send 0.001 SOL on Solana; the wallet pays the fee and the toast confirms",
    async () => {
      await sol.getByLabel("Recipient").fill(solTo);
      await sol.getByLabel("Amount").fill(testnet ? "0.000001" : "0.001");
      await sol.getByRole("button", { name: "Send" }).click();
      await page.locator(".ck-toast-confirmed").nth(1).waitFor({ timeout: 90_000 });
      if (testnet) console.log(`\n    ${await page.locator(".ck-toast").nth(1).getByRole("link", { name: "View" }).getAttribute("href")}`);
      const tx = recorded.solana[0];
      if (
        !tx ||
        tx.feePayer !== solSigner.address ||
        tx.programs[0] !== "11111111111111111111111111111111" ||
        tx.chain !== "solana:devnet"
      ) {
        throw new Error(`unexpected Solana transaction ${JSON.stringify(tx)}`);
      }
    },
  );

  await step("no page errors", async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.join("\n"));
  });

  await page.screenshot({ path: join(shots, `dapp-vite${testnet ? "-testnet" : ""}.png`), fullPage: true });
  console.log(`\nPASS — screenshot: ${join(shots, `dapp-vite${testnet ? "-testnet" : ""}.png`)}`);
} catch (e) {
  failed = true;
  console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
  await page.screenshot({ path: join(shots, "dapp-vite-failure.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await vite.close();
  anvil?.stop();
  solRpc?.close();
  process.exit(failed ? 1 : 0);
}
