/**
 * Platform-independent team spec data model (CONCEPT.md §8).
 * This package must contain no platform knowledge (Claude Code etc.).
 */

export type UnitType = "code" | "infra" | "content" | "research" | "ops";
export type Bias = "thorough" | "fast" | "cheap";
export type ModelTier = "standard" | "cheap" | "strong";
export type MilestoneMode = "soft" | "hard";

/** Token count as a number, or a shorthand string like "40k" / "1.5m". */
export type BudgetValue = number | string;

export interface SpecMeta {
  goal: string;
  assumptions?: string[];
  open_questions?: string[];
}

export interface Priorities {
  budget_target?: BudgetValue;
  bias: Bias;
}

export interface WorkUnit {
  id: string;
  type: UnitType;
  description: string;
  /** File/scope ownership (glob patterns) — conflict prevention. */
  owns: string[];
  /** Interfaces promised to other units — integration insurance. */
  contracts?: string[];
  depends_on?: string[];
  /** Acceptance criteria the verifier will use. */
  acceptance: string[];
  budget_est?: BudgetValue;
}

export interface AgentDef {
  id: string;
  purpose: string;
  model_tier: ModelTier;
  capabilities?: {
    /** External skills pinned to source + commit hash: "owner/repo@skill#<hash>". */
    skills?: string[];
    tools?: string[];
  };
  permissions?: string[];
}

export interface GateCheckpoint {
  trigger: string;
  action: "pause_and_ask";
}

export interface Milestone {
  at: string;
  mode: MilestoneMode;
}

export interface Verification {
  per_unit?: Record<string, unknown>;
  global_gates?: string[];
}

export interface Spec {
  spec_version: number;
  meta: SpecMeta;
  priorities: Priorities;
  decision_gates?: string[];
  work_units: WorkUnit[];
  agents: AgentDef[];
  /** work unit id → agent id (n:1 allowed). */
  assignment: Record<string, string>;
  verification?: Verification;
  checkpoints?: {
    gates?: GateCheckpoint[];
    milestones?: Milestone[];
  };
  retrospective?: {
    record?: string[];
  };
}

export interface ValidationIssue {
  level: "error" | "warning";
  /** Machine-readable code, e.g. "schema", "dup-unit-id", "dep-cycle". */
  code: string;
  message: string;
  /** Location in the spec, e.g. "work_units.wu-api.depends_on". */
  path?: string;
}

export interface ValidationResult {
  /** Present only when there are no error-level issues. */
  spec?: Spec;
  issues: ValidationIssue[];
}

/* ---------- Amendment (CONCEPT.md §8) ---------- */

export type AmendmentAction = "add" | "cancel" | "modify" | "retarget";

export interface AmendmentChange {
  action: AmendmentAction;
  /** Target unit id for cancel/modify. For add, def.id is used. */
  unit?: string;
  /** add: full definition of the unit being added. */
  def?: WorkUnit;
  /** modify: partial fields applied over the existing unit (id is immutable). */
  patch?: Partial<Omit<WorkUnit, "id">>;
  /** add/modify: agent id the unit is (re)assigned to. */
  assign_to?: string;
  /** retarget: the new budget target (the mid-run "raise the target" path). */
  budget_target?: BudgetValue;
}

export interface Amendment {
  base_version: number;
  initiated_by: "user" | "system";
  reason: string;
  changes: AmendmentChange[];
}

export interface CancelledUnit {
  unit: string;
  /** Tokens spent on the unit up to cancellation — visible for an informed decision. */
  sunk_budget: number;
  /** explicit: requested in the amendment; cascade: depended on a cancelled unit. */
  reason: "explicit" | "cascade";
}

export interface AmendmentImpact {
  continue: string[];
  modified: string[];
  cancel: CancelledUnit[];
  new: string[];
  /** Present when the amendment changed the budget target. */
  retarget?: { budget_target: BudgetValue };
}

export interface AmendmentResult {
  /** The applied next spec (version +1). Undefined when structurally invalid. */
  next?: Spec;
  impact: AmendmentImpact;
  /** Validation results of the next spec + application errors. */
  issues: ValidationIssue[];
}
