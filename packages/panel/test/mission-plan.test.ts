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
