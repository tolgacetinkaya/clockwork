import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendCommand, readLedger } from "@clockwork/core";
import { runCli } from "../src/main.js";

describe("CLI safety and durable command delivery", () => {
  let dir: string;
  const cli = (...args: string[]) => runCli(args, dir);
  const event = (type: string, data?: unknown, ...args: string[]) =>
    cli("event", type, ...args, ...(data === undefined ? [] : ["--data", JSON.stringify(data)]));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-cli-hardening-"));
    await cli("init");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function approve(): Promise<void> {
    expect((await event("run.started", { run_id: "hardening" })).code).toBe(0);
    expect((await event("spec.approved", {
      version: 1,
      units: [{ id: "storage" }, { id: "api", depends_on: ["storage"] }],
    })).code).toBe(0);
  }

  it("rejects invalid spending and transitions without persisting them", async () => {
    await approve();
    const file = join(dir, ".teamsmith", "ledger.jsonl");
    const before = await readFile(file, "utf8");
    expect((await event("budget.spent", { tokens: -100 })).code).toBe(1);
    expect((await event("unit.started", undefined, "--unit", "api")).code).toBe(1);
    expect((await event("run.completed", { outcome: "done" })).code).toBe(1);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(JSON.parse((await cli("state")).out).totalSpent).toBe(0);
  });

  it("allows completion only after the dependent units have been verified", async () => {
    await approve();
    for (const unit of ["storage", "api"]) {
      for (const type of ["unit.started", "unit.verify_started", "unit.accepted"]) {
        const result = await event(type, undefined, "--unit", unit);
        expect(result.code, result.out).toBe(0);
      }
    }
    expect((await event("run.completed", { outcome: "done" })).code).toBe(0);
    const after = await event("unit.started", undefined, "--unit", "storage");
    expect(after.code).toBe(1);
    const state = JSON.parse((await cli("state")).out);
    expect(state.outcome).toBe("done");
    expect(state.anomalies).toEqual([]);
  });

  it("replays commands across sessions until explicit acknowledgment", async () => {
    await appendCommand(dir, "note", { text: "first" });
    await appendCommand(dir, "note", { text: "second" });
    const first = await cli("commands", "pull");
    expect(first.code).toBe(0);
    expect((await runCli(["commands", "pull"], dir)).out).toBe(first.out);
    expect((await cli("commands", "ack", "3")).code).toBe(1);
    expect((await cli("commands", "ack", "1junk")).code).toBe(1);
    expect((await cli("commands", "ack", "1")).code).toBe(0);
    const pending = await cli("commands", "pull");
    expect(JSON.parse(pending.out).seq).toBe(2);
    expect((await cli("commands", "ack", "1")).code).toBe(0);
    expect((await cli("commands", "ack", "2")).code).toBe(0);
    expect((await cli("commands", "pull")).out).toBe("(nothing new)");
  });

  it("preserves the operator's pause and kill decisions on reinitialization", async () => {
    const file = join(dir, ".teamsmith", "control.json");
    await cli("pause");
    await cli("init");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ paused: true, kill: false });
    await cli("kill");
    await cli("init");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ paused: false, kill: true });
  });

  it("reports externally introduced state corruption as unhealthy and blocks new events", async () => {
    await approve();
    const file = join(dir, ".teamsmith", "ledger.jsonl");
    await appendFile(file, JSON.stringify({
      seq: 3, ts: new Date().toISOString(), actor: "orchestrator",
      type: "unit.accepted", unit_id: "storage",
    }) + "\n");
    const doctor = await cli("doctor");
    expect(doctor.code).toBe(1);
    expect(doctor.out).toContain("state anomalies: 1");
    expect(doctor.out).toContain("doctor: PROBLEMS FOUND");
    expect((await event("budget.spent", { tokens: 1 })).code).toBe(1);
    expect((await readLedger(file)).events).toHaveLength(3);
  });

  it("rejects malformed guard configurations at the CLI boundary", async () => {
    const file = join(dir, "bad-guard.json");
    await writeFile(file, JSON.stringify({ version: 1, project_root: dir }));
    const result = await cli("guard", "set", file);
    expect(result.code).toBe(1);
    expect(result.out).toContain("invalid guard config");
    await expect(readFile(join(dir, ".teamsmith", "guard.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
