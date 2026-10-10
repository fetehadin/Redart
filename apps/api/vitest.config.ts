import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    // Test files share one database and truncate it between tests, so they run one at a time.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
});
