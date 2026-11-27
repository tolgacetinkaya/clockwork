import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../src/main.js";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
it("lists presets without credentials or model calls", async () => {
  const result = await runCli(["providers"], process.cwd());
  expect(result.code).toBe(0);
  expect(Object.keys(JSON.parse(result.out).presets)).toEqual(["zai", "qwen", "deepseek", "kimi"]);
});
it("validates explicit host configuration and catches asynchronous errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cw-providers-")); dirs.push(dir);
  const path = join(dir, "providers.json");
  await writeFile(path, JSON.stringify({ sandboxImage: "node:24", providers: { deepseek: {}, qwen: { baseUrl: "https://example.invalid/v1" } } }));
  const result = await runCli(["providers", "--providers-config", path], dir);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).enabled).toEqual(["deepseek", "qwen"]);
  expect((await runCli(["providers", "--providers-config", join(dir, "missing.json")], dir)).code).toBe(1);
  expect((await runCli(["providers", "models", "unknown", "--providers-config", path], dir)).code).toBe(1);
});
