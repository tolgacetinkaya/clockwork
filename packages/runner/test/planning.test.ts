import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LedgerWriter, writeSpecFile, validatePlanningProposal } from "@clockwork/core";
import type { PlanningAdapter, PlanningProposal } from "@clockwork/core";
import { generateGoalPlan, runTeam, runUnit, resumeTeam, inspectTeamRecovery } from "../src/index.js";
import { git } from "../src/workspace.js";
const temps: string[] = [];
afterEach(async () => { for (const path of temps.splice(0)) await rm(path, { recursive: true, force: true }); });
const input = { goal: "Investigate startup delay", budget: 1000 };
const proposal = (): PlanningProposal => ({ summary: "Measure startup before proposing changes", assumptions: [], open_questions: [], global_gates: ["Evidence identifies startup bottleneck"], work_units: [{ id: "wu-research", type: "research", description: "Measure startup", owns: ["report.md"], contracts: [], depends_on: [], acceptance: ["Timings cite actual commands"], budget_est: 100, agent: { id: "researcher", purpose: "Collect startup evidence", model_tier: "standard" } }] });
async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "cw-plan-test-")); temps.push(project);
  await git(project, "init", "-b", "main"); await writeFile(join(project, "README.md"), "baseline");
  await git(project, "add", "."); await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
  return project;
}
async function receipt(project: string) { return JSON.parse(await readFile(join(project, ".teamsmith/planning.json"), "utf8")); }
it("plans from committed detached HEAD with real usage without approving or starting a run", async () => {
  const project = await fixture(); const head = await git(project, "rev-parse", "HEAD"); let workspace = "";
  const adapter: PlanningAdapter = { id: "controlled", async *plan(request) {
    workspace = request.workspace; expect(workspace).not.toBe(project);
    expect(await git(workspace, "rev-parse", "HEAD")).toBe(head);
    expect(await git(workspace, "branch", "--show-current")).toBe("");
    expect(request.prompt).toContain(input.goal);
    yield { type: "usage", input: 30, cached: 10, output: 20 }; yield { type: "plan", proposal: proposal() };
  } };
  const result = await generateGoalPlan({ project, input, adapter, model: "test-model" });
  expect(result.head).toBe(head); expect(result.usage).toEqual({ input: 30, cached: 10, output: 20 });
  expect(result.spec.work_units[0]!.type).toBe("research"); expect(result.spec.priorities.budget_target).toBe(input.budget);
  expect((await receipt(project)).status).toBe("completed");
  await expect(readFile(join(project, ".teamsmith/ledger.jsonl"))).rejects.toThrow();
  await expect(readFile(join(workspace, "README.md"))).rejects.toThrow();
  expect(await git(project, "rev-parse", "HEAD")).toBe(head);
});
it("rejects writes and preserves the workspace and usage evidence even if the planner fails", async () => {
  const project = await fixture(); let workspace = "";
  const adapter: PlanningAdapter = { id: "controlled", async *plan(request) { workspace = request.workspace; temps.push(workspace); await writeFile(join(workspace, "README.md"), "unauthorized"); yield { type: "usage", input: 1, cached: 0, output: 1 }; throw new Error("provider failure"); } };
  await expect(generateGoalPlan({ project, input, adapter })).rejects.toThrow(/workspace changed/);
  expect(await readFile(join(workspace, "README.md"), "utf8")).toBe("unauthorized");
  expect(await receipt(project)).toMatchObject({ workspaceChanged: true, usageUnknown: false, usage: { input: 1, output: 1 } });
  await expect(generateGoalPlan({ project, input, adapter })).rejects.toThrow(/reconciliation/);
});
it("rejects a HEAD change while planning and a missing-usage result without inventing zero usage", async () => {
  const project = await fixture();
  const adapter: PlanningAdapter = { id: "controlled", async *plan() { yield { type: "plan", proposal: proposal() }; } };
  await expect(generateGoalPlan({ project, input, adapter })).rejects.toThrow(/usage/);
  expect(await receipt(project)).toMatchObject({ status: "error", usageUnknown: true, unreconciled: false });
  expect((await receipt(project)).usage).toBeUndefined();
  await expect(generateGoalPlan({ project, input, adapter })).rejects.toThrow(/reconciliation/);
  const project2 = await fixture();
  // Bind the mutation to this second independent project.
  const mutation: PlanningAdapter = { id: "controlled", async *plan() {
    await writeFile(join(project2, "README.md"), "new commit"); await git(project2, "add", "README.md");
    await git(project2, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "changed");
    yield { type: "usage", input: 2, cached: 0, output: 1 }; yield { type: "plan", proposal: proposal() };
  } };
  await expect(generateGoalPlan({ project: project2, input, adapter: mutation })).rejects.toThrow(/HEAD changed/);
});
it("bounds noncooperative planning, retains its live worktree, and blocks all execution entry points", async () => {
  const project = await fixture(); let workspace = "";
  const adapter: PlanningAdapter = { id: "stuck", plan(request) { workspace = request.workspace; temps.push(workspace); return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => ({ done: true, value: undefined }) }) }; } };
  await expect(generateGoalPlan({ project, input, adapter, watchdog: { hard_ms: 20, delivery_ms: 20 } })).rejects.toThrow(/termination is unconfirmed/);
  expect(await receipt(project)).toMatchObject({ unreconciled: true, usageUnknown: true });
  expect(await readFile(join(workspace, "README.md"), "utf8")).toBe("baseline");
  await expect(generateGoalPlan({ project, input, adapter })).rejects.toThrow(/reconciliation/);
  const execute = vi.fn();
  await expect(runTeam({ project, adapter: { id: "test", execute } })).rejects.toThrow(/reconciliation/);
  await expect(runUnit({ project, workspace, unit: "wu-research", mode: "produce", adapter: { id: "test", execute } })).rejects.toThrow(/reconciliation/);
  await expect(resumeTeam({ project, adapter: { id: "test", execute }, recoveryToken: "unused" })).rejects.toThrow(/reconciliation/);
  expect((await inspectTeamRecovery(project)).canResume).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});
it("rejects invalid model identities before invoking a planning adapter", async () => {
  const project = await fixture(); const plan = vi.fn();
  await expect(generateGoalPlan({ project, input, adapter: { id: "controlled", plan }, model: "--unsafe" })).rejects.toThrow(/model identity/);
  expect(plan).not.toHaveBeenCalled();
});

it("blocks programmatically approved unresolved questions before starting a worker", async () => {
  const project = await fixture();
  const plan = proposal(); plan.open_questions = ["Which environment is in scope?"];
  const spec = validatePlanningProposal(plan, input).spec;
  await mkdir(join(project, ".teamsmith"));
  await writeFile(join(project, ".teamsmith/control.json"), JSON.stringify({ paused: false, kill: false }));
  await writeSpecFile(join(project, ".teamsmith"), spec);
  const writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
  await writer.append("run.started", { data: { run_id: "test" } });
  await writer.append("spec.approved", { data: { version: 1, budget_target: 1000, units: [{ id: "wu-research" }] } });
  await writer.append("run.phase_entered", { data: { phase: "execute" } });
  const execute = vi.fn();
  await expect(runTeam({ project, adapter: { id: "controlled", execute } })).rejects.toThrow(/not ready/);
  expect(execute).not.toHaveBeenCalled();
});

it("cancels a cooperative planner and records its known usage without deleting a live workspace", async () => {
  const project = await fixture(); const controller = new AbortController();
  let entered!: () => void; const ready = new Promise<void>(r => { entered = r; });
  const adapter: PlanningAdapter = { id: "controlled", async *plan(request) {
    yield { type: "usage", input: 7, cached: 2, output: 3 };
    entered();
    await new Promise<void>(resolve => request.signal.addEventListener("abort", () => resolve(), { once: true }));
  } };
  const pending = generateGoalPlan({ project, input, adapter, signal: controller.signal, watchdog: { hard_ms: 1000, delivery_ms: 50 } });
  await ready; controller.abort();
  await expect(pending).rejects.toThrow(/aborted/);
  expect(await receipt(project)).toMatchObject({ status: "error", usageUnknown: false, unreconciled: false, usage: { input: 7, cached: 2, output: 3 } });
});
it.each(["dirty", "ledger"])("rejects root %s changes that appear during planning", async kind => {
  const project = await fixture();
  const adapter: PlanningAdapter = { id: "controlled", async *plan() {
    if (kind === "dirty") await writeFile(join(project, "README.md"), "user edit");
    else await writeFile(join(project, ".teamsmith/ledger.jsonl"), "invalid new state\n");
    yield { type: "usage", input: 5, cached: 0, output: 2 }; yield { type: "plan", proposal: proposal() };
  } };
  await expect(generateGoalPlan({ project, input, adapter })).rejects.toThrow(/local changes|Existing run/);
  expect(await receipt(project)).toMatchObject({ status: "error", usageUnknown: false });
});

it("disables repository checkout hooks while creating the read-only planning snapshot", async () => {
  const project = await fixture();
  await writeFile(join(project, ".git/hooks/post-checkout"), "#!/bin/sh\nprintf unsafe > hook-fired.txt\n", { mode: 0o755 });
  const adapter: PlanningAdapter = { id: "controlled", async *plan(request) {
    await expect(readFile(join(request.workspace, "hook-fired.txt"))).rejects.toThrow();
    yield { type: "usage", input: 3, cached: 0, output: 1 }; yield { type: "plan", proposal: proposal() };
  } };
  await expect(generateGoalPlan({ project, input, adapter })).resolves.toMatchObject({ head: await git(project, "rev-parse", "HEAD") });
  await expect(readFile(join(project, "hook-fired.txt"))).rejects.toThrow();
});
