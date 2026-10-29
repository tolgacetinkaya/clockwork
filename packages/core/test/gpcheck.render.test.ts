import { describe, expect, it } from "vitest";
import { renderCheck } from "../src/gpcheck/render.js";
import type { CheckResult } from "../src/gpcheck/check.js";

function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    goldenPath: "gp-1",
    evidenceDir: "/runs/gp-1/run-4/teamsmith-evidence",
    rows: [
      { name: "outcome", kind: "mechanical", verdict: "pass", expected: "done", actual: "done" },
      { name: "budget_deviation", kind: "mechanical", verdict: "fail", expected: "<= +40%", actual: "+62%" },
      {
        name: "All acceptance criteria pass (verifier-confirmed)",
        kind: "manual",
        verdict: "manual",
        expected: "All acceptance criteria pass (verifier-confirmed)",
        actual: "not evaluated — requires human or agent review",
      },
    ],
    verdict: "fail",
    ...overrides,
  };
}

describe("renderCheck", () => {
  it("renders the golden path, overall verdict, and a markdown table", () => {
    const md = renderCheck(result());
    expect(md).toContain("## GP verify — gp-1");
    expect(md).toContain("Overall: **FAIL**");
    expect(md).toContain("| outcome | mechanical | PASS | done | done |");
    expect(md).toContain("| budget_deviation | mechanical | FAIL | <= +40% | +62% |");
    expect(md).toContain("| All acceptance criteria pass (verifier-confirmed) | manual | MANUAL |");
  });

  it("notes how many rows still need manual review", () => {
    const md = renderCheck(result());
    expect(md).toContain("1 row(s) require manual review");
  });

  it("still calls out manual review even when mechanics all pass", () => {
    const md = renderCheck(
      result({
        verdict: "needs-manual",
        rows: [
          { name: "outcome", kind: "mechanical", verdict: "pass", expected: "done", actual: "done" },
          {
            name: "App round-trip works",
            kind: "manual",
            verdict: "manual",
            expected: "App round-trip works",
            actual: "not evaluated — requires human or agent review",
          },
        ],
      }),
    );
    expect(md).toContain("Overall: **NEEDS-MANUAL**");
    expect(md).toContain("1 row(s) require manual review");
  });
});
