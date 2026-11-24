/**
 * Layout check for the wallet picker, in real Chromium with N decoy wallets announced over EIP-6963.
 * jsdom/happy-dom have no layout, so this is the only place "no scrollbar" can be asserted.
 *
 *   pnpm --filter example-dapp-vite e2e:picker
 */
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { createServer } from "vite";

const root = join(import.meta.dirname, "..");
const shots = process.env.E2E_SCREENSHOT_DIR ?? join(root, "e2e", "out");
const ALL = [
  "Rabby Wallet",
  "Binance Wallet",
  "Keplr",
  "Zerion",
  "OKX Wallet",
  "HOT Wallet",
  "Rainbow",
  "Phantom",
  "Backpack",
  "Nightly",
  "Ledger Live",
  "Frame",
  "Taho",
  "Safe Wallet",
  "Exodus",
  "Brave Wallet",
]; // none of these are in the suggestions list's names except Rabby, so MetaMask/Coinbase/Trust stay "missing"

/** Announces `names` the way wallets do. Built as a string: a function would carry the transpiler's helpers into the page. */
const decoys = (names: string[]) => `(() => {
  const icon = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxIDEnPjxyZWN0IHdpZHRoPScxJyBoZWlnaHQ9JzEnIGZpbGw9JyM3NDhmZmMnLz48L3N2Zz4=";
  const names = ${JSON.stringify(names)};
  const announce = () => names.forEach((name, i) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: Object.freeze({ info: { uuid: "decoy-" + i, name, icon, rdns: "decoy.w" + i }, provider: { request: async () => [], on() {}, removeListener() {} } }),
  })));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;

interface Measure {
  scrolls: boolean;
  rows: number;
  rowsFullyVisible: number;
  dialogInViewport: boolean;
  suggestions: string[];
  hasHeading: boolean;
  ghostInjected: boolean;
  text: string;
}

async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".ck-list");
    const dialog = document.querySelector<HTMLElement>("dialog.ck-dialog")!;
    const d = dialog.getBoundingClientRect();
    const rows = Array.from(document.querySelectorAll<HTMLElement>("dialog .ck-list button.ck-option"));
    const box = list?.getBoundingClientRect();
    return {
      scrolls: !!list && list.scrollHeight > list.clientHeight + 1,
      rows: rows.length,
      rowsFullyVisible: rows.filter((r) => box && r.getBoundingClientRect().bottom <= box.bottom + 1).length,
      dialogInViewport: d.top >= 0 && d.bottom <= window.innerHeight,
      suggestions: Array.from(document.querySelectorAll("dialog a.ck-suggestion")).map((a) => a.textContent ?? ""),
      hasHeading: !!document.querySelector(".ck-list-heading:not(:empty)"),
      ghostInjected: rows.some((r) => r.textContent?.trim() === "Injected"),
      text: (document.querySelector(".ck-panel")?.textContent ?? "").slice(0, 120),
    };
  });
}

const vite = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { port: 0, host: "127.0.0.1" },
  logLevel: "error",
});
await vite.listen();
const url = vite.resolvedUrls!.local[0]!;
const browser = await chromium.launch({ channel: "chromium" });
let failed = 0;

async function scenario(name: string, opts: { wallets: string[]; height?: number }, check: (m: Measure) => string | undefined) {
  const page = await browser.newPage({ viewport: { width: 1000, height: opts.height ?? 900 }, colorScheme: "dark" });
  await page.addInitScript({ content: decoys(opts.wallets) });
  await page.goto(url);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForTimeout(250);
  const m = await measure(page);
  const problem = check(m);
  console.log(`${problem ? "✗" : "•"} ${name} … ${problem ?? "ok"}`);
  if (problem) {
    failed++;
    console.log(`    ${JSON.stringify(m)}`);
    await page.screenshot({ path: join(shots, `picker-fail-${name.replace(/\W+/g, "-")}.png`) });
  } else if (name.startsWith("11")) {
    await page.screenshot({ path: join(shots, "picker-11.png") });
  }
  await page.close();
}

try {
  await scenario("11 wallets: no scrollbar, no suggestions", { wallets: ALL.slice(0, 11) }, (m) =>
    m.scrolls || m.rows !== 11 || m.rowsFullyVisible !== 11
      ? `scrolls=${m.scrolls}, ${m.rowsFullyVisible}/${m.rows} rows visible`
      : m.hasHeading || m.suggestions.length
        ? `suggestions shown: ${m.suggestions}`
        : !m.dialogInViewport
          ? "dialog off screen"
          : undefined,
  );
  await scenario("14 wallets: still no scrollbar on a tall window", { wallets: ALL.slice(0, 14), height: 1000 }, (m) =>
    m.scrolls ? `scrolls with ${m.rows} rows` : !m.dialogInViewport ? "dialog off screen" : undefined,
  );
  await scenario("2 wallets: install suggestions, no scrollbar", { wallets: ["Rabby Wallet", "OKX Wallet"] }, (m) =>
    m.scrolls
      ? "scrolls"
      : !m.hasHeading
        ? "no 'Get a wallet' heading"
        : m.suggestions.map((s) => s.replace(/^\S/, "").replace(/Install ↗$/, "")).join(",") !== "MetaMask,Coinbase Wallet,Trust Wallet"
          ? `suggestions: ${m.suggestions}`
          : undefined,
  );
  await scenario("exactly 3 wallets: no suggestions", { wallets: ["Rabby Wallet", "OKX Wallet", "HOT Wallet"] }, (m) =>
    m.hasHeading || m.suggestions.length ? `suggestions shown: ${m.suggestions}` : undefined,
  );
  await scenario("no wallets: explains, offers installs, no phantom 'Injected' row", { wallets: [] }, (m) =>
    m.ghostInjected
      ? "lists a generic 'Injected' wallet that isn't there"
      : m.rows !== 0
        ? `${m.rows} rows`
        : !/No Ethereum & EVM wallet found/.test(m.text)
          ? `text: ${m.text}`
          : m.suggestions.length < 3
            ? `suggestions: ${m.suggestions}`
            : undefined,
  );
  await scenario("short window: the list scrolls instead of the dialog overflowing", { wallets: ALL.slice(0, 14), height: 480 }, (m) =>
    !m.scrolls ? "expected the list to scroll in a 480px window" : !m.dialogInViewport ? "dialog taller than the window" : undefined,
  );
} finally {
  await browser.close();
  await vite.close();
}
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exit(failed ? 1 : 0);
