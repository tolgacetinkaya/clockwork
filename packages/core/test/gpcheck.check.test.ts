import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerWriter } from "../src/ledger/store.js";
import { checkRun, CheckRunError } from "../src/gpcheck/check.js";
import type { GpThresholds } from "../src/gpcheck/types.js";

const clock = () => new Date("2026-01-01T00:00:00Z");

const THRESHOLDS: GpThresholds = {
  schema_version: 1,
  golden_path: "gp-test",
  source: "gp-test.md",
  mechanical: {
    required_outcome: "done",
    max_interventions_execute: 3,
    max_budget_deviation_pct: 40,
    max_anomalies: 0,
    max_ledger_errors: 0,
  },
  manual: ["Acceptance criteria pass (verifier-confirmed)", "App round-trip works"],
};

async function openLedger(dir: string): Promise<LedgerWriter> {
  return LedgerWriter.open(join(dir, "ledger.jsonl"), { clock });
}

/** Standard opening: run.started + intake->execute + an approved single-unit spec. */
async function openRun(writer: LedgerWriter, budgetTarget?: number): Promise<void> {
  await writer.append("run.started", { data: { run_id: "run-x", teamsmith_version: "0.1.0", ledger_schema_version: 1 } });
  await writer.append("run.phase_entered", { data: { phase: "intake" } });
  await writer.append("spec.approved", {
    actor: "user",
    data: {
      version: 1,
      ...(budgetTarget !== undefined ? { budget_target: budgetTarget } : {}),
      units: [{ id: "wu-a" }],
    },
  });
  await writer.append("run.phase_entered", { data: { phase: "execute" } });
}

async function acceptUnit(writer: LedgerWriter, unitId: string, spent: number): Promise<void> {
  await writer.append("unit.started", { unit_id: unitId, agent_id: "builder-1" });
  await writer.append("budget.spent", { unit_id: unitId, data: { tokens: spent } });
  await writer.append("unit.verify_started", { unit_id: unitId });
  await writer.append("unit.accepted", { unit_id: unitId });
}

describe("checkRun", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-gpcheck-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes every mechanical row and reports needs-manual overall", async () => {
    const writer = await openLedger(dir);
    await openRun(writer, 100_000);
    await acceptUnit(writer, "wu-a", 110_000); // +10%, within +40%
    await writer.append("run.phase_entered", { data: { phase: "retro" } });
    await writer.append("run.completed", { data: { outcome: "done" } });

    const result = await checkRun({ evidenceDir: dir, thresholds: THRESHOLDS });

    expect(result.verdict).toBe("needs-manual");
    const mechanical = result.rows.filter((r) => r.kind === "mechanical");
    expect(mechanical.every((r) => r.verdict === "pass")).toBe(true);
    const manual = result.rows.filter((r) => r.kind === "manual");
    expect(manual).toHaveLength(2);
    expect(manual.every((r) => r.verdict === "manual")).toBe(true);

    const budget = result.rows.find((r) => r.name === "budget_deviation")!;
    expect(budget.actual).toBe("+10%");
  });

  it("fails the budget row when spend blows through the deviation threshold", async () => {
    const writer = await openLedger(dir);
    await openRun(writer, 100_000);
    await acceptUnit(writer, "wu-a", 250_000); // +150%
    await writer.append("run.completed", { data: { outcome: "done" } });

    const result = await checkRun({ evidenceDir: dir, thresholds: THRESHOLDS });

    expect(result.verdict).toBe("fail");
    const budget = result.rows.find((r) => r.name === "budget_deviation")!;
    expect(budget.verdict).toBe("fail");
    expect(budget.actual).toBe("+150%");
  });

  it("fails the anomalies row when the ledger contains an illegal transition", async () => {
    const writer = await openLedger(dir);
    await openRun(writer, 100_000);
    // wu-a is "pending" — accepting it directly (no started/verify_started) is illegal.
    await expect(writer.append("unit.accepted", { unit_id: "wu-a" })).rejects.toThrow(/invalid transition/);
    // Simulate an externally damaged historical ledger; normal append now prevents this.
    await appendFile(join(dir, "ledger.jsonl"), JSON.stringify({
      seq: 5, ts: clock().toISOString(), actor: "orchestrator",
      type: "unit.accepted", unit_id: "wu-a",
    }) + "\n");

    const result = await checkRun({ evidenceDir: dir, thresholds: THRESHOLDS });

    expect(result.verdict).toBe("fail");
    const anomalies = result.rows.find((r) => r.name === "anomalies")!;
    expect(anomalies.verdict).toBe("fail");
    expect(anomalies.actual).toContain("unit.accepted");
  });

  it("fails the budget row explicitly when no target was ever recorded", async () => {
    const writer = await openLedger(dir);
    await openRun(writer); // no budget_target
    await acceptUnit(writer, "wu-a", 10_000);
    await writer.append("run.completed", { data: { outcome: "done" } });

    const result = await checkRun({ evidenceDir: dir, thresholds: THRESHOLDS });

    const budget = result.rows.find((r) => r.name === "budget_deviation")!;
    expect(budget.verdict).toBe("fail");
    expect(budget.actual).toBe("no target recorded");
    expect(result.verdict).toBe("fail");
  });

  it("throws a typed error when the evidence dir has no ledger", async () => {
    await expect(checkRun({ evidenceDir: dir, thresholds: THRESHOLDS })).rejects.toThrow(CheckRunError);
  });

  it("fails the outcome row when the run never completed", async () => {
    const writer = await openLedger(dir);
    await openRun(writer, 100_000);
    await acceptUnit(writer, "wu-a", 90_000);
    // no run.completed

    const result = await checkRun({ evidenceDir: dir, thresholds: THRESHOLDS });
    const outcome = result.rows.find((r) => r.name === "outcome")!;
    expect(outcome.verdict).toBe("fail");
    expect(outcome.actual).toContain("no run.completed");
  });

  it("flags a mismatch between ledger outcome and the retro record's outcome", async () => {
    const writer = await openLedger(dir);
    await openRun(writer, 100_000);
    await acceptUnit(writer, "wu-a", 90_000);
    await writer.append("run.completed", { data: { outcome: "done" } });

    const retroDir = join(dir, "retro");
    await mkdir(retroDir, { recursive: true });
    await writeFile(join(retroDir, "retro-run-x.yaml"), "run_id: run-x\noutcome: abandoned\n", "utf8");

    const result = await checkRun({ evidenceDir: dir, thresholds: THRESHOLDS });
    const outcome = result.rows.find((r) => r.name === "outcome")!;
    expect(outcome.verdict).toBe("fail");
    expect(outcome.actual).toContain("mismatch");
  });

  it("evaluates rework and team-size rows when present in the thresholds", async () => {
    const writer = await openLedger(dir);
    await writer.append("run.started", { data: { run_id: "run-x" } });
    await writer.append("run.phase_entered", { data: { phase: "execute" } });
    await writer.append("spec.approved", {
      data: { version: 1, budget_target: 100_000, units: [{ id: "wu-a" }, { id: "wu-b" }] },
    });
    await writer.append("unit.started", { unit_id: "wu-a", agent_id: "builder-1" });
    await writer.append("unit.verify_started", { unit_id: "wu-a" });
    await writer.append("unit.rework", { unit_id: "wu-a" });
    await writer.append("unit.started", { unit_id: "wu-a", agent_id: "builder-1" });
    await writer.append("unit.verify_started", { unit_id: "wu-a" });
    await writer.append("unit.accepted", { unit_id: "wu-a" });
    await writer.append("unit.started", { unit_id: "wu-b", agent_id: "builder-2" });
    await writer.append("unit.verify_started", { unit_id: "wu-b" });
    await writer.append("unit.accepted", { unit_id: "wu-b" });
    await writer.append("run.completed", { data: { outcome: "done" } });

    const thresholds: GpThresholds = {
      ...THRESHOLDS,
      mechanical: {
        ...THRESHOLDS.mechanical,
        max_rework_total: 0,
        team: { max_units: 1, max_agents: 1 },
      },
    };

    const result = await checkRun({ evidenceDir: dir, thresholds });
    expect(result.rows.find((r) => r.name === "rework_total")).toMatchObject({ verdict: "fail", actual: "1" });
    expect(result.rows.find((r) => r.name === "team_units")).toMatchObject({ verdict: "fail", actual: "2" });
    expect(result.rows.find((r) => r.name === "team_agents")).toMatchObject({ verdict: "fail", actual: "2" });
  });
});
