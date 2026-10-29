/**
 * Evaluates a golden-path evidence bundle against a threshold table.
 *
 * Reads `<evidenceDir>/ledger.jsonl` (via the core ledger reader/reducer) and,
 * when present, `<evidenceDir>/retro/retro-*.yaml` for an outcome cross-check.
 * Every MECHANICAL row in the thresholds is evaluated against the derived
 * state; every MANUAL row is carried through unevaluated — this function
 * never guesses at a judgment only a human or reviewing agent can make.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { readLedger } from "../ledger/store.js";
import { reduceLedger } from "../ledger/reduce.js";
import type { RunState } from "../ledger/reduce.js";
import type { ValidationIssue } from "../spec/types.js";
import type { GpThresholds } from "./types.js";

export type CheckVerdict = "pass" | "fail" | "manual";

export interface CheckRow {
  name: string;
  kind: "mechanical" | "manual";
  verdict: CheckVerdict;
  expected: string;
  actual: string;
}

export interface CheckResult {
  goldenPath: string;
  evidenceDir: string;
  rows: CheckRow[];
  /** fail if any mechanical row fails; needs-manual once mechanics pass but manual rows remain (they always do). */
  verdict: "pass" | "fail" | "needs-manual";
}

export interface CheckRunOptions {
  evidenceDir: string;
  thresholds: GpThresholds;
}

/** Typed error for evidence-bundle problems (e.g. no ledger present). */
export class CheckRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckRunError";
  }
}

export async function checkRun(options: CheckRunOptions): Promise<CheckResult> {
  const { evidenceDir, thresholds } = options;
  const ledgerPath = join(evidenceDir, "ledger.jsonl");

  try {
    await stat(ledgerPath);
  } catch {
    throw new CheckRunError(`No ledger found at "${ledgerPath}"`);
  }

  const { events, issues } = await readLedger(ledgerPath);
  const state = reduceLedger(events);
  const ledgerErrors = issues.filter((i) => i.level === "error");
  const retroOutcome = await loadRetroOutcome(evidenceDir);

  const m = thresholds.mechanical;
  const rows: CheckRow[] = [
    outcomeRow(state, retroOutcome, m.required_outcome),
    interventionsRow(state, m.max_interventions_execute),
    budgetRow(state, m.max_budget_deviation_pct),
    anomaliesRow(state, m.max_anomalies),
    ledgerErrorsRow(ledgerErrors, m.max_ledger_errors),
  ];
  if (m.max_rework_total !== undefined) {
    rows.push(reworkRow(state, m.max_rework_total));
  }
  if (m.team?.max_units !== undefined) {
    rows.push(teamUnitsRow(state, m.team.max_units));
  }
  if (m.team?.max_agents !== undefined) {
    rows.push(teamAgentsRow(state, m.team.max_agents));
  }
  for (const item of thresholds.manual) {
    rows.push({
      name: item,
      kind: "manual",
      verdict: "manual",
      expected: item,
      actual: "not evaluated — requires human or agent review",
    });
  }

  const mechanicalFailed = rows.some((r) => r.kind === "mechanical" && r.verdict === "fail");
  const hasManual = rows.some((r) => r.kind === "manual");
  const verdict: CheckResult["verdict"] = mechanicalFailed ? "fail" : hasManual ? "needs-manual" : "pass";

  return { goldenPath: thresholds.golden_path, evidenceDir, rows, verdict };
}

async function loadRetroOutcome(evidenceDir: string): Promise<string | null> {
  const retroDir = join(evidenceDir, "retro");
  let entries: string[];
  try {
    entries = await readdir(retroDir);
  } catch {
    return null;
  }
  const file = entries.find((f) => f.startsWith("retro-") && f.endsWith(".yaml"));
  if (!file) return null;

  const raw = await readFile(join(retroDir, file), "utf8");
  let doc: unknown;
  try {
    doc = YAML.parse(raw);
  } catch {
    return null;
  }
  const outcome = (doc as Record<string, unknown> | null)?.outcome;
  return typeof outcome === "string" ? outcome : null;
}

function outcomeRow(state: RunState, retroOutcome: string | null, required: "done" | "abandoned"): CheckRow {
  const name = "outcome";
  if (state.outcome === null) {
    return { name, kind: "mechanical", verdict: "fail", expected: required, actual: "no run.completed event recorded" };
  }
  if (retroOutcome !== null && retroOutcome !== state.outcome) {
    return {
      name,
      kind: "mechanical",
      verdict: "fail",
      expected: required,
      actual: `${state.outcome} (ledger) vs ${retroOutcome} (retro) — mismatch`,
    };
  }
  return {
    name,
    kind: "mechanical",
    verdict: state.outcome === required ? "pass" : "fail",
    expected: required,
    actual: state.outcome,
  };
}

function interventionsRow(state: RunState, max: number): CheckRow {
  const actual = state.userInterventionsExecute;
  return {
    name: "interventions_execute",
    kind: "mechanical",
    verdict: actual <= max ? "pass" : "fail",
    expected: `<= ${max}`,
    actual: String(actual),
  };
}

function budgetRow(state: RunState, maxPct: number): CheckRow {
  const name = "budget_deviation";
  const expected = `<= +${maxPct}%`;
  if (state.budgetTarget === null) {
    return { name, kind: "mechanical", verdict: "fail", expected, actual: "no target recorded" };
  }
  const deviationPct = ((state.totalSpent - state.budgetTarget) / state.budgetTarget) * 100;
  const sign = deviationPct >= 0 ? "+" : "";
  return {
    name,
    kind: "mechanical",
    verdict: deviationPct <= maxPct ? "pass" : "fail",
    expected,
    actual: `${sign}${round1(deviationPct)}%`,
  };
}

function anomaliesRow(state: RunState, max: number): CheckRow {
  const actual = state.anomalies.length;
  return {
    name: "anomalies",
    kind: "mechanical",
    verdict: actual <= max ? "pass" : "fail",
    expected: `<= ${max}`,
    actual: actual === 0 ? "0" : `${actual} (${state.anomalies.join("; ")})`,
  };
}

function ledgerErrorsRow(errors: ValidationIssue[], max: number): CheckRow {
  const actual = errors.length;
  return {
    name: "ledger_errors",
    kind: "mechanical",
    verdict: actual <= max ? "pass" : "fail",
    expected: `<= ${max}`,
    actual: actual === 0 ? "0" : `${actual} (${errors.map((e) => e.message).join("; ")})`,
  };
}

function reworkRow(state: RunState, max: number): CheckRow {
  const actual = Object.values(state.units).reduce((sum, u) => sum + u.reworkAttempts, 0);
  return {
    name: "rework_total",
    kind: "mechanical",
    verdict: actual <= max ? "pass" : "fail",
    expected: `<= ${max}`,
    actual: String(actual),
  };
}

function teamUnitsRow(state: RunState, max: number): CheckRow {
  const actual = Object.keys(state.units).length;
  return {
    name: "team_units",
    kind: "mechanical",
    verdict: actual <= max ? "pass" : "fail",
    expected: `<= ${max}`,
    actual: String(actual),
  };
}

function teamAgentsRow(state: RunState, max: number): CheckRow {
  const agents = new Set(
    Object.values(state.units)
      .map((u) => u.agent)
      .filter((a): a is string => Boolean(a)),
  );
  const actual = agents.size;
  return {
    name: "team_agents",
    kind: "mechanical",
    verdict: actual <= max ? "pass" : "fail",
    expected: `<= ${max}`,
    actual: String(actual),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
