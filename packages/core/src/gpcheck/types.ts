/**
 * Golden-path threshold checking (mechanizes the by-hand review currently
 * done after every golden-path run — see golden-paths/gp-{1,2,3}-*.md).
 *
 * Design split: MECHANICAL rows are derivable purely from the ledger/state
 * and are checked by code here. Rows that require human or agent judgment
 * (e.g. "acceptance criteria verifier-confirmed", "app round-trip works")
 * are carried verbatim as `manual` — this module never fakes a judgment it
 * has no evidence to make.
 */

export interface TeamThreshold {
  max_units?: number;
  max_agents?: number;
}

export interface MechanicalThresholds {
  required_outcome: "done" | "abandoned";
  max_interventions_execute: number;
  /** Upper bound on (totalSpent - budgetTarget) / budgetTarget, as a percent. */
  max_budget_deviation_pct: number;
  max_anomalies: number;
  max_ledger_errors: number;
  max_rework_total?: number;
  team?: TeamThreshold;
}

/** One golden path's machine-readable threshold table (schema-versioned JSON). */
export interface GpThresholds {
  schema_version: 1;
  /** e.g. "gp-1" — matches the scenario doc's slug. */
  golden_path: string;
  /** Filename of the scenario doc this table was derived from. */
  source: string;
  mechanical: MechanicalThresholds;
  /** Human-judgment rows, carried verbatim from the scenario doc's table. */
  manual: string[];
}
