import type { NextConfig } from "next";

const config: NextConfig = {
  // the agent runtime is server-only and keeps in-memory state
  serverExternalPackages: ["@x402/core", "@x402/evm", "@x402/fetch", "@x402/hono"],
};

export default config;
