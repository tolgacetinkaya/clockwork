import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readControlFile, writeControl } from "../src/state.js";
import type { ControlState } from "../src/state.js";

describe("control file integrity", () => {
  let project: string;
  let path: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "clockwork-control-"));
    await mkdir(join(project, ".teamsmith"));
    path = join(project, ".teamsmith/control.json");
  });
  afterEach(async () => { await rm(project, { recursive: true, force: true }); });

  it("initializes a missing channel and preserves both flags across partial patches", async () => {
    expect(await readControlFile(project)).toEqual({ paused: false, kill: false });
    expect(await writeControl(project, { kill: true })).toEqual({ paused: false, kill: true });
    expect(await writeControl(project, { paused: true })).toEqual({ paused: true, kill: true });
    expect(await writeControl(project, { kill: false })).toEqual({ paused: true, kill: false });
  });

  it.each(["{", "null", "[]", "true", "42", '"text"', "{}", '{"kill":true}',
    '{"paused":false,"kill":"true"}', '{"paused":null,"kill":true}'])
  ("rejects invalid stored controls without rewriting: %s", async (raw) => {
    await writeFile(path, raw);
    await expect(readControlFile(project)).rejects.toThrow();
    await expect(writeControl(project, { paused: true })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(raw);
  });

  it("rejects read failures rather than treating them as missing", async () => {
    await mkdir(path);
    await expect(readControlFile(project)).rejects.toThrow();
    await expect(writeControl(project, { paused: true })).rejects.toThrow();
  });

  it.each([null, [], true, { paused: null }, { kill: "false" }, { kill: undefined }])
  ("rejects invalid direct patches without changing valid controls: %j", async (patch) => {
    const raw = '{"paused":true,"kill":true}';
    await writeFile(path, raw);
    await expect(writeControl(project, patch as Partial<ControlState>)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(raw);
  });
});
