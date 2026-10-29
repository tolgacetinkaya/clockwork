import { describe, expect, it } from "vitest";
import type { RetroRecord } from "../src/retro/record.js";
import { buildExperiencePrior } from "../src/recall/experience-prior.js";

function record(overrides: Partial<RetroRecord> & { run_id: string }): RetroRecord {
  return {
    retro_schema_version: 1,
    teamsmith_version: "0.1.0",
    recorded_at: "2026-01-02T09:00:00.000Z",
    context: { project_type: "web-saas" },
    spec_final_version: 1,
    outcome: "done",
    budget: { target: 100_000, total_spent: 100_000 },
    signals: { human_interventions: 0, human_interventions_execute: 0, rework_total: 0, escalation_max_step: 0, anomalies: 0 },
    units: [],
    ...overrides,
  };
}

describe("buildExperiencePrior", () => {
  it("returns a cold-start prior with no matching runs", () => {
    const prior = buildExperiencePrior([], { projectType: "web-saas" });
    expect(prior.project_type).toBe("web-saas");
    expect(prior.matching_runs).toEqual([]);
    expect(prior.estimation_calibration).toEqual([]);
    expect(prior.team_size_norms).toEqual([]);
    expect(prior.warnings).toEqual([]);
    expect(prior.confidence).toBe("none");
  });

  it("filters matching runs by context.project_type", () => {
    const webRun = record({ run_id: "run-a", context: { project_type: "web-saas" } });
    const cliRun = record({ run_id: "run-b", context: { project_type: "cli-tool" } });
    const prior = buildExperiencePrior([webRun, cliRun], { projectType: "web-saas" });
    expect(prior.matching_runs.map((r) => r.run_id)).toEqual(["run-a"]);
  });

  it("includes all records when no project type filter is given", () => {
    const a = record({ run_id: "run-a", context: { project_type: "web-saas" } });
    const b = record({ run_id: "run-b", context: { project_type: "cli-tool" } });
    const prior = buildExperiencePrior([a, b]);
    expect(prior.project_type).toBeUndefined();
    expect(prior.matching_runs.map((r) => r.run_id).sort()).toEqual(["run-a", "run-b"]);
  });

  it("aggregates spent/estimated ratios per unit id across matching runs", () => {
    const a = record({
      run_id: "run-a",
      units: [{ unit: "wu-frontend", status: "accepted", rework_attempts: 0, estimated: 100, spent: 150 }],
    });
    const b = record({
      run_id: "run-b",
      units: [{ unit: "wu-frontend", status: "accepted", rework_attempts: 0, estimated: 200, spent: 250 }],
    });
    const prior = buildExperiencePrior([a, b], { projectType: "web-saas" });
    expect(prior.estimation_calibration).toEqual([
      { unit: "wu-frontend", samples: 2, mean_ratio: 1.375, deviation_pct: 38 },
    ]);
  });

  it("skips units with a zero or missing estimate when calibrating", () => {
    const a = record({
      run_id: "run-a",
      units: [{ unit: "wu-x", status: "accepted", rework_attempts: 0, estimated: 0, spent: 500 }],
    });
    const prior = buildExperiencePrior([a], { projectType: "web-saas" });
    expect(prior.estimation_calibration).toEqual([]);
  });

  it("computes team size norms per project type from unit and agent counts", () => {
    const a = record({
      run_id: "run-a",
      units: [
        { unit: "wu-a", status: "accepted", agent: "builder-1", rework_attempts: 0, estimated: 10, spent: 10 },
        { unit: "wu-b", status: "accepted", agent: "builder-2", rework_attempts: 0, estimated: 10, spent: 10 },
      ],
    });
    const b = record({
      run_id: "run-b",
      units: [{ unit: "wu-a", status: "accepted", agent: "builder-1", rework_attempts: 0, estimated: 10, spent: 10 }],
    });
    const prior = buildExperiencePrior([a, b], { projectType: "web-saas" });
    expect(prior.team_size_norms).toEqual([
      { project_type: "web-saas", samples: 2, mean_units: 1.5, mean_agents: 1.5 },
    ]);
  });

  it("warns on abandoned outcome, unsatisfied verdict, high rework, and high escalation", () => {
    const abandoned = record({ run_id: "run-abandoned", outcome: "abandoned" });
    const unsatisfied = record({ run_id: "run-unsatisfied", user_verdict: { satisfied: false, note: "too slow" } });
    const reworked = record({
      run_id: "run-rework",
      units: [{ unit: "wu-x", status: "accepted", rework_attempts: 2, estimated: 10, spent: 10 }],
    });
    const escalated = record({
      run_id: "run-escalation",
      signals: { human_interventions: 0, human_interventions_execute: 0, rework_total: 0, escalation_max_step: 3, anomalies: 0 },
    });

    const prior = buildExperiencePrior([abandoned, unsatisfied, reworked, escalated], { projectType: "web-saas" });
    const reasons = prior.warnings.map((w) => `${w.run_id}:${w.reason}`).sort();
    expect(reasons).toEqual([
      "run-abandoned:abandoned",
      "run-escalation:high_escalation",
      "run-rework:high_rework",
      "run-unsatisfied:unsatisfied",
    ]);
    const unsatisfiedWarning = prior.warnings.find((w) => w.run_id === "run-unsatisfied")!;
    expect(unsatisfiedWarning.detail).toBe("too slow");
  });

  it("does not warn on a satisfied, on-track run", () => {
    const clean = record({ run_id: "run-clean", user_verdict: { satisfied: true } });
    const prior = buildExperiencePrior([clean], { projectType: "web-saas" });
    expect(prior.warnings).toEqual([]);
  });

  it("reports low confidence for 1-2 matching runs and moderate/high beyond that", () => {
    const one = buildExperiencePrior([record({ run_id: "run-a" })], { projectType: "web-saas" });
    expect(one.confidence).toBe("low");

    const three = buildExperiencePrior(
      [record({ run_id: "run-a" }), record({ run_id: "run-b" }), record({ run_id: "run-c" })],
      { projectType: "web-saas" },
    );
    expect(three.confidence).toBe("moderate");

    const six = buildExperiencePrior(
      Array.from({ length: 6 }, (_, i) => record({ run_id: `run-${i}` })),
      { projectType: "web-saas" },
    );
    expect(six.confidence).toBe("high");
  });
});
