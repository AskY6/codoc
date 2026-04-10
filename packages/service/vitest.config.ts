import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Service tests share a single PostgreSQL database and truncate tables in
    // beforeEach. Running test files in parallel causes cross-contamination
    // (FK violations when one file deletes rows another file is still using).
    // Force single-file serial execution.
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
      },
      forks: {
        singleFork: true,
      },
    },
  },
});
