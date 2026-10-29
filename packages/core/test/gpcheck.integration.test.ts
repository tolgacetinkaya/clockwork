/**
 * Integration test against a REAL evidence bundle (read-only — never writes
 * into the historical fixture directory). Confirms the mechanical rows are actually computable from a
 * production ledger + retro record, not just from hand-built fixtures.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRun } from "../src/gpcheck/check.js";
import { loadThresholds } from "../src/gpcheck/thresholds.js";

const EVIDENCE_DIR = join(__dirname, "fixtures", "historical", "gp-3", "run-1");
const THRESHOLDS_FILE = join(__dirname, "..", "..", "..", "golden-paths", "thresholds", "gp-3.json");

describe("checkRun — real GP-3 run-1 evidence bundle", () => {
  it("passes every mechanical row and needs manual review overall", async () => {
    const thresholds = await loadThresholds(THRESHOLDS_FILE);
    const result = await checkRun({ evidenceDir: EVIDENCE_DIR, thresholds });

    const mechanical = result.rows.filter((r) => r.kind === "mechanical");
    const failing = mechanical.filter((r) => r.verdict !== "pass");
    expect(failing).toEqual([]);

    expect(result.verdict).toBe("needs-manual");
    expect(result.rows.some((r) => r.kind === "manual")).toBe(true);

    // Sanity on the actuals — matches the reviewed GP-3 historical outcome.
    const outcome = result.rows.find((r) => r.name === "outcome")!;
    expect(outcome.actual).toBe("done");

    const budget = result.rows.find((r) => r.name === "budget_deviation")!;
    expect(budget.actual).toBe("+10.1%"); // 330418 vs 300000 target
  });
});
