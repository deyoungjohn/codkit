/**
 * SSR check: the production build hydrates without warnings, a wallet connects through the
 * picker, and the connection survives a reload (wagmi cookie storage).
 *
 *   pnpm --filter example-dapp-next build && pnpm --filter example-dapp-next e2e
 */
import { spawn } from "node:child_process";
import { type AddressInfo, connect, createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSigner } from "@solana/kit";
import { chromium } from "playwright-core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { installWallets } from "../../dapp-vite/e2e/wallets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = await new Promise<number>((r) => {
  const s = createServer();
  s.listen(0, () => {
    const p = (s.address() as AddressInfo).port;
    s.close(() => r(p));
  });
});
const next = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], { cwd: root, stdio: "ignore" });
for (let i = 0; i < 100; i++) {
  const up = await new Promise<boolean>((r) => {
    const s = connect(port, "127.0.0.1", () => {
      s.end();
      r(true);
    });
    s.on("error", () => r(false));
  });
  if (up) break;
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});
let failed = false;
try {
  await installWallets(
    page,
    { account: privateKeyToAccount(generatePrivateKey()), chain: baseSepolia, rpcUrl: "https://sepolia.base.org" },
    { signer: await generateKeyPairSigner() },
  );
  const url = `http://127.0.0.1:${port}/`;
  const html = (await (await fetch(url)).text()).replaceAll("<!-- -->", ""); // React marks text-node boundaries
  if (!html.includes("Connect wallet") || !html.includes("evm: disconnected")) throw new Error("server HTML is missing the wallet UI");
  console.log("• server-rendered HTML contains the wallet UI … ok");

  await page.goto(url);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: /Codkit Test EVM/ }).click();
  await page.getByTestId("status").getByText("evm: connected on Base Sepolia").waitFor();
  console.log("• connect through the picker after hydration … ok");

  await page.reload();
  await page.getByTestId("status").getByText("evm: connected on Base Sepolia").waitFor({ timeout: 15_000 });
  console.log("• connection restored after a reload (cookie storage) … ok");

  if (problems.length) throw new Error(`console errors:\n${problems.join("\n")}`);
  console.log("• no hydration or console errors … ok");

  // Real browsers have wallet extensions that announce themselves (EIP-6963) before the page's scripts run,
  // so the first client render sees wallets the server never did. That must not break hydration.
  const early = await browser.newPage();
  const earlyProblems: string[] = [];
  early.on("pageerror", (e) => earlyProblems.push(e.message));
  early.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && earlyProblems.push(m.text()));
  await early.addInitScript({
    content: `(() => {
      const icon = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxIDEnPjxyZWN0IHdpZHRoPScxJyBoZWlnaHQ9JzEnIGZpbGw9JyM3NDhmZmMnLz48L3N2Zz4=";
      const announce = () => ["Early One", "Early Two"].forEach((name, i) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info: { uuid: "early-" + i, name, icon, rdns: "early.w" + i }, provider: { request: async () => [], on() {}, removeListener() {} } }),
      })));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    })();`,
  });
  await early.goto(url);
  await early.getByRole("button", { name: "Connect wallet" }).click();
  await early.getByRole("button", { name: /Early One/ }).waitFor();
  if (earlyProblems.length) throw new Error(`wallets announced before hydration broke it:\n${earlyProblems.join("\n")}`);
  console.log("• wallets announced before hydration (browser extensions) … ok\n\nPASS");
} catch (e) {
  failed = true;
  console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  next.kill();
  process.exit(failed ? 1 : 0);
}
