/**
 * Recall module — types (CONCEPT.md §6.2 experience memory, §7 success
 * signals, §10 playbook provenance).
 */

import type { RetroContext, RetroRecord, UserVerdict } from "../retro/record.js";

export interface RetroLoadError {
  file: string;
  message: string;
}

export interface LoadRetroRecordsResult {
  records: RetroRecord[];
  errors: RetroLoadError[];
}

/** A prior run whose context matched the requested project type. */
export interface MatchingRun {
  run_id: string;
  outcome: RetroRecord["outcome"];
  context: RetroContext;
  user_verdict?: UserVerdict;
  budget_target: number | null;
  budget_spent: number;
  recorded_at: string;
}

/** Aggregated spent/estimated ratio for a unit id, across matching runs. */
export interface UnitEstimationCalibration {
  unit: string;
  samples: number;
  /** Mean of (spent / estimated) across samples where estimated > 0. */
  mean_ratio: number;
  /** (mean_ratio - 1) * 100, rounded — positive means chronic under-estimation. */
  deviation_pct: number;
}

export interface TeamSizeNorm {
  project_type: string;
  samples: number;
  mean_units: number;
  mean_agents: number;
}

export type ExperienceWarningReason = "abandoned" | "unsatisfied" | "high_rework" | "high_escalation";

export interface ExperienceWarning {
  run_id: string;
  reason: ExperienceWarningReason;
  context: RetroContext;
  detail: string;
}

/** 1-2 records is anecdote, not law (CONCEPT.md §6.2) — surfaced so callers can hedge. */
export type ExperienceConfidence = "none" | "low" | "moderate" | "high";

export interface ExperiencePrior {
  project_type?: string;
  matching_runs: MatchingRun[];
  estimation_calibration: UnitEstimationCalibration[];
  team_size_norms: TeamSizeNorm[];
  warnings: ExperienceWarning[];
  confidence: ExperienceConfidence;
  confidence_note: string;
}

export interface BuildExperiencePriorOptions {
  projectType?: string;
}
