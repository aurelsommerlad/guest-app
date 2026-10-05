import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite boots a WASM Postgres per test file.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
