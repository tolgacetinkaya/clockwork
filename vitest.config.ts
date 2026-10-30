import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real Git/worktree suites spawn many child processes. Bound Windows file-level
    // concurrency to prevent host contention from exhausting per-test deadlines.
    ...(process.platform === "win32" ? { maxWorkers: 2 } : {}),
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
  },
});
