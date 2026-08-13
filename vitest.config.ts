import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globalSetup: ["./tests/support/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Each file gets its own in-memory database, so files are safe to
    // parallelise. Within a file, tests run sequentially by default.
    pool: "threads",
  },
});
