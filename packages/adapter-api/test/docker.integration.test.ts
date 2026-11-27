import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DockerSandbox } from "../src/sandbox.js";

const image = process.env.CLOCKWORK_TEST_SANDBOX_IMAGE;
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
it.skipIf(!image)("enforces real Docker read-only, network, host-environment and cleanup boundaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cw-api-sandbox-")); dirs.push(dir);
  await chmod(dir, 0o777);
  await writeFile(join(dir, "original.txt"), "original");
  const box = new DockerSandbox(image!);
  const signal = new AbortController().signal;
  await box.check(signal);
  const write = await box.run(dir, false, "printf created > result.txt", signal);
  expect(write.exitCode).toBe(0);
  expect(await readFile(join(dir, "result.txt"), "utf8")).toBe("created");
  const denied = await box.run(dir, true, "printf changed > original.txt", signal);
  expect(denied.exitCode).not.toBe(0);
  expect(await readFile(join(dir, "original.txt"), "utf8")).toBe("original");
  const isolated = await box.run(dir, true, "test ! -S /var/run/docker.sock && test -z \"$DEEPSEEK_API_KEY\" && test $(wc -l < /proc/net/route) -eq 1", signal);
  expect(isolated.exitCode).toBe(0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try { await expect(box.run(dir, false, "sleep 30; touch should-not-exist", controller.signal)).rejects.toThrow(); }
  finally { clearTimeout(timer); }
  await expect(readFile(join(dir, "should-not-exist"))).rejects.toThrow();
}, 60000);
