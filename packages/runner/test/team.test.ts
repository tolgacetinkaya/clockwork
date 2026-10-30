import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerWriter, readLedger, reduceLedger, writeSpecFile } from "@clockwork/core";
import type { ExecutionAdapter, ExecutionEvent, Spec } from "@clockwork/core";
import { inspectTeamRecovery, resumeTeam, runTeam, runUnit } from "../src/index.js";
import { git } from "../src/workspace.js";
import * as workspaceModule from "../src/workspace.js";
import * as coreModule from "@clockwork/core";

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};
const temps: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of temps.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(dependent = false, budget = 10000, three = false, configure?: (spec: Spec) => void) {
  const temp = await mkdtemp(join(tmpdir(), "clockwork-team-"));
  temps.push(temp);
  const project = join(temp, "project");
  await mkdir(project);
  await git(project, "init", "-b", "main");
  await writeFile(join(project, "README.md"), "baseline");
  await git(project, "add", ".");
  await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
  await mkdir(join(project, ".teamsmith"));
  await writeFile(join(project, ".teamsmith/control.json"), '{"paused":false,"kill":false}');
  const spec: Spec = {
    spec_version: 1, meta: { goal: "Team test" }, priorities: { budget_target: budget, bias: "fast" },
    work_units: (three ? ["a", "b", "c"] : ["a", "b"]).map((id, index) => ({
      id: `wu-${id}`, type: "code", description: `Write ${id}.txt`, owns: [`${id}.txt`],
      acceptance: ["file exists"], budget_est: 100,
      ...(dependent && index ? { depends_on: ["wu-a"] } : {}),
    })),
    agents: [{ id: "builder", purpose: "Build files", model_tier: "standard" }],
    assignment: { "wu-a": "builder", "wu-b": "builder", ...(three ? { "wu-c": "builder" } : {}) },
  };
  configure?.(spec);
  await writeSpecFile(join(project, ".teamsmith"), spec);
  const writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
  await writer.append("run.started", { data: { run_id: "team-test" } });
  await writer.append("spec.approved", { actor: "user", data: { version: 1, budget_target: budget, units: spec.work_units.map(u => ({ id: u.id, ...(u.depends_on ? { depends_on: u.depends_on } : {}) })) } });
  await writer.append("run.phase_entered", { data: { phase: "execute" } });
  return { project, writer };
}
function adapter(action?: (workspace: string, unit: string, signal: AbortSignal) => Promise<void>): ExecutionAdapter {
  return { id: "test", async *execute(request): AsyncGenerator<ExecutionEvent> {
    const unit = request.prompt.match(/(?:Work unit|Verification of work unit): (wu-[abc])/)![1]!;
    if (request.mode === "produce") {
      await action?.(request.workspace, unit, request.signal);
      await writeFile(join(request.workspace, `${unit.slice(3)}.txt`), unit);
    }
    yield { type: "usage", input: 10, cached: 0, output: 2 };
    yield { type: "report", report: { outcome: request.mode === "produce" ? "completed" : "accepted", summary: "done", findings: [], evidence: [{ criterion: "file exists", command: "read file", result: "exists", passed: true }] } };
  } };
}
describe("automatic isolated team", () => {
  it("proves overlapping workers with a barrier and integrates both without changing the user checkout", async () => {
    const { project } = await fixture();
    const originalHead = await git(project, "rev-parse", "HEAD");
    await writeFile(join(project, "README.md"), "user edit");
    const both = gate(), release = gate();
    let entered = 0;
    const work = runTeam({ project, adapter: adapter(async () => {
      if (++entered === 2) both.resolve();
      await release.promise;
    }), concurrency: 2 });
    await both.promise;
    expect(entered).toBe(2);
    release.resolve();
    const result = await work;
    expect(result.status).toBe("completed");
    expect(result.accepted.sort()).toEqual(["wu-a", "wu-b"]);
    expect(await readFile(join(result.integrationWorkspace!, "a.txt"), "utf8")).toBe("wu-a");
    expect(await readFile(join(result.integrationWorkspace!, "b.txt"), "utf8")).toBe("wu-b");
    expect(await git(project, "rev-parse", "HEAD")).toBe(originalHead);
    expect(await readFile(join(project, "README.md"), "utf8")).toBe("user edit");
    await expect(runTeam({ project, adapter: adapter() })).rejects.toThrow(/receipt already exists/);
    const state = reduceLedger((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events);
    expect(state.anomalies).toEqual([]);
  }, 20000);
  it("starts dependent work from integrated upstream files", async () => {
    const { project } = await fixture(true);
    const order: string[] = [];
    const result = await runTeam({ project, adapter: adapter(async (workspace, unit) => {
      order.push(unit);
      if (unit === "wu-b") expect(await readFile(join(workspace, "a.txt"), "utf8")).toBe("wu-a");
    }) });
    expect(result.status).toBe("completed");
    expect(order).toEqual(["wu-a", "wu-b"]);
  }, 20000);
  it("reserves both sessions so a second producer cannot overlaunch", async () => {
    const { project } = await fixture(false, 300);
    const started = gate(), release = gate();
    let count = 0;
    const work = runTeam({ project, adapter: adapter(async () => {
      count++;
      if (count === 1) { started.resolve(); await release.promise; }
    }), concurrency: 2 });
    await started.promise;
    await new Promise(r => setTimeout(r, 100));
    expect(count).toBe(1);
    release.resolve();
    expect((await work).status).toBe("completed");
    expect(count).toBe(2);
  }, 20000);
  it("settles active work on cancellation and preserves all worktrees", async () => {
    const { project } = await fixture();
    const controller = new AbortController(), started = gate();
    let count = 0;
    const work = runTeam({ project, signal: controller.signal, concurrency: 1,
      adapter: adapter(async (_workspace, _unit, signal) => {
        count++; started.resolve();
        await new Promise<void>((_r, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
      }) });
    await started.promise;
    controller.abort();
    const result = await work;
    expect(result.status).toBe("stopped");
    expect(count).toBe(1);
    expect(Object.keys(result.failures)).toContain("wu-a");
    expect(await git(result.integrationWorkspace!, "rev-parse", "HEAD")).toBeTruthy();
    const receipt = JSON.parse(await readFile(join(project, ".teamsmith/team.json"), "utf8"));
    expect(await git(receipt.workspaces["wu-a"], "rev-parse", "HEAD")).toBeTruthy();
  }, 20000);
  it("shares the lease with another scheduler and a manual runner", async () => {
    const { project } = await fixture();
    const started = gate(), release = gate();
    let calls = 0;
    const shared = adapter(async () => { calls++; started.resolve(); await release.promise; });
    const team = runTeam({ project, concurrency: 1, adapter: shared });
    await started.promise;
    const other = runTeam({ project, adapter: shared });
    const otherAssertion = expect(other).rejects.toThrow(/receipt already exists|Storage lock timeout/);
    const manualWorkspace = join(dirname(project), "manual");
    await git(project, "worktree", "add", "--detach", manualWorkspace, "HEAD");
    const manual = runUnit({ project, workspace: manualWorkspace, unit: "wu-a", mode: "produce", adapter: shared });
    const manualAssertion = expect(manual).rejects.toThrow(/not ready|Storage lock timeout/);
    await new Promise(r => setTimeout(r, 100));
    expect(calls).toBe(1);
    release.resolve();
    expect((await team).status).toBe("completed");
    await otherAssertion;
    await manualAssertion;
    expect(calls).toBe(2);
  }, 20000);
  it("stops on verification failure without launching a dependent or retrying", async () => {
    const { project } = await fixture(true);
    let sessions = 0;
    const base = adapter();
    const result = await runTeam({ project, adapter: { id: "test", async *execute(request) {
      sessions++;
      for await (const event of base.execute(request)) {
        if (request.mode === "verify" && event.type === "report")
          yield { ...event, report: { ...event.report, outcome: "rework" as const } };
        else yield event;
      }
    } } });
    expect(result.status).toBe("stopped");
    expect(result.accepted).toEqual([]);
    expect(result.failures["wu-a"]).toMatch(/rework/);
    expect(sessions).toBe(2);
  }, 20000);
  it("unknown provider usage stops dispatch and is durable", async () => {
    const { project } = await fixture(true);
    let sessions = 0;
    const result = await runTeam({ project, adapter: { id: "test", async *execute() {
      sessions++;
      throw new Error("provider disconnected");
    } } });
    expect(result.status).toBe("stopped");
    expect(sessions).toBe(1);
    expect(result.failures["wu-a"]).toMatch(/provider disconnected/);
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events;
    expect(events.find(e => e.type === "agent.error")?.data?.usage_unknown).toBe(true);
    const state = reduceLedger(events);
    expect(state.openCheckpoints.some(c => c.blocking)).toBe(true);
    expect(state.anomalies).toEqual([]);
    await expect(runTeam({ project, adapter: adapter() })).rejects.toThrow(/receipt already exists/);
  }, 20000);

  it("holds the execution lease against another process", async () => {
    const { project } = await fixture();
    const started = gate(), release = gate(), childReady = gate();
    const team = runTeam({ project, concurrency: 1, adapter: adapter(async () => {
      started.resolve(); await release.promise;
    }) });
    await started.promise;
    const source = `import {runTeam} from './packages/runner/src/index.ts';
      console.log('attempt');
      try { await runTeam({ project: process.argv[1], adapter: {id:'child', async *execute(){console.log('UNEXPECTED_EXECUTION');}} }); }
      catch(e) { console.log(e.message); }`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, project], { cwd: process.cwd(), windowsHide: true });
    let output = "";
    child.stdout.on("data", data => { output += data.toString(); if (output.includes("attempt")) childReady.resolve(); });
    let stderr = "";
    child.stderr.on("data", data => { stderr += data.toString(); });
    const finished = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    await childReady.promise;
    await new Promise(r => setTimeout(r, 100));
    expect(output).toBe("attempt\n");
    release.resolve();
    expect((await team).status).toBe("completed");
    expect(await finished).toBe(0);
    expect(stderr).toBe("");
    expect(output).toMatch(/receipt already exists|Storage lock timeout/);
    expect(output).not.toContain("UNEXPECTED_EXECUTION");
  }, 20000);

  it("completes when final verification uses exactly the budget", async () => {
    const { project } = await fixture(false, 400);
    const base = adapter();
    const result = await runTeam({ project, adapter: { id: "test", async *execute(request) {
      for await (const event of base.execute(request))
        yield event.type === "usage" ? { type: "usage" as const, input: 100, cached: 0, output: 0 } : event;
    } } });
    expect(result.status).toBe("completed");
    expect(result.accepted).toHaveLength(2);
    const state = reduceLedger((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events);
    expect(state.totalSpent).toBe(400);
    expect(state.anomalies).toEqual([]);
  }, 20000);

  it("refreshes budget after usage arrives during worktree creation", async () => {
    const { project } = await fixture(false, 600, true);
    const bCreating = gate(), aIntegrated = gate();
    const originalGit = workspaceModule.git;
    vi.spyOn(workspaceModule, "git").mockImplementation(async (cwd, ...args) => {
      if (args[0] === "worktree" && args.includes("add") && args.some(a => a.endsWith("wu-b"))) {
        bCreating.resolve();
        await aIntegrated.promise;
      }
      const result = await originalGit(cwd, ...args);
      if (args.includes("cherry-pick")) aIntegrated.resolve();
      return result;
    });
    let cCalls = 0;
    const base = adapter(async (_workspace, unit) => {
      if (unit === "wu-a") await bCreating.promise;
      if (unit === "wu-c") cCalls++;
    });
    const result = await runTeam({ project, concurrency: 3, adapter: { id: "test", async *execute(request) {
      for await (const event of base.execute(request)) {
        if (request.mode === "produce" && request.prompt.includes("# Work unit: wu-a") && event.type === "usage")
          yield { type: "usage" as const, input: 450, cached: 0, output: 0 };
        else yield event;
      }
    } } });
    expect(result.status).toBe("stopped");
    expect(cCalls).toBe(0);
    expect(result.accepted).toEqual(["wu-a", "wu-b"]);
  }, 20000);
  it("serializes durable receipt writes while dispatch overlaps integration", async () => {
    const { project } = await fixture();
    const originalWrite = coreModule.atomicWrite;
    let active = 0, maxActive = 0, writes = 0;
    vi.spyOn(coreModule, "atomicWrite").mockImplementation(async (file, contents) => {
      if (!file.endsWith("team.json")) return originalWrite(file, contents);
      active++; writes++; maxActive = Math.max(maxActive, active);
      try {
        await new Promise(r => setTimeout(r, 15));
        await originalWrite(file, contents);
      } finally { active--; }
    });
    const result = await runTeam({ project, adapter: adapter() });
    expect(result.status).toBe("completed");
    expect(writes).toBeGreaterThan(5);
    expect(maxActive).toBe(1);
    const receipt = JSON.parse(await readFile(join(project, ".teamsmith/team.json"), "utf8"));
    expect(receipt.accepted.sort()).toEqual(["wu-a", "wu-b"]);
    expect(Object.keys(receipt.commits).sort()).toEqual(["wu-a", "wu-b"]);
    expect(receipt.reservations).toEqual({});
  }, 20000);

  it("preserves a real Git integration conflict and blocks downstream dispatch", async () => {
    const { project } = await fixture(false, 10000, true, spec => {
      for (const unit of spec.work_units.slice(0, 2)) unit.owns = ["README.md"];
      spec.work_units[2]!.depends_on = ["wu-a", "wu-b"];
    });
    const originalHead = await git(project, "rev-parse", "HEAD");
    await writeFile(join(project, "README.md"), "user uncommitted edit");
    const originalStatus = await git(project, "status", "--porcelain");
    const both = gate(), release = gate();
    const producers: string[] = [];
    const work = runTeam({ project, concurrency: 2, adapter: {
      id: "conflict-test", async *execute(request): AsyncGenerator<ExecutionEvent> {
        const unit = request.prompt.match(/(?:Work unit|Verification of work unit): (wu-[abc])/)![1]!;
        if (request.mode === "produce") {
          producers.push(unit);
          if (producers.length === 2) both.resolve();
          await release.promise;
          await writeFile(join(request.workspace, "README.md"), `independent output from ${unit}\n`);
        }
        const contents = await readFile(join(request.workspace, "README.md"), "utf8");
        yield { type: "usage", input: 10, cached: 0, output: 2 };
        yield { type: "report", report: {
          outcome: request.mode === "produce" ? "completed" : "accepted",
          summary: "Changed existing shared file", findings: [],
          evidence: [{ criterion: "file exists", command: "read README.md", result: contents, passed: true }],
        } };
      },
    } });
    await both.promise;
    expect(producers.sort()).toEqual(["wu-a", "wu-b"]);
    release.resolve();
    const result = await work;
    expect(result.status).toBe("stopped");
    expect(result.accepted).toHaveLength(1);
    const conflicted = ["wu-a", "wu-b"].find(unit => !result.accepted.includes(unit))!;
    expect(result.failures[conflicted]).toMatch(/cherry-pick|conflict/i);
    expect(producers).not.toContain("wu-c");
    expect(await git(project, "rev-parse", "HEAD")).toBe(originalHead);
    expect(await git(project, "branch", "--show-current")).toBe("main");
    expect(await git(project, "status", "--porcelain")).toBe(originalStatus);
    expect(await readFile(join(project, "README.md"), "utf8")).toBe("user uncommitted edit");
    expect(await git(result.integrationWorkspace!, "ls-files", "--unmerged")).toContain("README.md");
    const recovery = await inspectTeamRecovery(project);
    expect(recovery.canResume).toBe(false);
    expect(recovery.reasons.join(" ")).toMatch(/conflict|disagree/);
    const receipt = JSON.parse(await readFile(join(project, ".teamsmith/team.json"), "utf8"));
    expect(receipt.status).toBe("stopped");
    expect(receipt.accepted).toEqual(result.accepted);
    expect(Object.keys(receipt.commits).sort()).toEqual(["wu-a", "wu-b"]);
    expect(Object.keys(receipt.workspaces).sort()).toEqual(["wu-a", "wu-b"]);
    for (const unit of ["wu-a", "wu-b"]) {
      expect(await git(receipt.workspaces[unit], "rev-parse", "HEAD")).toBe(receipt.commits[unit]);
      expect(await git(project, "cat-file", "-t", receipt.commits[unit])).toBe("commit");
      expect(await readFile(join(receipt.workspaces[unit], "README.md"), "utf8")).toContain(unit);
    }
    const state = reduceLedger((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events);
    expect(state.units["wu-c"]?.status).toBe("pending");
    expect(state.openCheckpoints.some(checkpoint => checkpoint.blocking)).toBe(true);
    expect(state.anomalies).toEqual([]);
  }, 20000);

  it("verifies configured combined gates in a fresh readonly session and records actual usage", async () => {
    const { project } = await fixture(false, 10000, false, spec => { spec.verification = { global_gates: ["both files combine"] }; });
    const base = adapter();
    let finalSessions = 0;
    const result = await runTeam({ project, adapter: { id: "test", async *execute(request) {
      if (!request.prompt.startsWith("# Final integration verification")) { yield* base.execute(request); return; }
      finalSessions++;
      expect(request.mode).toBe("verify");
      expect(await git(request.workspace, "status", "--porcelain")).toBe("");
      const combined = await readFile(join(request.workspace, "a.txt"), "utf8") + await readFile(join(request.workspace, "b.txt"), "utf8");
      expect(combined).toBe("wu-awu-b");
      yield { type: "usage", input: 7, cached: 2, output: 3 };
      yield { type: "report", report: { outcome: "accepted", summary: "combined", findings: [], evidence: [{ criterion: "both files combine", command: "read a.txt and b.txt", result: combined, passed: true }] } };
    } } });
    expect(result.status).toBe("completed");
    expect(result.integrationVerification?.status).toBe("passed");
    expect(finalSessions).toBe(1);
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events;
    expect(reduceLedger(events).totalSpent).toBe(58);
    expect(events.find(e => e.type === "budget.spent" && e.data?.mode === "integration_verify")?.data?.tokens).toBe(10);
    expect(reduceLedger(events).anomalies).toEqual([]);
  }, 20000);
  it("resumes a stopped partial team after an exact archive-only interruption without rerunning accepted work", async () => {
    const { project } = await fixture(true);
    const base = adapter();
    const first = await runTeam({ project, adapter: { id: "test", async *execute(request) {
      for await (const event of base.execute(request)) {
        if (request.mode === "produce" && request.prompt.includes("# Work unit: wu-b") && event.type === "report")
          yield { ...event, report: { ...event.report, outcome: "blocked" as const } };
        else yield event;
      }
    } } });
    expect(first.status).toBe("stopped");
    expect(first.accepted).toEqual(["wu-a"]);
    const old = JSON.parse(await readFile(join(project, ".teamsmith/team.json"), "utf8"));
    // Simulate a process exiting after exclusive archive creation, before receipt advance.
    const executionReceipts: Record<string, unknown> = {};
    for (const unit of Object.keys(old.workspaces)) {
      try { executionReceipts[unit] = JSON.parse(await readFile(join(project, ".teamsmith/executions", `${unit}.json`), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const archivePath = join(project, ".teamsmith", `team-${old.id}-attempt-1.json`);
    const archiveContents = JSON.stringify({ ...old, executionReceipts }, null, 2);
    await writeFile(archivePath, archiveContents, { flag: "wx" });
    const review = await inspectTeamRecovery(project);
    expect(review.reasons).toEqual([]);
    expect(review.canResume).toBe(true);
    const retryCalls: string[] = [];
    const result = await resumeTeam({ project, recoveryToken: review.recoveryToken, adapter: adapter(async (workspace, unit) => {
      retryCalls.push(unit);
      expect(await readFile(join(workspace, "a.txt"), "utf8")).toBe("wu-a");
    }) });
    expect(result.status).toBe("completed");
    expect(result.integrationVerification?.status).toBe("not_configured");
    expect(retryCalls).toEqual(["wu-b"]);
    expect(result.accepted).toEqual(["wu-a", "wu-b"]);
    const current = JSON.parse(await readFile(join(project, ".teamsmith/team.json"), "utf8"));
    expect(current.workspaces["wu-b"]).not.toBe(old.workspaces["wu-b"]);
    expect(await readFile(join(old.workspaces["wu-b"], "b.txt"), "utf8")).toBe("wu-b");
    const archive = JSON.parse(await readFile(join(project, ".teamsmith", `team-${old.id}-attempt-1.json`), "utf8"));
    expect(archive.workspaces).toEqual(old.workspaces);
    expect(await readFile(archivePath, "utf8")).toBe(archiveContents);
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events;
    expect(events.find(e => e.type === "unit.retry_requested")?.actor).toBe("user");
    expect(reduceLedger(events).openCheckpoints).toEqual([]);
    expect(reduceLedger(events).anomalies).toEqual([]);
  }, 20000);
  it("retries only final gates after a clean combined verification failure", async () => {
    const { project } = await fixture(false, 10000, false, spec => { spec.verification = { global_gates: ["combined test passes"] }; });
    const base = adapter();
    const gateAdapter = (pass: boolean): ExecutionAdapter => ({ id: "test", async *execute(request) {
      if (!request.prompt.startsWith("# Final integration verification")) { yield* base.execute(request); return; }
      yield { type: "usage", input: 8, cached: 0, output: 2 };
      yield { type: "report", report: { outcome: pass ? "accepted" : "rework", summary: "gate", findings: pass ? [] : ["combined failed"], evidence: [{ criterion: "combined test passes", command: "combined test", result: pass ? "pass" : "fail", passed: pass }] } };
    } });
    const first = await runTeam({ project, adapter: gateAdapter(false) });
    expect(first.status).toBe("stopped");
    expect(first.integrationVerification?.status).toBe("failed");
    expect(first.accepted).toHaveLength(2);
    const review = await inspectTeamRecovery(project);
    expect(review.reasons).toEqual([]);
    let sessions = 0;
    const good = gateAdapter(true);
    const result = await resumeTeam({ project, recoveryToken: review.recoveryToken, adapter: { id: "test", async *execute(request) {
      sessions++; expect(request.prompt).toMatch(/^# Final integration verification/); yield* good.execute(request);
    } } });
    expect(result.status).toBe("completed");
    expect(result.integrationVerification?.status).toBe("passed");
    expect(sessions).toBe(1);
  }, 20000);
  it("rejects stale review tokens and unknown usage before recovery writes", async () => {
    const { project } = await fixture(true);
    await runTeam({ project, adapter: { id: "test", async *execute() { throw new Error("connection lost"); } } });
    const review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/Unknown execution usage/);
    const before = await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8");
    const beforeReceipt = await readFile(join(project, ".teamsmith/team.json"), "utf8");
    await expect(resumeTeam({ project, adapter: adapter(), concurrency: 0, recoveryToken: review.recoveryToken })).rejects.toThrow(/concurrency/);
    expect(await readFile(join(project, ".teamsmith/team.json"), "utf8")).toBe(beforeReceipt);
    expect(await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8")).toBe(before);
    await expect(resumeTeam({ project, adapter: adapter(), recoveryToken: review.recoveryToken })).rejects.toThrow(/Unknown execution usage/);
    expect(await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8")).toBe(before);
    await writeFile(join(project, ".teamsmith/control.json"), '{"paused":true,"kill":false}');
    await expect(resumeTeam({ project, adapter: adapter(), recoveryToken: review.recoveryToken })).rejects.toThrow(/stale/);
    expect(await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8")).toBe(before);
  }, 20000);

  it("refuses a final verifier that changes integrated files and blocks tampered recovery", async () => {
    const { project } = await fixture(false, 10000, false, spec => { spec.verification = { global_gates: ["combined passes"] }; });
    const base = adapter();
    const result = await runTeam({ project, adapter: { id: "test", async *execute(request) {
      if (!request.prompt.startsWith("# Final integration verification")) { yield* base.execute(request); return; }
      await writeFile(join(request.workspace, "README.md"), "verifier modified delivery");
      yield { type: "usage", input: 4, cached: 0, output: 2 };
      yield { type: "report", report: { outcome: "accepted", summary: "claimed success", findings: [], evidence: [{ criterion: "combined passes", command: "test", result: "pass", passed: true }] } };
    } } });
    expect(result.status).toBe("stopped");
    expect(result.integrationVerification?.status).toBe("failed");
    expect(result.failures.integration).toMatch(/modified/);
    const review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/HEAD or files changed/);
    const ledger = await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8");
    await expect(resumeTeam({ project, adapter: adapter(), recoveryToken: review.recoveryToken })).rejects.toThrow(/blocked/);
    expect(await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8")).toBe(ledger);
    expect(await readFile(join(result.integrationWorkspace!, "README.md"), "utf8")).toBe("verifier modified delivery");
  }, 20000);
  it("respects unrelated blockers and only clears pause controls on explicit reviewed resume", async () => {
    const { project, writer } = await fixture(true);
    const base = adapter();
    await runTeam({ project, adapter: { id: "test", async *execute(request) {
      for await (const event of base.execute(request)) {
        if (request.mode === "produce" && request.prompt.includes("# Work unit: wu-b") && event.type === "report")
          yield { ...event, report: { ...event.report, outcome: "blocked" as const } };
        else yield event;
      }
    } } });
    await writer.append("interaction.checkpoint_raised", { data: { ref: "unrelated-review", kind: "gate", blocking: true } });
    await writer.append("run.paused", { actor: "user" });
    await writeFile(join(project, ".teamsmith/control.json"), '{"paused":true,"kill":true}');
    const blocked = await inspectTeamRecovery(project);
    expect(blocked.reasons.join(" ")).toMatch(/Unrelated/);
    await expect(resumeTeam({ project, adapter: adapter(), recoveryToken: blocked.recoveryToken })).rejects.toThrow(/Unrelated/);
    expect(JSON.parse(await readFile(join(project, ".teamsmith/control.json"), "utf8"))).toEqual({ paused: true, kill: true });
    await writer.append("interaction.checkpoint_resolved", { actor: "user", data: { ref: "unrelated-review" } });
    const review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(true);
    const result = await resumeTeam({ project, adapter: adapter(), recoveryToken: review.recoveryToken });
    expect(result.status).toBe("completed");
    expect(JSON.parse(await readFile(join(project, ".teamsmith/control.json"), "utf8"))).toEqual({ paused: false, kill: false });
    const state = reduceLedger((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events);
    expect(state.paused).toBe(false);
    expect(state.openCheckpoints).toEqual([]);
    expect(state.anomalies).toEqual([]);
  }, 20000);

  it.each(["usage", "report"] as const)("refuses final verifier missing %s and accounts conservatively", async missing => {
    const { project } = await fixture(false, 10000, false, spec => { spec.verification = { global_gates: ["combined passes"] }; });
    const base = adapter();
    const result = await runTeam({ project, adapter: { id: "test", async *execute(request) {
      if (!request.prompt.startsWith("# Final integration verification")) { yield* base.execute(request); return; }
      if (missing !== "usage") yield { type: "usage", input: 4, cached: 0, output: 2 };
      if (missing !== "report") yield { type: "report", report: { outcome: "accepted", summary: "claimed success", findings: [], evidence: [{ criterion: "combined passes", command: "test", result: "pass", passed: true }] } };
    } } });
    expect(result.status).toBe("stopped");
    expect(result.integrationVerification?.status).toBe("failed");
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events;
    const error = events.find(e => e.type === "agent.error" && e.data?.mode === "integration_verify");
    expect(error?.data?.usage_unknown).toBe(missing === "usage");
    expect(reduceLedger(events).totalSpent).toBe(missing === "usage" ? 48 : 54);
    const review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(missing !== "usage");
    if (missing === "usage") expect(review.reasons.join(" ")).toMatch(/Unknown execution usage/);
  }, 20000);

  it("reviews controls under their lock so a newer stop cannot be cleared", async () => {
    const { project } = await fixture(true);
    const base = adapter();
    await runTeam({ project, adapter: { id: "test", async *execute(request) {
      for await (const event of base.execute(request)) {
        if (request.mode === "produce" && request.prompt.includes("# Work unit: wu-b") && event.type === "report")
          yield { ...event, report: { ...event.report, outcome: "blocked" as const } };
        else yield event;
      }
    } } });
    const review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(true);
    const ledger = await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8");
    const receipt = await readFile(join(project, ".teamsmith/team.json"), "utf8");
    const control = join(project, ".teamsmith/control.json");
    let outcome!: Promise<unknown>;
    await coreModule.withStorageLock(control, async () => {
      outcome = resumeTeam({ project, adapter: adapter(), recoveryToken: review.recoveryToken }).then(() => "unexpected success", error => error);
      await new Promise(r => setTimeout(r, 100));
      await coreModule.atomicWrite(control, '{"paused":true,"kill":true}');
    });
    expect((await outcome as Error).message).toMatch(/stale/);
    expect(await readFile(control, "utf8")).toBe('{"paused":true,"kill":true}');
    expect(await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8")).toBe(ledger);
    expect(await readFile(join(project, ".teamsmith/team.json"), "utf8")).toBe(receipt);
  }, 20000);

  it("blocks mismatched archives and unreported verifier sessions without claiming resumability", async () => {
    const { project, writer } = await fixture();
    await runTeam({ project, concurrency: 1, adapter: { id: "test", async *execute() {
      yield { type: "usage", input: 3, cached: 0, output: 1 };
      yield { type: "report", report: { outcome: "blocked", summary: "known stopped attempt", findings: ["blocked"], evidence: [] } };
    } } });
    let review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(true);
    const receipt = review.receipt!;
    const archive = join(project, ".teamsmith", `team-${receipt.id}-attempt-${receipt.attempt}.json`);
    await writeFile(archive, "partial archive from interrupted write");
    review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/archive differs/);
    const ledgerBefore = await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8");
    await expect(resumeTeam({ project, adapter: adapter(), recoveryToken: review.recoveryToken })).rejects.toThrow(/archive differs/);
    expect(await readFile(archive, "utf8")).toBe("partial archive from interrupted write");
    expect(await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8")).toBe(ledgerBefore);
    // Simulate a final verifier whose process disappeared before usage/report delivery.
    await writer.append("agent.spawned", { agent_id: "integration-interrupted", data: { execution: "interrupted-global", mode: "integration_verify", provider: "test" } });
    review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/verifier session is still running or unreconciled/);
  }, 20000);

});
