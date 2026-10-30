import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerWriter, readLedger, reduceLedger, writeSpecFile } from "@clockwork/core";
import type { ExecutionAdapter, ExecutionEvent, ExecutionModels, ExecutionRequest, Spec } from "@clockwork/core";
import { inspectTeamRecovery, resumeTeam, runTeam, runUnit } from "../src/index.js";
import type { ExecutionModelOptions } from "../src/index.js";
import { git } from "../src/workspace.js";

const execute = promisify(execFile);
const temps: string[] = [];
afterEach(async () => {
  for (const temp of temps.splice(0)) await rm(temp, { recursive: true, force: true });
});
async function fixture(models?: ExecutionModels) {
  const temp = await mkdtemp(join(tmpdir(), "clockwork-models-"));
  temps.push(temp);
  const project = join(temp, "project");
  await mkdir(join(project, "tests"), { recursive: true });
  await writeFile(join(project, "tests/check.cjs"), "const a=require('node:assert/strict'),f=require('node:fs');a.equal(f.readFileSync('greeting.txt','utf8'),process.argv[2]||'hello');\n");
  await git(project, "init", "-b", "main");
  await git(project, "add", ".");
  await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
  await mkdir(join(project, ".teamsmith"));
  await writeFile(join(project, ".teamsmith/control.json"), '{"paused":false,"kill":false}');
  const spec: Spec = {
    spec_version: 1, meta: { goal: "Independent review" }, priorities: { budget_target: 10000, bias: "fast" },
    work_units: [{ id: "wu-greeting", type: "code", description: "Write hello", owns: ["greeting.txt"], acceptance: ["greeting is hello"], budget_est: 100 }],
    agents: [{ id: "builder", purpose: "Write greeting", model_tier: "standard" }], assignment: { "wu-greeting": "builder" },
    verification: { global_gates: ["integrated greeting is hello"] }, ...(models ? { execution: models } : {}),
  };
  await writeSpecFile(join(project, ".teamsmith"), spec);
  const writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
  await writer.append("run.started", { data: { run_id: "model-fixture" } });
  await writer.append("spec.approved", { actor: "user", data: { version: 1, budget_target: 10000, units: [{ id: "wu-greeting" }] } });
  await writer.append("run.phase_entered", { data: { phase: "execute" } });
  return { project, temp };
}
function adapter(requests: ExecutionRequest[], fail?: "unit" | "integration"): ExecutionAdapter {
  return { id: "controlled-local", async *execute(request): AsyncGenerator<ExecutionEvent> {
    requests.push(request);
    const integration = request.prompt.startsWith("# Final integration verification");
    if (request.mode === "produce") {
      await writeFile(join(request.workspace, "greeting.txt"), "hello");
      yield { type: "usage", input: 2, cached: 0, output: 1 };
      yield { type: "report", report: { outcome: "completed", summary: "private producer deliberation", findings: [], evidence: [] } };
      return;
    }
    expect(request.prompt).not.toContain("private producer deliberation");
    const fails = fail === (integration ? "integration" : "unit");
    const args = ["tests/check.cjs", ...(fails ? ["wrong"] : [])];
    const command = JSON.stringify([process.execPath, ...args]);
    let exitCode = 0;
    try { await execute(process.execPath, args, { cwd: request.workspace, windowsHide: true }); }
    catch (error) { exitCode = Number((error as { code: number }).code); }
    yield { type: "command", id: "actual-node-check", command, exitCode, status: exitCode === 0 ? "completed" : "failed" };
    yield { type: "usage", input: 2, cached: 0, output: 1 };
    // Deliberately claim acceptance even after a failed command; evidence gate must refuse it.
    yield { type: "report", report: { outcome: "accepted", summary: "reviewed", findings: [], evidence: [{ criterion: integration ? "integrated greeting is hello" : "greeting is hello", command, result: exitCode === 0 ? "assertion passed" : "assertion failed", passed: true }] } };
  } };
}
const cases: { name: string; spec?: ExecutionModels; options: ExecutionModelOptions; expected: (string | undefined)[] }[] = [
  { name: "routes three separately selected identities", options: { producerModel: "producer-v1", verifierModel: "reviewer-v2", integrationVerifierModel: "integration-v3" }, expected: ["producer-v1", "reviewer-v2", "integration-v3"] },
  { name: "lets approved spec identities override runtime role defaults and legacy model", spec: { producer_model: "spec-producer", verifier_model: "spec-reviewer", integration_verifier_model: "spec-final" }, options: { model: "legacy", producerModel: "runtime-producer", verifierModel: "runtime-reviewer", integrationVerifierModel: "runtime-final" }, expected: ["spec-producer", "spec-reviewer", "spec-final"] },
  { name: "inherits the resolved spec verifier for integration", spec: { verifier_model: "spec-reviewer" }, options: { model: "legacy", producerModel: "runtime-producer", verifierModel: "runtime-reviewer" }, expected: ["runtime-producer", "spec-reviewer", "spec-reviewer"] },
  { name: "uses an explicit integration default over the inherited spec verifier", spec: { verifier_model: "spec-reviewer" }, options: { integrationVerifierModel: "runtime-final" }, expected: [undefined, "spec-reviewer", "runtime-final"] },
  { name: "keeps legacy and same-model selection compatible with independent sessions", options: { model: "shared-model" }, expected: ["shared-model", "shared-model", "shared-model"] },
  { name: "records adapter defaults without inventing an effective model", options: {}, expected: [undefined, undefined, undefined] },
];
describe("requested model routing with real Git worktrees and Node acceptance checks", () => {
  it.each(cases)("$name", async ({ spec, options, expected }) => {
    const { project } = await fixture(spec);
    const requests: ExecutionRequest[] = [];
    const result = await runTeam({ project, adapter: adapter(requests), ...options });
    expect(result.status).toBe("completed");
    expect(result.integrationVerification?.status).toBe("passed");
    expect(requests.map(r => r.model)).toEqual(expected);
    expect(requests.map(r => r.mode)).toEqual(["produce", "verify", "verify"]);
    expect(new Set(requests.map(r => r.signal)).size).toBe(3);
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events;
    const spawned = events.filter(e => e.type === "agent.spawned");
    expect(new Set(spawned.map(e => e.data?.execution)).size).toBe(3);
    expect(spawned.map(e => e.data?.requested_model)).toEqual(expected);
    expect(spawned.map(e => e.data?.model)).toEqual(expected);
    if (expected.every(m => m === undefined)) expect(spawned.every(e => !("model" in e.data!))).toBe(true);
    const receipt = JSON.parse(await readFile(join(project, ".teamsmith/team.json"), "utf8"));
    const unitReceipt = JSON.parse(await readFile(join(project, ".teamsmith/executions/wu-greeting.json"), "utf8"));
    expect(receipt.modelSelectionVersion).toBe(1);
    expect(receipt.executionModels).toEqual(unitReceipt.executionModels);
    expect(Object.values(receipt.executionModels)).toEqual(expected.filter(m => m !== undefined));
    expect(reduceLedger(events).anomalies).toEqual([]);
  }, 20000);

  it("refuses a selected verifier's false acceptance after an actual failed command", async () => {
    const { project } = await fixture();
    const requests: ExecutionRequest[] = [];
    const result = await runTeam({ project, producerModel: "producer", verifierModel: "independent-reviewer", adapter: adapter(requests, "unit") });
    expect(result.status).toBe("stopped");
    expect(result.accepted).toEqual([]);
    expect(requests.map(r => r.model)).toEqual(["producer", "independent-reviewer"]);
    const state = reduceLedger((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events);
    expect(state.units["wu-greeting"]?.status).toBe("rework");
  }, 20000);

  // Multiple real Git recovery inspections and a resumed run need headroom under host load.
  it("binds recovery to all requested identities before any durable mutation and resumes the matching selection", async () => {
    const { project } = await fixture();
    const options = { producerModel: "producer", verifierModel: "reviewer", integrationVerifierModel: "final-reviewer" };
    const first = await runTeam({ project, ...options, adapter: adapter([], "integration") });
    expect(first.status).toBe("stopped");
    expect(first.accepted).toEqual(["wu-greeting"]);
    const review = await inspectTeamRecovery(project, options);
    expect(review.canResume).toBe(true);
    const paths = ["ledger.jsonl", "control.json", "team.json"];
    const before = await Promise.all(paths.map(p => readFile(join(project, ".teamsmith", p), "utf8")));
    for (const key of ["producerModel", "verifierModel", "integrationVerifierModel"] as const) {
      const changed = { ...options, [key]: "changed" };
      const inspection = await inspectTeamRecovery(project, changed);
      expect(inspection.canResume).toBe(false);
      expect(inspection.reasons.join(" ")).toMatch(/model selection changed/);
      await expect(resumeTeam({ project, ...changed, recoveryToken: review.recoveryToken, adapter: adapter([]) })).rejects.toThrow(/stale|model selection changed/);
      expect(await Promise.all(paths.map(p => readFile(join(project, ".teamsmith", p), "utf8")))).toEqual(before);
    }
    const retried: ExecutionRequest[] = [];
    const result = await resumeTeam({ project, ...options, recoveryToken: review.recoveryToken, adapter: adapter(retried) });
    expect(result.status).toBe("completed");
    expect(retried.map(r => r.model)).toEqual(["final-reviewer"]);
  }, 60000);

  it("blocks old team receipts without recorded model identities conservatively", async () => {
    const { project } = await fixture();
    await runTeam({ project, adapter: adapter([], "integration") });
    const path = join(project, ".teamsmith/team.json");
    const receipt = JSON.parse(await readFile(path, "utf8"));
    delete receipt.modelSelectionVersion;
    delete receipt.executionModels;
    await writeFile(path, JSON.stringify(receipt));
    const review = await inspectTeamRecovery(project);
    expect(review.canResume).toBe(false);
    expect(review.reasons.join(" ")).toMatch(/predates recorded model selection/);
  }, 20000);

  it("refuses changing model selection or using legacy delivery receipts before manual verification", async () => {
    const { project, temp } = await fixture();
    const workspace = join(temp, "manual");
    await git(project, "worktree", "add", "--detach", workspace, "HEAD");
    const common = { project, workspace, unit: "wu-greeting", adapter: adapter([]), producerModel: "producer", verifierModel: "reviewer" };
    await runUnit({ ...common, mode: "produce" });
    await expect(runUnit({ ...common, mode: "verify", verifierModel: "replacement" })).rejects.toThrow(/model selection changed/);
    const path = join(project, ".teamsmith/executions/wu-greeting.json");
    const receipt = JSON.parse(await readFile(path, "utf8"));
    delete receipt.modelSelectionVersion;
    delete receipt.executionModels;
    await writeFile(path, JSON.stringify(receipt));
    await expect(runUnit({ ...common, mode: "verify" })).rejects.toThrow(/predates recorded model selection/);
  }, 20000);
});

describe("programmatic model option validation before execution", () => {
  const invalid: unknown[] = ["", " leading", "has space", "trailing\n", "-flag", "x".repeat(201), "control\u0000", "control\u0085", null, 42];
  it.each(["model", "producerModel", "verifierModel", "integrationVerifierModel"])("rejects invalid %s values without touching project state", async key => {
    const requests: ExecutionRequest[] = [];
    const project = join(tmpdir(), "clockwork-model-must-not-exist");
    for (const value of invalid) {
      const options = { project, adapter: adapter(requests), [key]: value };
      await expect(runTeam(options as Parameters<typeof runTeam>[0])).rejects.toThrow(/Invalid .*model|Invalid .*Model/);
      await expect(runUnit({ ...options, unit: "wu-greeting", workspace: project, mode: "produce" } as Parameters<typeof runUnit>[0])).rejects.toThrow(/Invalid .*model|Invalid .*Model/);
      await expect(resumeTeam({ ...options, recoveryToken: "unused" } as Parameters<typeof resumeTeam>[0])).rejects.toThrow(/Invalid .*model|Invalid .*Model/);
      await expect(inspectTeamRecovery(project, { [key]: value } as ExecutionModelOptions)).rejects.toThrow(/Invalid .*model|Invalid .*Model/);
    }
    expect(requests).toEqual([]);
  });
});
