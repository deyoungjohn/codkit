import { defineConfig } from "vitest/config";

export default defineConfig({
  // anvil integration tests send real transactions; CI runners can be slow
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
