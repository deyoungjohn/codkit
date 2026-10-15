#!/usr/bin/env node
// Publish every public workspace package whose current version isn't on npm yet.
// Run by .github/workflows/release.yml after the "Version Packages" PR is merged.
//
//   node scripts/release.mjs [--dry-run]
//
// pnpm packs each package (rewriting workspace:^ ranges to real versions); npm >= 11.5.1
// publishes the tarball. In GitHub Actions that npm authenticates with Trusted Publishing
// (OIDC — no token) and attaches provenance automatically. Packages go out in dependency
// order. The "New tag:" lines are what changesets/action reads to tag and create releases.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NPM = process.env.RELEASE_NPM ?? "npm@11.21.0";
const dryRun = process.argv.includes("--dry-run");
const root = new URL("..", import.meta.url).pathname;

const pkgs = readdirSync(join(root, "packages"))
  .map((d) => ({ dir: join(root, "packages", d), json: JSON.parse(readFileSync(join(root, "packages", d, "package.json"), "utf8")) }))
  .filter((p) => !p.json.private);

// dependency order: a package after the workspace packages it depends on
const names = new Set(pkgs.map((p) => p.json.name));
const deps = (p) => Object.keys({ ...p.json.dependencies, ...p.json.peerDependencies }).filter((d) => names.has(d));
const ordered = [];
const visit = (p, seen = new Set()) => {
  if (ordered.includes(p) || seen.has(p)) return;
  seen.add(p);
  for (const d of deps(p)) visit(pkgs.find((x) => x.json.name === d), seen);
  ordered.push(p);
};
pkgs.forEach((p) => visit(p));

const published = (name, version) =>
  spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" }).stdout.trim() === version;

const out = mkdtempSync(join(tmpdir(), "codkit-release-"));
let count = 0;
for (const p of ordered) {
  const { name, version } = p.json;
  if (published(name, version)) {
    console.log(`= ${name}@${version} already on npm`);
    continue;
  }
  execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: p.dir, stdio: ["ignore", "ignore", "inherit"] });
  const tarball = join(out, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`);
  const args = ["-y", NPM, "publish", tarball, "--access", "public", ...(dryRun ? ["--dry-run"] : [])];
  console.log(`> npx ${args.join(" ")}`);
  execFileSync("npx", args, { stdio: "inherit" });
  if (!dryRun) console.log(`🦋  New tag:  ${name}@${version}`);
  count++;
}
console.log(count ? `${dryRun ? "would publish" : "published"} ${count} package(s)` : "nothing to publish");
