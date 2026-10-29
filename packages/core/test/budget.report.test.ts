import { describe, expect, it } from "vitest";
import { buildBudgetReport, renderBudgetReport } from "../src/budget/report.js";
import { reduceLedger } from "../src/ledger/reduce.js";
import { eventStream, openedRun } from "./ledger.fixtures.js";

function stateWithSpend() {
  const opened = openedRun();
  // Attach a budget target to the approval event.
  const approved = opened[2]![1]!;
  (approved.data as Record<string, unknown>).budget_target = 500_000;

  return reduceLedger(
    eventStream([
      ...opened,
      ["budget.estimated", { unit_id: "wu-db", data: { tokens: 40_000 } }],
      ["budget.estimated", { unit_id: "wu-api", data: { tokens: 80_000 } }],
      ["unit.started", { unit_id: "wu-db" }],
      ["budget.spent", { unit_id: "wu-db", data: { tokens: 60_000 } }],
      ["unit.verify_started", { unit_id: "wu-db" }],
      ["unit.accepted", { unit_id: "wu-db" }],
      ["unit.started", { unit_id: "wu-api" }],
      ["budget.spent", { unit_id: "wu-api", data: { tokens: 20_000 } }],
      ["budget.spent", { data: { tokens: 5_000 } }], // orchestrator overhead
    ]),
  );
}

describe("buildBudgetReport", () => {
  it("derives target, totals, and per-unit attribution", () => {
    const report = buildBudgetReport(stateWithSpend());
    expect(report.target).toBe(500_000);
    expect(report.totalSpent).toBe(85_000);
    expect(report.unattributed).toBe(5_000);
    expect(report.remaining).toBe(415_000);
    expect(report.exhausted).toBe(false);

    const db = report.units.find((u) => u.unit === "wu-db")!;
    expect(db).toMatchObject({ status: "accepted", estimated: 40_000, spent: 60_000 });
    expect(db.deviation).toBeCloseTo(0.5); // 3x over would teach; +50% teaches too

    const docs = report.units.find((u) => u.unit === "wu-docs")!;
    expect(docs.deviation).toBeNull(); // no estimate, no deviation claim
  });

  it("handles the no-target case", () => {
    const report = buildBudgetReport(reduceLedger(eventStream(openedRun())));
    expect(report.target).toBeNull();
    expect(report.remaining).toBeNull();
    expect(report.totalSpent).toBe(0);
  });
});

describe("renderBudgetReport", () => {
  it("renders a markdown table with deviations", () => {
    const md = renderBudgetReport(buildBudgetReport(stateWithSpend()));
    expect(md).toContain("## Budget");
    expect(md).toContain("Target: **500000** tokens");
    expect(md).toContain("| `wu-db` | accepted | 40000 | 60000 | +50% |");
    expect(md).toContain("| `wu-api` | running | 80000 | 20000 | -75% |");
    expect(md).toContain("_(unattributed)_");
  });

  it("marks a reached budget target", () => {
    const state = stateWithSpend();
    state.budgetExhausted = true;
    expect(renderBudgetReport(buildBudgetReport(state))).toContain("TARGET REACHED");
  });
});
