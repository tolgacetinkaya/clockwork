import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { reduceLedger } from "../src/ledger/reduce.js";
import {
  RETRO_SCHEMA_VERSION,
  buildRetroRecord,
  writeRetroRecord,
} from "../src/retro/record.js";
import { eventStream, openedRun } from "./ledger.fixtures.js";

const clock = () => new Date("2026-01-02T09:00:00Z");

function finishedRunState() {
  return reduceLedger(
    eventStream([
      ...openedRun(),
      ["unit.started", { unit_id: "wu-db", agent_id: "backend-builder" }],
      ["budget.spent", { unit_id: "wu-db", data: { tokens: 30_000 } }],
      ["unit.verify_started", { unit_id: "wu-db" }],
      ["unit.rework", { unit_id: "wu-db" }],
      ["escalation.step", { unit_id: "wu-db", data: { step: 1 } }],
      ["unit.started", { unit_id: "wu-db" }],
      ["unit.verify_started", { unit_id: "wu-db" }],
      ["unit.accepted", { unit_id: "wu-db" }],
      ["unit.started", { unit_id: "wu-api" }],
      ["unit.verify_started", { unit_id: "wu-api" }],
      ["unit.accepted", { unit_id: "wu-api" }],
      ["unit.started", { unit_id: "wu-front" }],
      ["unit.verify_started", { unit_id: "wu-front" }],
      ["unit.accepted", { unit_id: "wu-front" }],
      ["unit.started", { unit_id: "wu-docs" }],
      ["unit.verify_started", { unit_id: "wu-docs" }],
      ["unit.accepted", { unit_id: "wu-docs" }],
      ["interaction.checkpoint_raised", { data: { ref: "ms-1", kind: "milestone", blocking: false } }],
      ["interaction.checkpoint_resolved", { actor: "user", data: { ref: "ms-1" } }],
      ["run.completed", { data: { outcome: "done" } }],
    ]),
  );
}

describe("buildRetroRecord", () => {
  it("aggregates attributable signals per unit and in total", () => {
    const record = buildRetroRecord(finishedRunState(), {
      goal: "URL shortener",
      context: { bias: "thorough", project_type: "web-saas", platform: "claude-code" },
      userVerdict: { satisfied: true },
      clock,
    });

    expect(record.retro_schema_version).toBe(RETRO_SCHEMA_VERSION);
    expect(record.run_id).toBe("run-1");
    expect(record.teamsmith_version).toBe("0.1.0");
    expect(record.recorded_at).toBe("2026-01-02T09:00:00.000Z");
    expect(record.outcome).toBe("done");
    expect(record.context.project_type).toBe("web-saas");
    expect(record.budget.total_spent).toBe(30_000);
    expect(record.signals).toEqual({
      human_interventions: 1,
      human_interventions_execute: 1, // checkpoint resolved during execute phase
      rework_total: 1,
      escalation_max_step: 1,
      anomalies: 0,
    });

    const db = record.units.find((u) => u.unit === "wu-db")!;
    expect(db).toMatchObject({
      status: "accepted",
      agent: "backend-builder",
      rework_attempts: 1,
      escalation_step: 1,
      spent: 30_000,
    });
    expect(record.user_verdict).toEqual({ satisfied: true });
  });

  it("refuses to build a record without a run id", () => {
    const state = reduceLedger([]);
    expect(() => buildRetroRecord(state)).toThrow(/run id/);
  });
});

describe("writeRetroRecord", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-retro-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a YAML file named by run id and round-trips", async () => {
    const record = buildRetroRecord(finishedRunState(), { clock });
    const filePath = await writeRetroRecord(dir, record);
    expect(filePath.endsWith("retro-run-1.yaml")).toBe(true);

    const parsed = YAML.parse(await readFile(filePath, "utf8"));
    expect(parsed).toEqual(record);
  });

  it("never overwrites an existing record — records are immutable", async () => {
    const record = buildRetroRecord(finishedRunState(), { clock });
    await writeRetroRecord(dir, record);
    await expect(writeRetroRecord(dir, record)).rejects.toThrow(/immutable/);
  });
});
