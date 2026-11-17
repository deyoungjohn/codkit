/**
 * Shared tsup setup: entry points come from the package's `exports` map
 * (`"./evm"` → `src/adapters/evm.ts`, read off its `types` path), so the two
 * can't drift. Output: ESM `.js` + CJS `.cjs`, each with types.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "tsup";

type Target = string | { types?: string; default?: string };
type ExportEntry = string | { import?: Target; require?: Target; types?: string };

export function packageConfig(dir: string, overrides: Options = {}): Options {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { exports: Record<string, ExportEntry> };
  const entry: Record<string, string> = {};
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key === "./package.json") continue;
    const types = typeOf(value);
    if (!types?.startsWith("./dist/") || !types.endsWith(".d.ts")) throw new Error(`${key}: expected ./dist/….d.ts, got ${types}`);
    const name = types.slice("./dist/".length, -".d.ts".length);
    entry[name] = `src/${name}.ts`;
  }
  return {
    entry,
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    // one copy of shared modules per format, so `instanceof` holds across subpaths
    splitting: true,
    shims: true,
    target: "es2022",
    platform: "neutral",
    outDir: "dist",
    tsconfig: "tsconfig.build.json",
    ...overrides,
  };
}

function typeOf(e: ExportEntry): string | undefined {
  if (typeof e === "string") return e.replace(/\.js$/, ".d.ts");
  if (e.types) return e.types;
  const imp = e.import;
  return typeof imp === "object" ? imp.types : undefined;
}
