import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadThresholds, ThresholdsError } from "../src/gpcheck/thresholds.js";

const REAL_THRESHOLDS_DIR = join(__dirname, "..", "..", "..", "golden-paths", "thresholds");

describe("loadThresholds — real files", () => {
  it.each(["gp-1", "gp-2", "gp-3"])("loads and validates %s.json", async (gp) => {
    const thresholds = await loadThresholds(join(REAL_THRESHOLDS_DIR, `${gp}.json`));
    expect(thresholds.schema_version).toBe(1);
    expect(thresholds.golden_path).toBe(gp);
    expect(thresholds.mechanical.required_outcome).toBe("done");
    expect(thresholds.manual.length).toBeGreaterThan(0);
  });

  it("gp-2 carries a team threshold", async () => {
    const thresholds = await loadThresholds(join(REAL_THRESHOLDS_DIR, "gp-2.json"));
    expect(thresholds.mechanical.team).toEqual({ max_units: 3, max_agents: 2 });
  });
});

describe("loadThresholds — round-trip and validation", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-thresholds-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a well-formed file", async () => {
    const file = join(dir, "gp-x.json");
    const doc = {
      schema_version: 1,
      golden_path: "gp-x",
      source: "gp-x.md",
      mechanical: {
        required_outcome: "done",
        max_interventions_execute: 2,
        max_budget_deviation_pct: 30,
        max_anomalies: 0,
        max_ledger_errors: 0,
      },
      manual: ["Acceptance criteria pass"],
    };
    await writeFile(file, JSON.stringify(doc), "utf8");
    const loaded = await loadThresholds(file);
    expect(loaded).toEqual(doc);
  });

  it("throws a typed error for a missing file", async () => {
    await expect(loadThresholds(join(dir, "missing.json"))).rejects.toThrow(ThresholdsError);
  });

  it("throws a typed error for invalid JSON", async () => {
    const file = join(dir, "broken.json");
    await writeFile(file, "{not json", "utf8");
    await expect(loadThresholds(file)).rejects.toThrow(ThresholdsError);
  });

  it("collects every shape issue rather than stopping at the first", async () => {
    const file = join(dir, "invalid.json");
    await writeFile(
      file,
      JSON.stringify({
        schema_version: 2,
        mechanical: { required_outcome: "maybe", max_anomalies: "zero" },
        manual: "not-an-array",
      }),
      "utf8",
    );
    try {
      await loadThresholds(file);
      expect.unreachable("expected loadThresholds to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ThresholdsError);
      const issues = (err as ThresholdsError).issues;
      expect(issues.some((i) => i.includes("schema_version"))).toBe(true);
      expect(issues.some((i) => i.includes("golden_path"))).toBe(true);
      expect(issues.some((i) => i.includes("required_outcome"))).toBe(true);
      expect(issues.some((i) => i.includes("max_anomalies"))).toBe(true);
      expect(issues.some((i) => i.includes("manual"))).toBe(true);
    }
  });

  it("accepts an optional team threshold and rejects a malformed one", async () => {
    const goodFile = join(dir, "good-team.json");
    await writeFile(
      goodFile,
      JSON.stringify({
        schema_version: 1,
        golden_path: "gp-x",
        source: "gp-x.md",
        mechanical: {
          required_outcome: "done",
          max_interventions_execute: 1,
          max_budget_deviation_pct: 25,
          max_anomalies: 0,
          max_ledger_errors: 0,
          team: { max_units: 3, max_agents: 2 },
        },
        manual: [],
      }),
      "utf8",
    );
    await expect(loadThresholds(goodFile)).resolves.toMatchObject({
      mechanical: { team: { max_units: 3, max_agents: 2 } },
    });

    const badFile = join(dir, "bad-team.json");
    await writeFile(
      badFile,
      JSON.stringify({
        schema_version: 1,
        golden_path: "gp-x",
        source: "gp-x.md",
        mechanical: {
          required_outcome: "done",
          max_interventions_execute: 1,
          max_budget_deviation_pct: 25,
          max_anomalies: 0,
          max_ledger_errors: 0,
          team: { max_units: "three" },
        },
        manual: [],
      }),
      "utf8",
    );
    await expect(loadThresholds(badFile)).rejects.toThrow(ThresholdsError);
  });
});
