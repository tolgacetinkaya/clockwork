/** Markdown projection of a CheckResult — house style, see budget/report.ts. */

import type { CheckResult, CheckRow } from "./check.js";

const VERDICT_LABEL: Record<CheckRow["verdict"], string> = {
  pass: "PASS",
  fail: "FAIL",
  manual: "MANUAL",
};

export function renderCheck(result: CheckResult): string {
  const out: string[] = [`## GP verify — ${result.goldenPath}`, ""];
  out.push(`Evidence: \`${result.evidenceDir}\` · Overall: **${result.verdict.toUpperCase()}**`);
  out.push("");

  out.push("| Row | Kind | Verdict | Expected | Actual |");
  out.push("|---|---|---|---|---|");
  for (const row of result.rows) {
    out.push(`| ${row.name} | ${row.kind} | ${VERDICT_LABEL[row.verdict]} | ${row.expected} | ${row.actual} |`);
  }
  out.push("");

  const manualCount = result.rows.filter((r) => r.kind === "manual").length;
  if (manualCount > 0) {
    out.push(
      `${manualCount} row(s) require manual review — this run cannot be marked pass until a reviewer signs off on them.`,
    );
    out.push("");
  }

  return out.join("\n");
}
