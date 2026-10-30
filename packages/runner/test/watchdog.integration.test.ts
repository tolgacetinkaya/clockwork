import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerWriter, readLedger, reduceLedger, writeSpecFile } from "@clockwork/core";
import type { ExecutionAdapter, ExecutionEvent, ExecutionReport, Spec, WatchdogPolicy } from "@clockwork/core";
import { inspectTeamRecovery, resumeTeam, runTeam, runUnit } from "../src/index.js";
import { git } from "../src/workspace.js";

const exec = promisify(execFile);
const criterion = "greeting is hello";
const completed: ExecutionReport = { outcome: "completed", summary: "Written", findings: [], evidence: [] };
const normal = { idle_ms: 1000, hard_ms: 5000, delivery_ms: 3000 };
const usage: ExecutionEvent = { type: "usage", input: 1, cached: 0, output: 1 };
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
  child.kill();
  await exited;
}

describe("watchdog integration with actual Git worktrees and controlled local workers", () => {
  let temp: string, project: string, workspace: string, spec: Spec;
  let started: boolean;
  const children: ChildProcess[] = [];
  const ledger = () => readLedger(join(project, ".teamsmith/ledger.jsonl"));
  const state = async () => reduceLedger((await ledger()).events);
  beforeEach(async () => {
    started = false;
    temp = await mkdtemp(join(tmpdir(), "clockwork-watchdog-integration-"));
    project = join(temp, "project"); workspace = join(temp, "worker");
    await mkdir(join(project, "tests"), { recursive: true });
    await writeFile(join(project, "tests/check.cjs"), "const assert = require('node:assert/strict'); const fs = require('node:fs'); assert.equal(fs.readFileSync('greeting.txt', 'utf8'), 'hello');\n");
    await git(project, "init", "-b", "main");
    await git(project, "config", "core.autocrlf", "false");
    await git(project, "add", ".");
    await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
    await git(project, "worktree", "add", "--detach", workspace, "HEAD");
    await mkdir(join(project, ".teamsmith"));
    await writeFile(join(project, ".teamsmith/control.json"), '{"paused":false,"kill":false}');
    spec = {
      spec_version: 1, meta: { goal: "Watchdog guarded greeting" }, priorities: { budget_target: 1000, bias: "fast" },
      work_units: [{ id: "wu-greeting", type: "code", description: "Write hello", owns: ["greeting.txt"], acceptance: [criterion], budget_est: 20 }],
      agents: [{ id: "builder", purpose: "Build greeting", model_tier: "standard" }], assignment: { "wu-greeting": "builder" },
    };
  });
  afterEach(async () => {
    await Promise.all(children.splice(0).map(stop));
    await rm(temp, { recursive: true, force: true });
  });
  async function start() {
    if (started) return;
    await writeSpecFile(join(project, ".teamsmith"), spec);
    const writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
    await writer.append("run.started", { data: { run_id: "watchdog-integration" } });
    await writer.append("spec.approved", { actor: "user", data: { version: 1, budget_target: 1000, units: spec.work_units.map(unit => ({ id: unit.id, depends_on: unit.depends_on ?? [] })) } });
    await writer.append("run.phase_entered", { data: { phase: "execute" } });
    started = true;
  }
  const produce = (adapter: ExecutionAdapter, watchdog: Partial<WatchdogPolicy> = normal) => runUnit({ project, workspace, unit: "wu-greeting", mode: "produce", adapter, watchdog });

  it("durably warns idle and overdue while a real child stays alive; transport heartbeats do not recover progress", async () => {
    await start();
    let observedAliveAtIdle = false, observedHeartbeatAfterIdle = false, childClosed = false;
    const adapter: ExecutionAdapter = { id: "live-idle-child", async *execute(request): AsyncGenerator<ExecutionEvent> {
      const child = spawn(process.execPath, ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"], { cwd: request.workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      await new Promise<void>((resolve, reject) => { child.stdout!.once("data", () => resolve()); child.once("error", reject); });
      try {
        yield usage;
        const deadline = Date.now() + 300;
        while (Date.now() < deadline && !request.signal.aborted) {
          await wait(25, request.signal);
          const events = (await ledger()).events;
          if (events.some(event => event.type === "agent.watchdog" && event.data?.kind === "idle")) {
            observedAliveAtIdle = child.exitCode === null && child.signalCode === null;
            observedHeartbeatAfterIdle ||= events.some(event => event.type === "agent.activity" && event.data?.kind === "process_heartbeat");
          }
          yield { type: "heartbeat" };
        }
        yield { type: "report", report: completed };
      } finally { await stop(child); childClosed = true; }
    } };
    expect((await produce(adapter, { idle_ms: 50, expected_ms: 100, hard_ms: 5000, delivery_ms: 3000 })).outcome).toBe("completed");
    const events = (await ledger()).events;
    const alerts = events.filter(event => event.type === "agent.watchdog");
    expect(alerts.map(event => event.data?.kind)).toEqual(expect.arrayContaining(["idle", "overdue"]));
    expect(alerts.some(event => event.data?.kind === "recovered")).toBe(false);
    expect(observedAliveAtIdle).toBe(true); expect(observedHeartbeatAfterIdle).toBe(true); expect(childClosed).toBe(true);
    const tracking = Object.values((await state()).executions!)[0]!;
    const spawnEvent = events.find(event => event.type === "agent.spawned")!;
    expect(tracking.lastHeartbeatAt).toEqual(expect.any(String));
    expect(tracking.startedAt).toBe(spawnEvent.ts);
    // The delivered report is observable work; heartbeat events alone did not clear the alert.
    expect(tracking.alert).toBe("overdue");
    expect((await state()).anomalies).toEqual([]);
  }, 20000);

  it("fails an iterator that ends without a final report", async () => {
    await start();
    const adapter: ExecutionAdapter = { id: "missing-report", async *execute() { yield usage; } };
    await expect(produce(adapter)).rejects.toThrow("usage and a report");
    const events = (await ledger()).events;
    expect(events.some(event => event.type === "agent.error")).toBe(true);
    expect(events.some(event => event.type === "agent.delivery_received")).toBe(false);
    expect((await state()).units["wu-greeting"]!.status).toBe("failed");
    expect((await state()).anomalies).toEqual([]);
  }, 20000);

  it("records delivery timeout and a rejected acknowledgement when a reported iterator hangs until abort", async () => {
    await start(); let stopped = false;
    const adapter: ExecutionAdapter = { id: "reported-hang", async *execute(request): AsyncGenerator<ExecutionEvent> {
      try { yield usage; yield { type: "report", report: completed }; await aborted(request.signal); }
      finally { stopped = true; }
    } };
    await expect(produce(adapter, { idle_ms: 1000, hard_ms: 5000, delivery_ms: 100 })).rejects.toThrow();
    const events = (await ledger()).events;
    const receipt = events.find(event => event.type === "agent.delivery_received")!;
    const ack = events.find(event => event.type === "agent.delivery_acknowledged")!;
    expect(receipt).toBeDefined(); expect(ack.data).toMatchObject({ delivery_id: receipt.data!.delivery_id, received_seq: receipt.seq, outcome: "rejected" });
    expect(events.some(event => event.type === "agent.watchdog" && event.data?.kind === "delivery_timeout")).toBe(true);
    expect(events.some(event => event.type === "unit.accepted")).toBe(false);
    expect(stopped).toBe(true);
    expect((await state()).anomalies).toEqual([]);
    expect(Object.values((await state()).executions!)[0]).toMatchObject({ status: "error", executionUnreconciled: false });
  }, 20000);

  it("bounds noncooperative iteration, blocks dependent dispatch and refuses new execution or recovery until reconciliation", async () => {
    spec.work_units.push({ id: "wu-dependent", type: "code", description: "Wait for greeting", owns: ["dependent.txt"], acceptance: ["dependency accepted"], budget_est: 20, depends_on: ["wu-greeting"] });
    spec.assignment["wu-dependent"] = "builder";
    await start(); const launched: string[] = [];
    const adapter: ExecutionAdapter = { id: "noncooperative", execute(request) {
      launched.push(request.prompt.split("\n")[0]!);
      let first = true;
      const iterator: AsyncIterableIterator<ExecutionEvent> = { [Symbol.asyncIterator]() { return this; }, next(): Promise<IteratorResult<ExecutionEvent>> {
        if (first) { first = false; return Promise.resolve({ done: false, value: usage }); }
        // A bare unresolved promise has no timers, handles, or OS child to leak.
        return new Promise(() => {});
      }, return(): Promise<IteratorResult<ExecutionEvent>> { return Promise.resolve({ done: true, value: undefined }); } };
      return iterator;
    } };
    const begin = Date.now();
    const result = await runTeam({ project, adapter, concurrency: 2, watchdog: { idle_ms: 30, hard_ms: 100, delivery_ms: 50 } });
    expect(Date.now() - begin).toBeLessThan(10000);
    expect(result.status).toBe("stopped"); expect(launched).toEqual(["# Work unit: wu-greeting"]);
    const current = await state();
    expect(Object.values(current.executions!)[0]).toMatchObject({ status: "error", executionUnreconciled: true, alert: "hard_timeout" });
    expect(current.units["wu-greeting"]!.status).toBe("failed");
    expect(current.units["wu-dependent"]!.status).toBe("blocked");
    expect(current.anomalies).toEqual([]);
    await expect(produce(adapter)).rejects.toThrow(/termination|reconcil/i);
    await expect(runTeam({ project, adapter })).rejects.toThrow(/termination|reconcil/i);
    const inspection = await inspectTeamRecovery(project);
    expect(inspection.canResume).toBe(false);
    expect(inspection.reasons.some(reason => /termination must be explicitly reconciled/i.test(reason))).toBe(true);
    await expect(resumeTeam({ project, adapter, recoveryToken: inspection.recoveryToken })).rejects.toThrow("Recovery is blocked");
    expect(launched).toHaveLength(1);
  }, 20000);

  it("acknowledges successful production and actual Node verification separately from acceptance, and refuses done with a pending receipt", async () => {
    await start();
    const command = JSON.stringify([process.execPath, "tests/check.cjs"]);
    const adapter: ExecutionAdapter = { id: "actual-node-verifier", async *execute(request): AsyncGenerator<ExecutionEvent> {
      if (request.mode === "produce") await writeFile(join(request.workspace, "greeting.txt"), "hello");
      else {
        await exec(process.execPath, ["tests/check.cjs"], { cwd: request.workspace, windowsHide: true });
        yield { type: "command", id: "node-assertion", command, exitCode: 0, status: "completed" };
      }
      yield usage;
      yield { type: "report", report: request.mode === "produce" ? completed : { outcome: "accepted", summary: "Node assertion passed", findings: [], evidence: [{ criterion, command, result: "Node assertion exited 0", passed: true }] } };
    } };
    await produce(adapter);
    let events = (await ledger()).events;
    expect(events.find(event => event.type === "agent.delivery_acknowledged")!.data!.outcome).toBe("completed");
    expect(events.some(event => event.type === "unit.accepted")).toBe(false);
    expect((await state()).units["wu-greeting"]!.status).toBe("running");
    expect((await runUnit({ project, workspace, unit: "wu-greeting", mode: "verify", adapter, watchdog: normal })).outcome).toBe("accepted");
    events = (await ledger()).events;
    const accepted = events.find(event => event.type === "unit.accepted")!;
    const verificationExecution = events.find(event => event.type === "agent.spawned" && event.data?.mode === "verify")!.data!.execution;
    const verifyReceipt = events.find(event => event.type === "agent.delivery_received" && event.data?.execution === verificationExecution)!;
    const verifyAck = events.find(event => event.type === "agent.delivery_acknowledged" && event.data?.execution === verificationExecution)!;
    expect(verifyReceipt.seq).toBeLessThan(accepted.seq); expect(verifyAck.seq).toBeLessThan(accepted.seq);
    expect(verifyAck.data).toMatchObject({ outcome: "accepted", received_seq: verifyReceipt.seq });
    const writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
    const execution = randomUUID(), identity = { agent_id: "pending-integration" };
    await writer.append("agent.spawned", { ...identity, data: { execution, mode: "integration_verify", watchdog: normal } });
    const receipt = await writer.append("agent.delivery_received", { ...identity, data: { execution, delivery_id: execution, outcome: "accepted" } });
    await writer.append("agent.completed", { ...identity, data: { execution } });
    await expect(writer.append("run.completed", { data: { outcome: "done" } })).rejects.toThrow(/unacknowledged/);
    await expect(runTeam({ project, adapter })).rejects.toThrow(/acknowledged/);
    await writer.append("agent.delivery_acknowledged", { ...identity, data: { execution, delivery_id: execution, received_seq: receipt.seq, outcome: "accepted" } });
    await writer.append("run.completed", { data: { outcome: "done" } });
    expect((await state()).outcome).toBe("done"); expect((await state()).anomalies).toEqual([]);
  }, 20000);
});
