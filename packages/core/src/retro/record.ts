/**
 * Retrospective record (CONCEPT.md §6.2, §7).
 *
 * Written at the end of every run from day one — the learning loop that
 * consumes these records is Phase 2, but data cannot be collected
 * retroactively. Learning without an evaluation signal learns noise, so
 * every record carries the success signals and the context in which they
 * were true. Records are schema'd flat files with stable ids; a semantic
 * index can be layered on later without touching this format.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { RunState, UnitStatus } from "../ledger/reduce.js";
import type { Bias } from "../spec/types.js";

export const RETRO_SCHEMA_VERSION = 1;

export interface RetroContext {
  bias?: Bias;
  /** Free tag supplied by the orchestrator, e.g. "web-saas", "cli-tool". */
  project_type?: string;
  /** Adapter name, e.g. "claude-code". */
  platform?: string;
}

export interface RetroUnitSignal {
  unit: string;
  status: UnitStatus;
  agent?: string;
  rework_attempts: number;
  escalation_step?: number;
  estimated: number;
  spent: number;
  sunk_budget?: number;
  blocked_by?: string[];
}

/** Layer-2 signal: the single-question user feedback at RETRO. */
export interface UserVerdict {
  satisfied: boolean;
  note?: string;
}

export interface RetroRecord {
  retro_schema_version: number;
  run_id: string;
  teamsmith_version: string | null;
  recorded_at: string;
  goal?: string;
  /** "In which context was this true" — staleness insurance. */
  context: RetroContext;
  spec_final_version: number | null;
  outcome: "done" | "abandoned" | null;
  budget: {
    target: number | null;
    total_spent: number;
  };
  /** Layer-1 process signals, attributable (see per-unit list below). */
  signals: {
    human_interventions: number;
    /** Execute-phase only — protocol events (CLARIFY, approval) excluded. */
    human_interventions_execute: number;
    rework_total: number;
    escalation_max_step: number;
    anomalies: number;
  };
  units: RetroUnitSignal[];
  user_verdict?: UserVerdict;
}

export interface BuildRetroOptions {
  goal?: string;
  context?: RetroContext;
  userVerdict?: UserVerdict;
  /** Injectable clock for deterministic tests. */
  clock?: () => Date;
}

export function buildRetroRecord(state: RunState, options: BuildRetroOptions = {}): RetroRecord {
  if (!state.runId) {
    throw new Error("Cannot build a retro record without a run id (missing run.started?)");
  }

  const units: RetroUnitSignal[] = Object.entries(state.units).map(([unit, u]) => ({
    unit,
    status: u.status,
    ...(u.agent !== undefined ? { agent: u.agent } : {}),
    rework_attempts: u.reworkAttempts,
    ...(u.escalationStep !== undefined ? { escalation_step: u.escalationStep } : {}),
    estimated: u.estimated,
    spent: u.spent,
    ...(u.sunkBudget !== undefined ? { sunk_budget: u.sunkBudget } : {}),
    ...(u.blockedBy !== undefined ? { blocked_by: u.blockedBy } : {}),
  }));

  return {
    retro_schema_version: RETRO_SCHEMA_VERSION,
    run_id: state.runId,
    teamsmith_version: state.teamsmithVersion,
    recorded_at: (options.clock ?? (() => new Date()))().toISOString(),
    ...(options.goal !== undefined ? { goal: options.goal } : {}),
    context: options.context ?? {},
    spec_final_version: state.specVersion,
    outcome: state.outcome,
    budget: {
      target: state.budgetTarget,
      total_spent: state.totalSpent,
    },
    signals: {
      human_interventions: state.userInterventions,
      human_interventions_execute: state.userInterventionsExecute,
      rework_total: units.reduce((sum, u) => sum + u.rework_attempts, 0),
      escalation_max_step: units.reduce((max, u) => Math.max(max, u.escalation_step ?? 0), 0),
      anomalies: state.anomalies.length,
    },
    units,
    ...(options.userVerdict !== undefined ? { user_verdict: options.userVerdict } : {}),
  };
}

export function retroFileName(runId: string): string {
  return `retro-${runId}.yaml`;
}

/**
 * Writes the record as `retro-<run_id>.yaml`. Records are immutable:
 * an existing file is never overwritten.
 */
export async function writeRetroRecord(dir: string, record: RetroRecord): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, retroFileName(record.run_id));
  try {
    await writeFile(filePath, YAML.stringify(record), { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Retro record for run "${record.run_id}" already exists — records are immutable`);
    }
    throw err;
  }
  return filePath;
}
