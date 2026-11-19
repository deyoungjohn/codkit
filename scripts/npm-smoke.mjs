#!/usr/bin/env node
/**
 * Prove the published packages install and work from npm: a fresh project outside the
 * workspace installs @codkit/* (latest, or --tag) with their peers, then every entry
 * point is loaded with import() and require(), and a consumer typechecks with
 * moduleResolution bundler (Next.js / Vite) and nodenext.
 *
 *   node scripts/npm-smoke.mjs [--only config,wallet,ui] [--keep]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const all = ["policy", "pay", "contracts", "receipts", "mcp", "feed", "config", "wallet", "ui"];
const only = arg("only")?.split(",") ?? all;
// peers the entry points need at import time
const peers = [
  "viem@^2.48.0",
  "wagmi@^3.0.0",
  "@tanstack/react-query@^5.0.0",
  "@solana/kit@^8.0.0",
  "react@^19.0.0",
  "react-dom@^19.0.0",
  "@modelcontextprotocol/sdk@^1.30.0",
  "@x402/mcp@~2.28.0",
  "@x402/svm@~2.28.0",
  "@x402/hono@~2.28.0",
  "@x402/express@~2.28.0",
  "hono@^4.6.0",
  "express@^5.0.0",
  "@mysten/sui@^2.0.0",
  "typescript@~5.9.0",
  "@types/react@^19.0.0",
];

const dir = mkdtempSync(join(tmpdir(), "codkit-npm-smoke-"));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
let failed = 0;
try {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
  process.stdout.write(`installing ${only.map((p) => `@codkit/${p}`).join(" ")} from npm … `);
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...only.map((p) => `@codkit/${p}`), ...peers]);
  console.log("ok");

  for (const p of only) {
    const pkgDir = join(dir, "node_modules", "@codkit", p);
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const bad = Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies }).filter(([, v]) => String(v).startsWith("workspace:"));
    if (bad.length) {
      failed++;
      console.log(`✗ @codkit/${p}@${pkg.version}: unresolved workspace ranges ${bad.map(([k]) => k).join(", ")}`);
    }
    for (const key of Object.keys(pkg.exports)) {
      if (key === "./package.json" || key.endsWith(".css")) continue;
      const spec = `@codkit/${p}${key.slice(1)}`;
      const script = `const m = await import(${JSON.stringify(spec)}); const r = (await import("node:module")).createRequire(import.meta.url)(${JSON.stringify(spec)}); if (!Object.keys(m).length || !Object.keys(r).length) throw new Error("empty");`;
      try {
        // browser-only entry points (wallet, ui) still load in Node: they only touch window when mounted
        run("node", ["--input-type=module", "-e", script]);
        console.log(`✓ ${spec}@${pkg.version} (import + require)`);
      } catch (e) {
        failed++;
        console.log(
          `✗ ${spec}: ${
            String(e.stderr || e.message)
              .split("\n")
              .find((l) => /Error/.test(l)) ?? e.message
          }`,
        );
      }
    }
  }

  const imports = only.map((p, i) => `import * as m${i} from "@codkit/${p}";`).join("\n");
  writeFileSync(join(dir, "consumer.ts"), `${imports}\nexport const all = [${only.map((_, i) => `m${i}`).join(", ")}];\n`);
  for (const mode of ["bundler", "nodenext"]) {
    const module = mode === "bundler" ? "esnext" : "nodenext";
    try {
      run("npx", [
        "tsc",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "es2022",
        "--lib",
        "es2022,dom",
        "--module",
        module,
        "--moduleResolution",
        mode,
        "--jsx",
        "react-jsx",
        "consumer.ts",
      ]);
      console.log(`✓ consumer typechecks (moduleResolution ${mode})`);
    } catch (e) {
      failed++;
      console.log(`✗ consumer typecheck (${mode}):\n${String(e.stdout).split("\n").slice(0, 8).join("\n")}`);
    }
  }
} finally {
  if (process.argv.includes("--keep")) console.log(`kept ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exitCode = failed ? 1 : 0;
