import { describe, expect, it } from "vitest";
import { buildPlanningPrompt, buildUnitPrompt, buildVerifierPrompt, planningProposalSchema, validatePlanningInput, validatePlanningProposal } from "../src/index.js";
import type { GoalPlanningInput, PlanningProposal } from "../src/index.js";
const input: GoalPlanningInput = { goal: "Research queue reliability without changing runtime behavior", budget: 10000, execution: { producer_model: "host/producer", verifier_model: "host/verifier" } };
function proposal(): PlanningProposal {
  return {
    summary: "Investigate and document queue reliability", assumptions: [], open_questions: [], global_gates: ["Findings cite repository evidence and reproducible checks"],
    work_units: [{ id: "investigate", type: "research", description: "Trace queue delivery and report failure modes", owns: ["reports/queue.md"], contracts: ["A source-backed reliability report"], depends_on: [], acceptance: ["Explain retry and duplicate delivery behavior with evidence"], budget_est: 2000, agent: { id: "researcher", purpose: "Investigate queue reliability", model_tier: "standard" } }],
  };
}
describe("goal planning contracts", () => {
  it.each(["Research queue reliability", "Fix duplicate queue delivery"])("keeps the supplied goal without imposing MVP scope: %s", goal => {
    const plan = validatePlanningProposal(proposal(), { ...input, goal });
    expect(plan.spec.meta.goal).toBe(goal);
    expect(plan.spec.execution).toEqual(input.execution);
    expect(plan.spec.priorities.budget_target).toBe(10000);
    expect(plan.spec.assignment).toEqual({ investigate: "researcher" });
    expect(plan.spec.work_units[0]).not.toHaveProperty("agent");
    expect(plan.spec.work_units[0]).not.toHaveProperty("allowed_test_changes");
    expect(plan.spec.agents[0]).not.toHaveProperty("permissions");
  });
  it("prompts for the actual goal, read-only inspection, critical questions and verification reserve", () => {
    const prompt = buildPlanningPrompt(input);
    expect(prompt).toContain(input.goal);
    expect(prompt).toContain("Never reinterpret every goal as an MVP");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Twice their sum");
    expect(prompt).toContain("No separate integration token reservation is enforced");
    expect(prompt).toContain("only critical ambiguities");
    expect(prompt).not.toContain("host/producer");
  });
  it.each([null, {}, { ...input, goal: " " }, { ...input, budget: 1 }, { ...input, budget: 2.1 }, { ...input, budget: Infinity }, { ...input, execution: { producer_model: "--unsafe" } }, { ...input, instructions: "extra" }, { ...input, constraints: "secret\0data" }])("rejects invalid host input", value => {
    expect(() => validatePlanningInput(value)).toThrow(/Invalid goal planning input/);
  });
  it("requires all provider object properties and forbids extra ones recursively", () => {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(Object.keys(schema.properties as object).sort());
      }
      Object.values(schema).forEach(value => Array.isArray(value) ? value.forEach(visit) : visit(value));
    };
    visit(planningProposalSchema);
    for (const inject of [
      (p: any) => { p.execution = { producer_model: "invented" }; },
      (p: any) => { p.work_units[0].allowed_test_changes = ["test.ts"]; },
      (p: any) => { p.work_units[0].agent.permissions = ["network"]; },
      (p: any) => { delete p.global_gates; },
      (p: any) => { p.global_gates = []; },
      (p: any) => { p.summary = " "; },
    ]) {
      const value = proposal(); inject(value);
      expect(() => validatePlanningProposal(value, input)).toThrow(/Invalid structured/);
    }
  });
  it("rejects budget overcommit including verification reserve", () => {
    const value = proposal(); value.work_units[0]!.budget_est = 5001;
    expect(() => validatePlanningProposal(value, input)).toThrow(/verification reserve/);
    value.work_units[0]!.budget_est = 5000;
    expect(validatePlanningProposal(value, input).spec).toBeDefined();
  });
  it("reuses identical agents but rejects conflicting definitions and graph/ownership hazards", () => {
    const value = proposal();
    value.work_units.push({ ...structuredClone(value.work_units[0]!), id: "review", owns: ["reports/review.md"], depends_on: ["investigate"] });
    expect(validatePlanningProposal(value, input).spec.agents).toHaveLength(1);
    value.work_units[1]!.agent.purpose = "Different purpose";
    expect(() => validatePlanningProposal(value, input)).toThrow(/conflicting agent/);
    value.work_units[1]!.agent.purpose = value.work_units[0]!.agent.purpose;
    value.work_units[0]!.depends_on = ["review"];
    expect(() => validatePlanningProposal(value, input)).toThrow(/dep-cycle/);
    value.work_units[0]!.depends_on = [];
    value.work_units[1]!.depends_on = [];
    value.work_units[1]!.owns = value.work_units[0]!.owns;
    expect(() => validatePlanningProposal(value, input)).toThrow(/owns-overlap/);
    value.work_units[1]!.owns = [".git/config"];
    expect(() => validatePlanningProposal(value, input)).toThrow(/invalid-ownership/);
  });
  it("preserves exact host constraints through spec validation and downstream producer/verifier prompts", () => {
    const constraints = "Do not alter runtime behavior.\nKeep the public queue API stable.";
    const value = proposal(); value.assumptions = ["A written diagnosis is the requested deliverable"];
    const plan = validatePlanningProposal(value, { ...input, constraints });
    expect(plan.spec.meta.constraints).toEqual([constraints]);
    for (const prompt of [buildUnitPrompt(plan.spec, "investigate"), buildVerifierPrompt(plan.spec, "investigate")]) {
      expect(prompt).toContain("## User constraints\n- " + constraints);
      expect(prompt).toContain("## Approved assumptions\n- " + value.assumptions[0]);
      expect(prompt).toContain("take precedence over assumptions");
    }
    expect(() => validatePlanningProposal({ ...value, constraints: ["Invented model policy"] }, { ...input, constraints })).toThrow(/Invalid structured/);
    expect(validatePlanningProposal(value, input).spec.meta.constraints).toBeUndefined();
  });
  it("retains critical open questions and snapshots the proposal", () => {
    const value = proposal(); value.open_questions = ["Which production queue must be investigated?"];
    const plan = validatePlanningProposal(value, input);
    value.work_units[0]!.description = "mutated";
    expect(plan.spec.meta.open_questions).toEqual(["Which production queue must be investigated?"]);
    expect(plan.spec.work_units[0]!.description).not.toBe("mutated");
  });
});
