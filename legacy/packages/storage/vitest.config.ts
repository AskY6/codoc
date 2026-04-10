import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Storage tests share a single PostgreSQL database and truncate tables in
    // beforeEach. Force serial execution to avoid cross-file FK contention.
    fileParallelism: false,
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },
  },
});
