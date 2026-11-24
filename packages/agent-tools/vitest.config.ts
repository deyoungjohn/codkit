import { defineConfig } from "vitest/config";

export default defineConfig({
  // tests send real transactions to a local Anvil; CI runners can be slow
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
