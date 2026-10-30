import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readLedger, reduceLedger } from "@clockwork/core";
import type { ExecutionAdapter, ExecutionEvent, PlanningAdapter, PlanningProposal } from "@clockwork/core";
import { generateGoalPlan, runTeam, resumeTeam, inspectTeamRecovery } from "../../runner/src/index.js";
import { git } from "../../runner/src/workspace.js";
import { startPanel } from "../src/server.js";
import type { LaunchState } from "../src/protocol.js";
const exec = promisify(execFile);

it("turns a goal into tailored roles then executes dependent deliveries only after HTTP approval and explicit start", async () => {
  const root = await mkdtemp(join(tmpdir(), "cw-goal-e2e-"));
  const project = join(root, "project"); await mkdir(project);
  await git(project, "init", "-b", "main"); await writeFile(join(project, "README.md"), "original");
  await git(project, "add", "."); await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
  const head = await git(project, "rev-parse", "HEAD");
  const goal = "Investigate a timeout and deliver the requested repair";
  const constraints = "Do not add a database or change the public API";
  const proposal: PlanningProposal = {
    summary: "A diagnosis specialist followed by a focused repair specialist", assumptions: ["The existing API is authoritative"], open_questions: [], global_gates: ["Diagnosis and repair compose"],
    work_units: [
      { id: "diagnose", type: "research", description: "Explain the timeout", owns: ["diagnosis.txt"], contracts: ["Provide a diagnosis"], depends_on: [], acceptance: ["Diagnosis exists"], budget_est: 100, agent: { id: "latency-investigator", purpose: "Identify the timeout cause", model_tier: "cheap" } },
      { id: "repair", type: "code", description: "Deliver the focused repair", owns: ["repair.txt"], contracts: [], depends_on: ["diagnose"], acceptance: ["Repair exists"], budget_est: 100, agent: { id: "repair-specialist", purpose: "Implement only the diagnosed repair", model_tier: "standard" } },
    ],
  };
  let planCalls = 0; const production: string[] = [], observedModels: Array<string | undefined> = [];
  const planner: PlanningAdapter = { id: "controlled", async *plan(request) {
    planCalls++; expect(request.prompt).toContain(goal); expect(request.prompt).toContain(constraints);
    expect(await git(request.workspace, "rev-parse", "HEAD")).toBe(head);
    yield { type: "usage", input: 20, cached: 5, output: 10 }; yield { type: "plan", proposal };
  } };
  const worker: ExecutionAdapter = { id: "controlled", async *execute(request): AsyncGenerator<ExecutionEvent> {
    observedModels.push(request.model); expect(request.prompt).toContain(constraints);
    const final = request.prompt.startsWith("# Final integration verification");
    const id = final ? "final" : request.prompt.match(/# (?:Work unit|Verification of work unit): (diagnose|repair)/)![1]!;
    const file = id === "diagnose" ? "diagnosis.txt" : "repair.txt";
    if (request.mode === "produce") {
      if (id === "repair") expect(await readFile(join(request.workspace, "diagnosis.txt"), "utf8")).toBe("diagnose");
      production.push(id); await writeFile(join(request.workspace, file), id);
    }
    const criterion = final ? "Diagnosis and repair compose" : id === "diagnose" ? "Diagnosis exists" : "Repair exists";
    const script = final ? "const f=require('node:fs'),a=require('node:assert/strict');a.equal(f.readFileSync('diagnosis.txt','utf8'),'diagnose');a.equal(f.readFileSync('repair.txt','utf8'),'repair')" : "require('node:assert/strict').equal(require('node:fs').readFileSync(" + JSON.stringify(file) + ",'utf8')," + JSON.stringify(id) + ")";
    const command = JSON.stringify([process.execPath, "-e", script]);
    if (request.mode === "verify") {
      await exec(process.execPath, ["-e", script], { cwd: request.workspace, windowsHide: true });
      yield { type: "command", id: "assert-contents", command, exitCode: 0, status: "completed" };
    }
    yield { type: "usage", input: 5, cached: 0, output: 2 };
    yield { type: "report", report: { outcome: request.mode === "produce" ? "completed" : "accepted", summary: "Observed delivery", findings: [], evidence: [{ criterion, command, result: "Exact contents checked", passed: true }] } };
  } };
  const panel = await startPanel({ projectDir: project, execution: {
    plan: options => generateGoalPlan({ ...options, adapter: planner, model: "planner-fixture" }),
    run: options => runTeam({ ...options, adapter: worker }), resume: options => resumeTeam({ ...options, adapter: worker }), inspect: inspectTeamRecovery,
  } });
  try {
    const post = async (action: string, body: unknown) => {
      const response = await fetch(panel.url + "/api/launch/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json(); expect(response.status, JSON.stringify(payload)).toBe(200); return payload as LaunchState;
    };
    const waitFor = async (matches: (state: LaunchState) => boolean) => {
      const deadline = Date.now() + 60000;
      for (;;) {
        const state = await (await fetch(panel.url + "/api/launch")).json() as LaunchState;
        if (matches(state)) return state;
        if (state.planning?.status === "error" || state.status === "error" || state.status === "stopped") throw new Error(JSON.stringify(state));
        if (Date.now() > deadline) throw new Error("Goal integration deadline exceeded");
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    };
    await post("plan", { goal, constraints, budget: 10000, execution: { producer_model: "builder-fixture", verifier_model: "reviewer-fixture" } });
    const generated = await waitFor(state => state.planning?.status === "completed");
    expect(planCalls).toBe(1); expect(production).toEqual([]); expect(generated.approvalToken).toBeUndefined();
    expect((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events).toEqual([]);
    expect(generated.draft!.spec.agents.map(a => a.id)).toEqual(["latency-investigator", "repair-specialist"]);
    expect(generated.draft!.spec.meta.constraints).toEqual([constraints]);
    expect(generated.planning!.usage).toEqual({ input: 20, cached: 5, output: 10 });
    const approved = await post("approve", { revision: generated.draft!.revision }); expect(production).toEqual([]);
    await post("start", { approvalToken: approved.approvalToken, concurrency: 2 });
    const completed = await waitFor(state => state.status === "completed");
    expect(completed.result?.accepted).toEqual(["diagnose", "repair"]);
    expect(completed.result?.integrationVerification?.status).toBe("passed");
    expect(production).toEqual(["diagnose", "repair"]);
    expect(observedModels).toEqual(["builder-fixture", "reviewer-fixture", "builder-fixture", "reviewer-fixture", "reviewer-fixture"]);
    expect(await git(project, "rev-parse", "HEAD")).toBe(head);
    await expect(readFile(join(project, "repair.txt"))).rejects.toThrow();
    expect(reduceLedger((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events).anomalies).toEqual([]);
  } finally { await panel.close(); await rm(root, { recursive: true, force: true }); }
}, 90000);
