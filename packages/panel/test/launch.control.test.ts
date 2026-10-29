import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { atomicWrite, withStorageLock } from "@clockwork/core";
import { writeControl } from "../src/state.js";
import { runCli } from "../../cli/src/main.js";

it("panel and CLI controls wait for the same recovery control lease", async () => {
  const project = await mkdtemp(join(tmpdir(), "cw-control-lock-"));
  const path = join(project, ".teamsmith/control.json");
  await mkdir(join(project, ".teamsmith"));
  await writeFile(path, JSON.stringify({ paused: false, kill: false }));
  try {
    for (const source of ["panel", "cli"]) {
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      const ready = new Promise<void>(r => { entered = r; });
      const recovery = withStorageLock(path, async () => { entered(); await gate; await atomicWrite(path, JSON.stringify({ paused: true, kill: false })); });
      await ready;
      let finished = false;
      const write = (source === "panel" ? writeControl(project, { kill: true }) : runCli(["kill"], project)).then(() => { finished = true; });
      await new Promise(r => setTimeout(r, 30));
      expect(finished).toBe(false);
      release(); await recovery; await write;
      const control = JSON.parse(await readFile(path, "utf8"));
      expect(control.kill).toBe(true);
      if (source === "panel") expect(control.paused).toBe(true);
    }
  } finally { await rm(project, { recursive: true, force: true }); }
});
