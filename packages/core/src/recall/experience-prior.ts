/**
 * INTAKE-time summary built from prior retro records (CONCEPT.md §6.2, §9
 * INTAKE step "similar records from experience memory"). Every figure here
 * traces back to a recorded signal (§7) — nothing is inferred beyond
 * aggregation, because learning without an evaluation signal learns noise.
 */

import type { RetroRecord } from "../retro/record.js";
import type {
  BuildExperiencePriorOptions,
  ExperienceConfidence,
  ExperiencePrior,
  ExperienceWarning,
  MatchingRun,
  TeamSizeNorm,
  UnitEstimationCalibration,
} from "./types.js";

/** escalation_max_step >= this is the "re-decompose or worse" band (CONCEPT.md §9 four-step escalation). */
const HIGH_ESCALATION_STEP = 3;
/** rework_attempts on a single unit at or above this is a decomposition smell (CONCEPT.md §7). */
const HIGH_REWORK_ATTEMPTS = 2;

function matchesProjectType(record: RetroRecord, projectType: string | undefined): boolean {
  if (projectType === undefined) return true;
  return record.context.project_type === projectType;
}

function toMatchingRun(record: RetroRecord): MatchingRun {
  return {
    run_id: record.run_id,
    outcome: record.outcome,
    context: record.context,
    ...(record.user_verdict !== undefined ? { user_verdict: record.user_verdict } : {}),
    budget_target: record.budget.target,
    budget_spent: record.budget.total_spent,
    recorded_at: record.recorded_at,
  };
}

/**
 * Aggregated per-unit-id spent/estimated ratio. Unit ids are stable within a
 * golden path (the same `wu-*` names recur across runs of the same kind of
 * work), so grouping by literal unit id is how DRAFT finds "this unit shape
 * is chronically under-estimated" without needing a taxonomy the retro
 * record doesn't carry.
 */
function buildEstimationCalibration(records: RetroRecord[]): UnitEstimationCalibration[] {
  const ratiosByUnit = new Map<string, number[]>();
  for (const record of records) {
    for (const unit of record.units) {
      if (unit.estimated <= 0) continue;
      const ratios = ratiosByUnit.get(unit.unit) ?? [];
      ratios.push(unit.spent / unit.estimated);
      ratiosByUnit.set(unit.unit, ratios);
    }
  }

  const out: UnitEstimationCalibration[] = [];
  for (const [unit, ratios] of ratiosByUnit) {
    const meanRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
    out.push({
      unit,
      samples: ratios.length,
      mean_ratio: meanRatio,
      deviation_pct: Math.round((meanRatio - 1) * 100),
    });
  }
  return out.sort((a, b) => b.deviation_pct - a.deviation_pct);
}

function buildTeamSizeNorms(records: RetroRecord[]): TeamSizeNorm[] {
  const byType = new Map<string, { units: number[]; agents: number[] }>();
  for (const record of records) {
    const type = record.context.project_type;
    if (type === undefined) continue;
    const agentIds = new Set(record.units.map((u) => u.agent).filter((a): a is string => a !== undefined));
    const bucket = byType.get(type) ?? { units: [], agents: [] };
    bucket.units.push(record.units.length);
    bucket.agents.push(agentIds.size);
    byType.set(type, bucket);
  }

  const out: TeamSizeNorm[] = [];
  for (const [project_type, bucket] of byType) {
    out.push({
      project_type,
      samples: bucket.units.length,
      mean_units: bucket.units.reduce((s, v) => s + v, 0) / bucket.units.length,
      mean_agents: bucket.agents.reduce((s, v) => s + v, 0) / bucket.agents.length,
    });
  }
  return out.sort((a, b) => a.project_type.localeCompare(b.project_type));
}

function buildWarnings(records: RetroRecord[]): ExperienceWarning[] {
  const warnings: ExperienceWarning[] = [];
  for (const record of records) {
    if (record.outcome === "abandoned") {
      warnings.push({
        run_id: record.run_id,
        reason: "abandoned",
        context: record.context,
        detail: `run "${record.run_id}" was abandoned`,
      });
    }
    if (record.user_verdict?.satisfied === false) {
      warnings.push({
        run_id: record.run_id,
        reason: "unsatisfied",
        context: record.context,
        detail: record.user_verdict.note ?? `user verdict was unsatisfied on run "${record.run_id}"`,
      });
    }
    const reworkUnits = record.units.filter((u) => u.rework_attempts >= HIGH_REWORK_ATTEMPTS);
    if (reworkUnits.length > 0) {
      warnings.push({
        run_id: record.run_id,
        reason: "high_rework",
        context: record.context,
        detail: `${reworkUnits.map((u) => u.unit).join(", ")} needed ${HIGH_REWORK_ATTEMPTS}+ rework rounds`,
      });
    }
    if (record.signals.escalation_max_step >= HIGH_ESCALATION_STEP) {
      warnings.push({
        run_id: record.run_id,
        reason: "high_escalation",
        context: record.context,
        detail: `escalation reached step ${record.signals.escalation_max_step}`,
      });
    }
  }
  return warnings;
}

function buildConfidence(matchCount: number): { confidence: ExperienceConfidence; note: string } {
  if (matchCount === 0) {
    return { confidence: "none", note: "no prior runs match this context — this is a cold start, not a warning." };
  }
  if (matchCount <= 2) {
    return {
      confidence: "low",
      note: `only ${matchCount} matching run(s) — anecdote, not law; treat the figures below as a hint, not a rule.`,
    };
  }
  if (matchCount <= 5) {
    return {
      confidence: "moderate",
      note: `${matchCount} matching runs — a light trend, still worth a sanity check.`,
    };
  }
  return { confidence: "high", note: `${matchCount} matching runs — a stable enough sample to lean on.` };
}

export function buildExperiencePrior(
  records: RetroRecord[],
  options: BuildExperiencePriorOptions = {},
): ExperiencePrior {
  const { projectType } = options;
  const matching = records.filter((r) => matchesProjectType(r, projectType));
  const { confidence, note } = buildConfidence(matching.length);

  return {
    ...(projectType !== undefined ? { project_type: projectType } : {}),
    matching_runs: matching.map(toMatchingRun),
    estimation_calibration: buildEstimationCalibration(matching),
    team_size_norms: buildTeamSizeNorms(matching),
    warnings: buildWarnings(matching),
    confidence,
    confidence_note: note,
  };
}
