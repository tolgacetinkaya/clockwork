import { expect, it } from "vitest";
import { chatPolicy } from "../src/claude-chat.js";
import { runCli } from "../src/main.js";
it("requires explicit opt-in and validates CLI bounds", () => {
  expect(chatPolicy({}).keepWarm.enabled).toBe(false);
  expect(chatPolicy({ "keep-warm": "true", "compact-at": "600000", "cache-ttl": "1h", "warm-max-calls": "3" })).toMatchObject({ autoCompactTokens: 600000, keepWarm: { enabled: true, intervalMs: 3000000, maxCalls: 3 } });
  const invalid: Record<string, string>[] = [{ "warm-interval-minutes": "0" }, { "keep-warm": "yes" }, { once: "true", "keep-warm": "true" }, { "compact-at": "600k" }, { invented: "true" }];
  for (const f of invalid) expect(() => chatPolicy(f)).toThrow();
});
it("rejects missing executable and unknown subcommand before making calls", async () => {
  expect((await runCli(["claude", "chat", "--prompt", "hello"], process.cwd())).code).toBe(1);
  expect((await runCli(["claude", "warm"], process.cwd())).code).toBe(1);
});
