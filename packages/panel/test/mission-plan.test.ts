import { describe, expect, it } from "vitest";
import { planSpec, planIssues, launchReady, recoveryReady, restoredTasks, budgetTokens, workspaceHasExecution } from "../client/mission-plan.js";
const task = { id: "api", description: "Deliver API", owns: "src/api/**", acceptance: "API test passes", dependencies: "", estimate: 10000 };
describe("reviewable mission plan", () => {
  it("preserves editable ownership, acceptance, dependencies and global commands", () => {
    const spec = planSpec("Ship feature", [task, { ...task, id: "ui", dependencies: "api", owns: "src/ui/**", estimate: 20000 }], 1000, "npm test\nnpm run build");
    expect(planIssues(spec, 2)).toEqual([]);
    expect(spec.work_units[1]).toMatchObject({ depends_on: ["api"], owns: ["src/ui/**"], acceptance: ["API test passes"], budget_est: 20000 });
    expect(spec.verification?.global_gates).toEqual(["npm test", "npm run build"]);
  });
  it("restores numeric and shorthand task estimates without losing budgets", () => {
    const spec = planSpec("Ship", [task], 100000, "check");
    spec.work_units[0]!.budget_est = "1.5k";
    expect(restoredTasks(spec)[0]?.estimate).toBe(1500);
    expect(budgetTokens("2m")).toBe(2000000);
  });
  it("round-trips model choices without losing advanced spec or task settings", () => {
    const base = planSpec("Ship", [task], 100000, "check", { producer_model: "fixture-producer", verifier_model: "fixture-verifier", integration_verifier_model: "fixture-final" });
    base.meta.assumptions = ["Keep API compatible"];
    base.priorities.bias = "cheap";
    base.work_units[0]!.type = "research";
    base.work_units[0]!.contracts = ["Stable API"];
    base.work_units[0]!.allowed_test_changes = ["tests/api.test.ts"];
    base.work_units[0]!.watchdog = { idle_ms: 5000 };
    base.agents[0]!.capabilities = { tools: ["inspect"] };
    base.agents[0]!.model_tier = "strong";
    base.verification!.per_unit = { required: true };
    base.verification!.watchdog = { hard_ms: 10000 };
    base.checkpoints = { milestones: [{ at: "50%", mode: "soft" }] };
    base.retrospective = { record: ["outcome"] };
    const restored = planSpec(base.meta.goal, restoredTasks(base), 100000, "check", base.execution, base);
    expect(restored).toEqual(base);
    const renamed = planSpec("Updated", restoredTasks(base).map(task => ({ ...task, id: "renamed" })), 100000, "new check", { verifier_model: "changed-verifier" }, base);
    expect(renamed.work_units[0]).toMatchObject({ id: "renamed", type: "research", contracts: ["Stable API"], watchdog: { idle_ms: 5000 } });
    expect(renamed.assignment.renamed).toBe(base.assignment.api);
    expect(renamed.agents).toEqual(base.agents);
    expect(renamed.execution).toEqual({ verifier_model: "changed-verifier" });
    expect(base.execution?.verifier_model).toBe("fixture-verifier");
  });
  it("leaves legacy blank selections absent and clears explicit role overrides", () => {
    const blank = { producer_model: " ", verifier_model: "", integration_verifier_model: "" };
    const legacy = planSpec("Ship", [task], 1000, "check");
    expect(planSpec("Ship", restoredTasks(legacy), 1000, "check", blank, legacy)).toEqual(legacy);
    expect(legacy).not.toHaveProperty("execution");
    const selected = planSpec("Ship", [task], 1000, "check", { producer_model: " fixture-producer ", verifier_model: "fixture-verifier" });
    expect(selected.execution?.producer_model).toBe("fixture-producer");
    expect(planSpec("Ship", restoredTasks(selected), 1000, "check", blank, selected)).not.toHaveProperty("execution");
  });
  it("validates model bounds without restricting provider-specific IDs", () => {
    expect(planIssues(planSpec("Ship", [task], 1000, "check", { verifier_model: "vendor/model:v2" }), 2)).toEqual([]);
    expect(planIssues(planSpec("Ship", [task], 1000, "check", { verifier_model: "😀".repeat(200) }), 2)).toEqual([]);
    for (const model of ["bad model", "-flag", "x".repeat(201), "😀".repeat(201), "bad\u0001model"]) {
      expect(planIssues(planSpec("Ship", [task], 1000, "check", { producer_model: model }), 2).join(" ")).toContain("Model IDs");
    }
  });
  it("blocks missing evidence, unsafe IDs, invalid limits and dependency cycles", () => {
    const invalid = planSpec("", [{ ...task, id: "../bad", estimate: 0, owns: "", acceptance: "" }, { ...task, id: "b", dependencies: "c" }, { ...task, id: "c", dependencies: "b" }], 0, "");
    const issues = planIssues(invalid, 0).join(" ");
    expect(issues).toContain("positive estimated token budget"); expect(issues).toContain("goal"); expect(issues).toContain("positive token budget"); expect(issues).toContain("Concurrency"); expect(issues).toContain("combined verification"); expect(issues).toContain("cycle"); expect(issues).toContain("Owned".toLowerCase());
  });
});

describe("explicit launch and recovery review gates", () => {
  const ready = { enabled: true, disabled: false, busy: false, running: false, valid: true, saved: true, reviewed: true, approval: true };
  it("requires saved review plus approval and an available writable capability", () => {
    expect(launchReady(ready)).toEqual({ approve: false, start: true });
    for (const patch of [{ enabled: false }, { disabled: true }, { busy: true }, { running: true }, { valid: false }, { saved: false }, { reviewed: false }]) expect(launchReady({ ...ready, ...patch }).start).toBe(false);
    expect(launchReady({ ...ready, approval: false })).toEqual({ approve: true, start: false });
  });
  it("binds resume to the exact inspected token and valid concurrency", () => {
    const inspected = { ...ready, canResume: true, token: "inspection-2", reviewed: "inspection-2", concurrency: 2 };
    expect(recoveryReady(inspected)).toBe(true);
    expect(recoveryReady({ ...inspected, reviewed: "inspection-1" })).toBe(false);
    expect(recoveryReady({ ...inspected, canResume: false })).toBe(false);
    expect(recoveryReady({ ...inspected, concurrency: 9 })).toBe(false);
    expect(recoveryReady({ ...inspected, enabled: false })).toBe(false);
  });
});

describe("workspace execution guard", () => {
  const base = { state: { outcome: null, units: { task: { status: "pending" } } }, launch: { status: "idle" } } as unknown as Parameters<typeof workspaceHasExecution>[0];
  it("allows an approved pending run but blocks progressed and terminal missions", () => {
    expect(workspaceHasExecution(base)).toBe(false);
    expect(workspaceHasExecution({ ...base, state: { ...base.state, specApproved: true } })).toBe(false);
    expect(workspaceHasExecution({ ...base, launch: { enabled: true, status: "stopped" } })).toBe(true);
    expect(workspaceHasExecution({ ...base, state: { ...base.state, outcome: "done" } })).toBe(true);
    expect(workspaceHasExecution({ ...base, state: { ...base.state, units: { task: { ...base.state.units.task!, status: "accepted" } } } })).toBe(true);
  });
});


it("round-trips editable generated assumptions and unresolved questions while preserving advanced settings", () => {
  const generated = planSpec("Audit", [task], 10000, "read report");
  generated.meta.constraints = ["Keep existing APIs\nNo migrations"]; generated.meta.assumptions = ["Initial assumption"]; generated.meta.open_questions = ["Initial question"];
  generated.work_units[0]!.type = "research"; generated.agents[0]!.capabilities = { tools: ["inspect"] };
  const edited = planSpec("Audit", restoredTasks(generated), 10000, "read report", undefined, generated, { assumptions: ["Confirmed scope"], open_questions: [] });
  expect(edited.meta).toEqual({ goal: "Audit", constraints: ["Keep existing APIs\nNo migrations"], assumptions: ["Confirmed scope"], open_questions: [] });
  expect(edited.work_units).toEqual(generated.work_units);
  expect(edited.agents).toEqual(generated.agents);
  expect(generated.meta.open_questions).toEqual(["Initial question"]);
});
