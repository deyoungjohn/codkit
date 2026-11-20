import { existsSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const packages = join(import.meta.dirname, "../../packages");

/**
 * Serve @codkit/* from the workspace source, not their built dist, so editing a package shows up
 * here without a rebuild. (The published builds are checked by `pnpm smoke:npm`.)
 */
function codkitSource(): Plugin {
  return {
    name: "codkit-source",
    enforce: "pre",
    resolveId(id) {
      const m = /^@codkit\/([a-z-]+)(?:\/(.+))?$/.exec(id);
      if (!m) return null;
      const [, pkg, sub = "index"] = m;
      for (const file of [sub, `${sub}.ts`, `${sub}.tsx`]) {
        const path = join(packages, pkg!, "src", file);
        if (existsSync(path) && !path.endsWith("/src")) return path;
      }
      return null;
    },
  };
}

export default defineConfig({ plugins: [codkitSource(), react()], envDir: "../.." });
