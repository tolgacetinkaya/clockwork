/**
 * Pure state derivation (CONCEPT.md §9).
 *
 * The recomputability rule: current state is derivable ONLY from events —
 * no state is kept outside the event stream. This function is the rule made
 * testable: "read events → derive state → compare with the running system".
 *
 * Two-layer state, single source of truth: the orchestrator's "where are we"
 * view is derived from unit states, never stored separately. `blocked` is not
 * an event; it is the mechanical consequence of the dependency graph.
 */

import { PHASES, validateEvent } from "./events.js";
import type { LedgerEvent, Phase } from "./events.js";
import type { ValidationIssue } from "../spec/types.js";

export type UnitStatus =
  | "pending"
  | "running"
  | "verifying"
  | "rework"
  | "accepted"
  | "failed"
  | "cancelled"
  | "blocked";

export interface UnitState {
  status: UnitStatus;
  dependsOn: string[];
  /** Agent currently (or last) responsible for the unit. */
  agent?: string;
  reworkAttempts: number;
  /** Highest escalation-ladder step reached (1 rework, 2 re-staff, 3 re-decompose, 4 user). */
  escalationStep?: number;
  estimated: number;
  spent: number;
  /** For blocked units: the failed/cancelled dependencies that block them. */
  blockedBy?: string[];
  /** For cancelled units: tokens sunk up to cancellation. */
  sunkBudget?: number;
}

export interface OpenCheckpoint {
  ref: string;
  kind: "gate" | "milestone";
  blocking: boolean;
}

export interface RunState {
  ledgerSchemaVersion: number | null;
  runId: string | null;
  teamsmithVersion: string | null;
  phase: Phase | null;
  paused: boolean;
  outcome: "done" | "abandoned" | null;
  specVersion: number | null;
  specApproved: boolean;
  units: Record<string, UnitState>;
  totalSpent: number;
  /** Tokens; carried in spec.approved/amended event data — null if never set. */
  budgetTarget: number | null;
  budgetExhausted: boolean;
  /** Count of user-actor events — the "human interventions" success signal. */
  userInterventions: number;
  /**
   * User-actor events during the execute phase only. Protocol events (CLARIFY
   * answers, spec approval) happen pre-EXECUTE and land in the run-wide
   * counter; golden-path thresholds judge THIS one.
   */
  userInterventionsExecute: number;
  openCheckpoints: OpenCheckpoint[];
  pendingQuestions: string[];
  /** Diagnostics: structurally valid events that violate machine semantics. */
  anomalies: string[];
  lastSeq: number;
}

/** Unit-graph snapshot carried inside spec.approved / spec.amended event data. */
interface UnitSnapshot {
  id: string;
  depends_on?: string[];
}

const LEGAL_SOURCE: Record<string, UnitStatus[]> = {
  "unit.retry_requested": ["failed", "rework"],
  "unit.started": ["pending", "rework", "blocked"],
  "unit.verify_started": ["running"],
  "unit.rework": ["verifying"],
  "unit.accepted": ["verifying"],
  "unit.failed": ["running", "verifying", "rework"],
  "unit.cancelled": ["pending", "running", "verifying", "rework", "blocked"],
};

const TARGET: Record<string, UnitStatus> = {
  "unit.retry_requested": "pending",
  "unit.started": "running",
  "unit.verify_started": "verifying",
  "unit.rework": "rework",
  "unit.accepted": "accepted",
  "unit.failed": "failed",
  "unit.cancelled": "cancelled",
};

function emptyState(): RunState {
  return {
    ledgerSchemaVersion: null,
    runId: null,
    teamsmithVersion: null,
    phase: null,
    paused: false,
    outcome: null,
    specVersion: null,
    specApproved: false,
    units: {},
    totalSpent: 0,
    budgetTarget: null,
    budgetExhausted: false,
    userInterventions: 0,
    userInterventionsExecute: 0,
    openCheckpoints: [],
    pendingQuestions: [],
    anomalies: [],
    lastSeq: 0,
  };
}

export function reduceLedger(events: LedgerEvent[]): RunState {
  const state = emptyState();

  for (const event of events) {
    state.lastSeq = event.seq;
    const issues = validateEventTransition(state, event);
    if (issues.length) {
      state.anomalies.push(...issues.map((issue) => `seq ${event.seq}: ${issue.message}`));
      continue;
    }
    applyEvent(state, event);
    deriveBlocked(state);
  }

  deriveBlocked(state);
  return state;
}

function applyEvent(state: RunState, event: LedgerEvent): void {
  const data = event.data ?? {};
  if (event.actor === "user") {
    state.userInterventions += 1;
    if (state.phase === "execute") {
      state.userInterventionsExecute += 1;
    }
  }
  switch (event.type) {
    case "run.started": {
      if (state.runId !== null) {
        state.anomalies.push(`seq ${event.seq}: duplicate run.started`);
        break;
      }
      state.runId = typeof data.run_id === "string" ? data.run_id : null;
      state.teamsmithVersion =
        typeof data.teamsmith_version === "string" ? data.teamsmith_version : null;
      state.ledgerSchemaVersion =
        typeof data.ledger_schema_version === "number" ? data.ledger_schema_version : null;
      break;
    }
    case "run.phase_entered": {
      const phase = data.phase;
      if (typeof phase === "string" && (PHASES as readonly string[]).includes(phase)) {
        state.phase = phase as Phase;
      } else {
        state.anomalies.push(`seq ${event.seq}: unknown phase "${String(phase)}"`);
      }
      break;
    }
    case "run.paused":
      state.paused = true;
      break;
    case "run.resumed":
      state.paused = false;
      break;
    case "run.completed": {
      state.outcome = data.outcome === "abandoned" ? "abandoned" : "done";
      break;
    }

    case "spec.drafted": {
      state.specVersion = typeof data.version === "number" ? data.version : state.specVersion;
      state.specApproved = false;
      break;
    }
    case "spec.approved": {
      state.specVersion = typeof data.version === "number" ? data.version : state.specVersion;
      state.specApproved = true;
      if (typeof data.budget_target === "number") state.budgetTarget = data.budget_target;
      registerUnits(state, data.units, event.seq);
      break;
    }
    case "spec.amended": {
      state.specVersion = typeof data.to_version === "number" ? data.to_version : state.specVersion;
      if (typeof data.budget_target === "number") state.budgetTarget = data.budget_target;
      // Cancellations first: cancelled units are legitimately absent from the
      // new snapshot, and the snapshot check must see them as terminal.
      const cancelled = Array.isArray(data.cancelled) ? data.cancelled : [];
      for (const c of cancelled) {
        if (typeof c !== "object" || c === null) continue;
        const { unit, sunk_budget } = c as { unit?: string; sunk_budget?: number };
        const u = unit ? state.units[unit] : undefined;
        if (!u || !unit) continue;
        u.status = "cancelled";
        u.sunkBudget = typeof sunk_budget === "number" ? sunk_budget : u.spent;
      }
      registerUnits(state, data.units, event.seq);
      break;
    }

    case "unit.retry_requested":
    case "unit.started":
    case "unit.verify_started":
    case "unit.rework":
    case "unit.accepted":
    case "unit.failed":
    case "unit.cancelled": {
      const unit = requireUnit(state, event);
      if (!unit) break;
      const legal = LEGAL_SOURCE[event.type] ?? [];
      if (!legal.includes(unit.status)) {
        state.anomalies.push(
          `seq ${event.seq}: ${event.type} on "${event.unit_id}" in status "${unit.status}"`,
        );
      }
      unit.status = TARGET[event.type]!;
      if (event.type === "unit.started" && event.agent_id) {
        unit.agent = event.agent_id;
      }
      if (event.type === "unit.rework") {
        unit.reworkAttempts += 1;
      }
      if (event.type === "unit.cancelled") {
        unit.sunkBudget = unit.spent;
      }
      break;
    }

    case "agent.spawned":
    case "agent.completed":
      break; // presence in the ledger is the record; no state to carry (yet)
    case "agent.error": {
      if (event.unit_id && !state.units[event.unit_id]) {
        state.anomalies.push(`seq ${event.seq}: agent.error for unknown unit "${event.unit_id}"`);
      }
      break;
    }

    case "interaction.questions_batched": {
      const questions = Array.isArray(data.questions) ? data.questions : [];
      state.pendingQuestions.push(...questions.filter((q): q is string => typeof q === "string"));
      break;
    }
    case "interaction.answers_received":
      state.pendingQuestions = [];
      break;
    case "interaction.checkpoint_raised": {
      const ref = typeof data.ref === "string" ? data.ref : `seq-${event.seq}`;
      state.openCheckpoints.push({
        ref,
        kind: data.kind === "milestone" ? "milestone" : "gate",
        blocking: data.blocking !== false,
      });
      break;
    }
    case "interaction.checkpoint_resolved": {
      const ref = typeof data.ref === "string" ? data.ref : undefined;
      const before = state.openCheckpoints.length;
      state.openCheckpoints = state.openCheckpoints.filter((c) => c.ref !== ref);
      if (state.openCheckpoints.length === before) {
        state.anomalies.push(`seq ${event.seq}: resolving unknown checkpoint "${String(ref)}"`);
      }
      break;
    }

    case "budget.estimated": {
      const unit = requireUnit(state, event);
      if (unit && typeof data.tokens === "number") unit.estimated = data.tokens;
      break;
    }
    case "budget.spent": {
      const tokens = typeof data.tokens === "number" ? data.tokens : 0;
      state.totalSpent += tokens;
      if (event.unit_id) {
        const unit = requireUnit(state, event);
        if (unit) unit.spent += tokens;
      }
      break;
    }
    case "budget.exhausted":
      state.budgetExhausted = true;
      break;

    case "escalation.step": {
      const unit = requireUnit(state, event);
      if (unit && typeof data.step === "number") {
        unit.escalationStep = Math.max(unit.escalationStep ?? 0, data.step);
      }
      break;
    }
  }
}

function registerUnits(state: RunState, snapshot: unknown, seq: number): void {
  if (!Array.isArray(snapshot)) {
    state.anomalies.push(`seq ${seq}: spec event without a units snapshot`);
    return;
  }
  const seen = new Set<string>();
  for (const raw of snapshot) {
    if (typeof raw !== "object" || raw === null) continue;
    const u = raw as UnitSnapshot;
    if (typeof u.id !== "string") continue;
    seen.add(u.id);
    const existing = state.units[u.id];
    if (existing) {
      existing.dependsOn = [...(u.depends_on ?? [])];
    } else {
      state.units[u.id] = {
        status: "pending",
        dependsOn: [...(u.depends_on ?? [])],
        reworkAttempts: 0,
        estimated: 0,
        spent: 0,
      };
    }
  }
  // Units absent from the new snapshot that are not terminal were removed by
  // amendment without an explicit cancel entry — flag rather than guess.
  for (const [id, unit] of Object.entries(state.units)) {
    if (!seen.has(id) && !["accepted", "failed", "cancelled"].includes(unit.status)) {
      state.anomalies.push(`seq ${seq}: unit "${id}" missing from snapshot but not terminal`);
    }
  }
}

function requireUnit(state: RunState, event: LedgerEvent): UnitState | undefined {
  if (!event.unit_id) {
    state.anomalies.push(`seq ${event.seq}: ${event.type} without unit_id`);
    return undefined;
  }
  const unit = state.units[event.unit_id];
  if (!unit) {
    state.anomalies.push(`seq ${event.seq}: ${event.type} for unknown unit "${event.unit_id}"`);
    return undefined;
  }
  return unit;
}

/**
 * Derives `blocked`: a pending unit whose transitive dependencies contain a
 * failed or cancelled unit. Purely mechanical — the scheduler discovers
 * deadlock by reading state, never by noticing it "by chance".
 */
function deriveBlocked(state: RunState): void {
  for (const unit of Object.values(state.units)) {
    if (unit.status === "blocked") { unit.status = "pending"; delete unit.blockedBy; }
  }
  const memo = new Map<string, string[]>();

  const blockers = (id: string, trail: Set<string>): string[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (trail.has(id)) return []; // cycles are a spec-validation concern
    trail.add(id);

    const unit = state.units[id];
    if (!unit) return [];
    const found: string[] = [];
    for (const dep of unit.dependsOn) {
      const depUnit = state.units[dep];
      if (!depUnit) continue;
      if (depUnit.status === "failed" || depUnit.status === "cancelled") {
        found.push(dep);
      } else {
        found.push(...blockers(dep, trail));
      }
    }
    memo.set(id, found);
    return found;
  };

  for (const [id, unit] of Object.entries(state.units)) {
    if (unit.status !== "pending") continue;
    const found = [...new Set(blockers(id, new Set()))];
    if (found.length) {
      unit.status = "blocked";
      unit.blockedBy = found;
    }
  }
}

/** Pure admission check, shared by append and replay. Rejected events never mutate state. */
export function validateEventTransition(state: RunState, event: LedgerEvent): ValidationIssue[] {
  const issues = [...validateEvent(event).issues];
  if (issues.length) return issues;
  const fail = (message: string) => issues.push({ level: "error", code: "event-transition", message });
  const d = event.data ?? {};
  if (event.type === "run.started") {
    if (state.runId !== null) fail("duplicate run.started");
    return issues;
  }
  if (state.runId === null) { fail(`${event.type} before run.started`); return issues; }
  if (state.outcome !== null && !(event.type === "budget.spent" && event.unit_id === undefined)) { fail(`${event.type} after run.completed`); return issues; }
  if (event.type === "budget.spent" && (!Number.isFinite(state.totalSpent + Number(d.tokens)) ||
    (event.unit_id && !Number.isFinite((state.units[event.unit_id]?.spent ?? 0) + Number(d.tokens))))) fail("Accumulated spend must remain finite");
  if (event.type === "run.paused" && state.paused) fail("Run is already paused");
  if (event.type === "run.resumed" && !state.paused) fail("Run is not paused");
  if (event.type === "run.completed" && d.outcome === "done") {
    if (!state.specApproved) fail("Completion requires an approved spec");
    if (state.paused) fail("Completion requires an active run");
    if (Object.values(state.units).some((u) => u.status !== "accepted" && u.status !== "cancelled")) fail("Completion requires all units accepted or cancelled");
    if (state.openCheckpoints.some((c) => c.blocking)) fail("Completion has blocking checkpoints");
    if (state.pendingQuestions.length) fail("Completion has pending questions");
  }
  if (event.type === "spec.drafted" && state.specApproved) fail("Approved specs must use spec.amended");
  if (event.type === "spec.drafted" && state.specVersion !== null && Number(d.version) <= state.specVersion) fail("Draft version must advance");
  if (event.type === "spec.approved") {
    if (state.specApproved) fail("Spec already approved; use spec.amended");
    if (state.specVersion !== null && d.version !== state.specVersion) fail("Approval must match drafted version");
    if (state.pendingQuestions.length || state.openCheckpoints.some((c) => c.blocking)) fail("Approval has unresolved questions or blocking checkpoints");
  }
  if (event.type === "spec.amended") {
    if (!state.specApproved || d.from_version !== state.specVersion) fail("Amendment requires current approved version");
    const cancelled = (d.cancelled ?? []) as Array<{ unit: string }>;
    const ids = new Set((d.units as UnitSnapshot[]).map((u) => u.id));
    const cancels = new Set(cancelled.map((c) => c.unit));
    if (cancels.size !== cancelled.length) fail("Duplicate amendment cancellation");
    for (const id of cancels) {
      const unit = state.units[id];
      if (!unit || unit.status === "cancelled") fail(`Invalid cancellation of unit "${id}"`);
    }
    for (const [id, unit] of Object.entries(state.units)) {
      if (!ids.has(id) && !cancels.has(id) && !["accepted", "failed", "cancelled"].includes(unit.status)) fail(`unit "${id}" missing from snapshot but not terminal`);
    }
  }
  if (event.unit_id) {
    const unit = state.units[event.unit_id];
    if (!unit) fail(`${event.type} for unknown unit "${event.unit_id}"`);
    else {
      const legal = LEGAL_SOURCE[event.type];
      if (legal && !legal.includes(unit.status)) fail(`${event.type} on "${event.unit_id}" in status "${unit.status}"`);
      if (event.type === "unit.started") {
        if (!state.specApproved || state.paused) fail("Unit start requires an approved spec and active run");
        if (state.openCheckpoints.some((c) => c.blocking)) fail("Unit start has blocking checkpoints");
        if (unit.dependsOn.some((dep) => state.units[dep]?.status !== "accepted")) fail(`unit.started on "${event.unit_id}" before dependencies accepted`);
      }
    }
  }
  if (event.type === "interaction.checkpoint_raised" && state.openCheckpoints.some((c) => c.ref === d.ref)) fail(`Duplicate checkpoint "${String(d.ref)}"`);
  if (event.type === "interaction.checkpoint_resolved" && !state.openCheckpoints.some((c) => c.ref === d.ref)) fail(`resolving unknown checkpoint "${String(d.ref)}"`);
  return issues;
}
