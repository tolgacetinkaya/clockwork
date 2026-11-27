import { expect, it } from "vitest";
import { buildExecArgs, CodexAdapter } from "../src/index.js";
const request = { workspace: ".", mode: "verify" as const, prompt: "Review", signal: new AbortController().signal };
it("scopes an optional threshold to the worker while preserving verifier isolation", () => {
  const defaults = buildExecArgs(request, "schema.json");
  expect(defaults.join(" ")).not.toContain("model_auto_compact_token_limit");
  const scoped = buildExecArgs(request, "schema.json", undefined, 600000);
  expect(scoped).toContain("model_auto_compact_token_limit=600000");
  expect(scoped).toContain("--ephemeral"); expect(scoped).toContain("read-only"); expect(scoped).toContain("--ignore-user-config");
  expect(scoped.join(" ")).not.toContain("model_context_window");
});
it.each([0, -1, NaN, Infinity, 10.5, 10000001])("rejects invalid compact limit %s before spawning", n => {
  expect(() => new CodexAdapter({ autoCompactTokenLimit: n })).toThrow();
  expect(() => buildExecArgs(request, "schema.json", undefined, n)).toThrow();
});
