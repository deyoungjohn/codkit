import { join } from "node:path";
import type { NextConfig } from "next";

// Share the repo-root .env (LLM keys, RPC URLs). Variables already set, or in
// apps/demo-shell/.env*, take precedence.
try {
  process.loadEnvFile(join(process.cwd(), "../../.env")); // pnpm runs scripts from apps/demo-shell
} catch {
  // no root .env
}

const config: NextConfig = {
  // the agent runtime is server-only and keeps in-memory state
  serverExternalPackages: ["@x402/core", "@x402/evm", "@x402/fetch", "@x402/hono"],
};

export default config;
