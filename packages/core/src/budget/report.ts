/**
 * Budget telemetry (CONCEPT.md §4.4, Phase 1 scope).
 *
 * A meter, not a manager: this module measures and reports per-unit spend so
 * deviations are attributable ("wu-auth cost 3x its estimate" teaches;
 * "the total was exceeded" does not). Smart spending arrives in Phase 2 —
 * measurement cannot be retrofitted, so it ships in the MVP.
 */

import type { RunState, UnitStatus } from "../ledger/reduce.js";

export interface UnitBudgetLine {
  unit: string;
  status: UnitStatus;
  estimated: number;
  spent: number;
  /** (spent - estimated) / estimated; null when there is no estimate. */
  deviation: number | null;
}

export interface BudgetReport {
  /** Tokens; null when no target was set. */
  target: number | null;
  totalSpent: number;
  /** Spend not attributed to any unit (orchestrator overhead, research...). */
  unattributed: number;
  /** target - totalSpent; null without a target. */
  remaining: number | null;
  exhausted: boolean;
  units: UnitBudgetLine[];
}

export function buildBudgetReport(state: RunState): BudgetReport {
  const units: UnitBudgetLine[] = Object.entries(state.units).map(([unit, u]) => ({
    unit,
    status: u.status,
    estimated: u.estimated,
    spent: u.spent,
    deviation: u.estimated > 0 ? (u.spent - u.estimated) / u.estimated : null,
  }));

  const attributed = units.reduce((sum, u) => sum + u.spent, 0);

  return {
    target: state.budgetTarget,
    totalSpent: state.totalSpent,
    unattributed: state.totalSpent - attributed,
    remaining: state.budgetTarget === null ? null : state.budgetTarget - state.totalSpent,
    exhausted: state.budgetExhausted,
    units,
  };
}

function pct(deviation: number | null): string {
  if (deviation === null) return "—";
  const sign = deviation > 0 ? "+" : "";
  return `${sign}${Math.round(deviation * 100)}%`;
}

/** Markdown projection — used by milestone reports and the handoff report. */
export function renderBudgetReport(report: BudgetReport): string {
  const out: string[] = ["## Budget", ""];

  if (report.target !== null) {
    out.push(
      `Target: **${report.target}** tokens · Spent: **${report.totalSpent}** · Remaining: **${report.remaining}**${
        report.exhausted ? " · **TARGET REACHED**" : ""
      }`,
    );
  } else {
    out.push(`Spent: **${report.totalSpent}** tokens (no target set)`);
  }
  out.push("");

  out.push("| Unit | Status | Estimated | Spent | Δ |");
  out.push("|---|---|---:|---:|---:|");
  for (const u of report.units) {
    out.push(`| \`${u.unit}\` | ${u.status} | ${u.estimated || "—"} | ${u.spent} | ${pct(u.deviation)} |`);
  }
  if (report.unattributed > 0) {
    out.push(`| _(unattributed)_ | — | — | ${report.unattributed} | — |`);
  }
  out.push("");
  return out.join("\n");
}
