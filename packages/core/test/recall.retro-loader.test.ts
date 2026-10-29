import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { buildRetroRecord, writeRetroRecord } from "../src/retro/record.js";
import { loadRetroRecords, validateRetroRecord } from "../src/recall/retro-loader.js";
import { reduceLedger } from "../src/ledger/reduce.js";
import { eventStream, openedRun } from "./ledger.fixtures.js";

const clock = () => new Date("2026-01-02T09:00:00Z");

function finishedRunState() {
  return reduceLedger(
    eventStream([
      ...openedRun(),
      ["unit.started", { unit_id: "wu-db", agent_id: "backend-builder" }],
      ["budget.spent", { unit_id: "wu-db", data: { tokens: 30_000 } }],
      ["unit.accepted", { unit_id: "wu-db" }],
      ["run.completed", { data: { outcome: "done" } }],
    ]),
  );
}

describe("validateRetroRecord", () => {
  it("accepts a well-formed record", () => {
    const record = buildRetroRecord(finishedRunState(), { clock });
    expect(validateRetroRecord(record)).toBe(true);
  });

  it("rejects records missing required fields", () => {
    expect(validateRetroRecord({})).toBe(false);
    expect(validateRetroRecord({ retro_schema_version: 1, run_id: "" })).toBe(false);
    expect(validateRetroRecord(null)).toBe(false);
    expect(validateRetroRecord("not an object")).toBe(false);
  });

  it("rejects a record with a malformed unit entry", () => {
    const record = buildRetroRecord(finishedRunState(), { clock });
    const broken = { ...record, units: [{ unit: "wu-db" }] };
    expect(validateRetroRecord(broken)).toBe(false);
  });
});

describe("loadRetroRecords", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-recall-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads every valid retro-*.yaml file in the directory", async () => {
    const a = buildRetroRecord(finishedRunState(), { clock, context: { project_type: "web-saas" } });
    await writeRetroRecord(dir, a);

    const result = await loadRetroRecords(dir);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.run_id).toBe(a.run_id);
  });

  it("ignores files that don't match the retro-*.yaml naming convention", async () => {
    await writeFile(join(dir, "notes.yaml"), "hello: world\n", "utf8");
    const result = await loadRetroRecords(dir);
    expect(result.records).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("reports malformed YAML without throwing", async () => {
    await writeFile(join(dir, "retro-broken.yaml"), "not: [valid: yaml", "utf8");
    const result = await loadRetroRecords(dir);
    expect(result.records).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toContain("retro-broken.yaml");
    expect(result.errors[0]?.message).toMatch(/invalid YAML/);
  });

  it("reports YAML that doesn't match the retro record shape", async () => {
    await writeFile(join(dir, "retro-shapeless.yaml"), "hello: world\n", "utf8");
    const result = await loadRetroRecords(dir);
    expect(result.records).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/shape/);
  });

  it("keeps loading valid records alongside malformed ones", async () => {
    const a = buildRetroRecord(finishedRunState(), { clock });
    await writeRetroRecord(dir, a);
    await writeFile(join(dir, "retro-broken.yaml"), "not: [valid: yaml", "utf8");

    const result = await loadRetroRecords(dir);
    expect(result.records).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("reports a directory read failure without throwing", async () => {
    const missing = join(dir, "does-not-exist");
    const result = await loadRetroRecords(missing);
    expect(result.records).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("sorts loaded records by file name", async () => {
    const state = finishedRunState();
    const a = { ...buildRetroRecord(state, { clock }), run_id: "run-b" };
    const b = { ...buildRetroRecord(state, { clock }), run_id: "run-a" };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "retro-run-b.yaml"), YAML.stringify(a), "utf8");
    await writeFile(join(dir, "retro-run-a.yaml"), YAML.stringify(b), "utf8");

    const result = await loadRetroRecords(dir);
    expect(result.records.map((r) => r.run_id)).toEqual(["run-a", "run-b"]);
  });
});
