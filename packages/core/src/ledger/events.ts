/**
 * The ledger event dictionary (CONCEPT.md §9).
 *
 * The dictionary is CLOSED and versioned: free-text event types are forbidden,
 * because both resume (state derivation) and every projection (panel, CHANGELOG,
 * reports) depend on these types. Adding a type is a schema change and bumps
 * LEDGER_SCHEMA_VERSION when the meaning of existing events shifts.
 */

import type { ValidationIssue } from "../spec/types.js";

export const LEDGER_SCHEMA_VERSION = 1;

export const PHASES = [
  "intake",
  "research",
  "clarify",
  "draft",
  "negotiate",
  "execute",
  "retro",
] as const;
export type Phase = (typeof PHASES)[number];

export const EVENT_TYPES = [
  // run family
  "run.started",
  "run.phase_entered",
  "run.paused",
  "run.resumed",
  "run.completed",
  // spec family
  "spec.drafted",
  "spec.approved",
  "spec.amended",
  // unit family — mini state machine: pending → running → verifying → rework → accepted | failed
  "unit.started",
  "unit.verify_started",
  "unit.rework",
  "unit.accepted",
  "unit.failed",
  "unit.cancelled",
  // agent family
  "agent.spawned",
  "agent.completed",
  "agent.error",
  // interaction family
  "interaction.questions_batched",
  "interaction.answers_received",
  "interaction.checkpoint_raised",
  "interaction.checkpoint_resolved",
  // budget family
  "budget.estimated",
  "budget.spent",
  "budget.exhausted",
  // escalation family
  "escalation.step",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);

/**
 * Event envelope. Only the orchestrator writes events; agents never touch
 * the ledger — `actor` records on whose behalf the transition happened.
 */
export interface LedgerEvent {
  seq: number;
  /** ISO-8601 timestamp. */
  ts: string;
  type: EventType;
  actor: "orchestrator" | "user" | "system";
  unit_id?: string;
  agent_id?: string;
  data?: Record<string, unknown>;
}

export function isEventType(type: string): type is EventType {
  return EVENT_TYPE_SET.has(type);
}

/** Envelope validation for a single parsed JSONL line. */
export function validateEvent(doc: unknown): { event?: LedgerEvent; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { issues: [{ level: "error", code: "event-envelope", message: "Event must be an object" }] };
  }
  const e = doc as Record<string, unknown>;

  if (typeof e.seq !== "number" || !Number.isSafeInteger(e.seq) || e.seq < 1) {
    issues.push({ level: "error", code: "event-envelope", message: `Invalid seq: ${String(e.seq)}` });
  }
  if (typeof e.ts !== "string" || Number.isNaN(Date.parse(e.ts))) {
    issues.push({ level: "error", code: "event-envelope", message: `Invalid ts: ${String(e.ts)}` });
  }
  if (typeof e.type !== "string" || !isEventType(e.type)) {
    // The closed-dictionary rule: unknown types are rejected, not tolerated.
    issues.push({
      level: "error",
      code: "unknown-event-type",
      message: `Unknown event type: "${String(e.type)}"`,
    });
  }
  if (e.actor !== "orchestrator" && e.actor !== "user" && e.actor !== "system") {
    issues.push({ level: "error", code: "event-envelope", message: `Invalid actor: ${String(e.actor)}` });
  }
  for (const key of ["unit_id", "agent_id"] as const) {
    if (e[key] !== undefined && !isSafeId(e[key])) {
      issues.push({ level: "error", code: "event-envelope", message: `Invalid ${key}` });
    }
  }
  if (e.data !== undefined && (typeof e.data !== "object" || e.data === null || Array.isArray(e.data))) {
    issues.push({ level: "error", code: "event-envelope", message: "data must be an object" });
  }

  if (issues.length === 0) validateData(e as unknown as LedgerEvent, issues);

  return issues.length ? { issues } : { event: doc as LedgerEvent, issues };
}

/** Keys used in plain-object state maps must never resolve inherited properties. */
export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== ".." &&
    !["__proto__", "prototype", "constructor"].includes(value) &&
    !Object.prototype.hasOwnProperty.call(Object.prototype, value);
}

function validateData(event: LedgerEvent, issues: ValidationIssue[]): void {
  const d = event.data ?? {};
  const fail = (message: string) => issues.push({ level: "error", code: "event-data", message });
  const positive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  const tokens = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const version = (v: unknown) => positive(v) && Number.isSafeInteger(v);
  if (event.type.startsWith("unit.") || ["budget.estimated", "escalation.step"].includes(event.type)) {
    if (!isSafeId(event.unit_id)) fail(`${event.type} requires unit_id`);
  }
  if (event.type.startsWith("agent.") && !isSafeId(event.agent_id)) fail(`${event.type} requires agent_id`);
  switch (event.type) {
    case "run.started":
      if (!isSafeId(d.run_id)) fail("run.started requires run_id");
      if (d.ledger_schema_version !== undefined && d.ledger_schema_version !== LEDGER_SCHEMA_VERSION) fail("Invalid ledger_schema_version");
      break;
    case "run.phase_entered":
      if (!(PHASES as readonly unknown[]).includes(d.phase)) fail(`unknown phase "${String(d.phase)}"`);
      break;
    case "run.completed":
      if (d.outcome !== "done" && d.outcome !== "abandoned") fail("Invalid run outcome");
      break;
    case "spec.drafted":
    case "spec.approved":
      if (!version(d.version)) fail("Spec requires a positive integer version");
      break;
    case "spec.amended":
      if (!version(d.from_version) || !version(d.to_version) || Number(d.to_version) <= Number(d.from_version)) fail("Invalid amendment versions");
      if (d.cancelled !== undefined && (!Array.isArray(d.cancelled) || d.cancelled.some((c: unknown) =>
        typeof c !== "object" || c === null || !isSafeId((c as Record<string, unknown>).unit) ||
        ((c as Record<string, unknown>).sunk_budget !== undefined && !tokens((c as Record<string, unknown>).sunk_budget))))) fail("Invalid cancelled units");
      break;
    case "budget.estimated":
    case "budget.spent":
      if (!tokens(d.tokens)) fail("tokens must be finite and nonnegative");
      break;
    case "escalation.step":
      if (!Number.isInteger(d.step) || Number(d.step) < 1 || Number(d.step) > 4) fail("Invalid escalation step");
      break;
    case "interaction.questions_batched":
      if (!Array.isArray(d.questions) || d.questions.some((q) => typeof q !== "string" || !q.trim())) fail("Invalid questions");
      break;
    case "interaction.checkpoint_raised":
      if (d.kind !== undefined && d.kind !== "gate" && d.kind !== "milestone" && d.kind !== "budget") fail("Invalid checkpoint kind");
      if (d.blocking !== undefined && typeof d.blocking !== "boolean") fail("Invalid checkpoint blocking flag");
      // Historical events omit kind/blocking; their established defaults remain valid.
      if (!isSafeId(d.ref)) fail("Checkpoint requires ref");
      break;
    case "interaction.checkpoint_resolved":
      if (!isSafeId(d.ref)) fail("Checkpoint requires ref");
      break;
  }
  if (d.budget_target !== undefined && !positive(d.budget_target)) fail("budget_target must be finite and positive");
  if (event.type === "spec.approved" || event.type === "spec.amended") {
    if (!Array.isArray(d.units) || d.units.length === 0) { fail("Spec requires a nonempty units snapshot"); return; }
    const ids = new Set<string>();
    for (const raw of d.units) {
      if (typeof raw !== "object" || raw === null || !isSafeId(raw.id)) { fail("Invalid snapshot unit id"); continue; }
      if (ids.has(raw.id)) fail(`Duplicate snapshot unit "${raw.id}"`);
      ids.add(raw.id);
      if (raw.depends_on !== undefined && (!Array.isArray(raw.depends_on) || raw.depends_on.some((id: unknown) => !isSafeId(id)))) fail("Invalid snapshot dependencies");
    }
    for (const raw of d.units) {
      if (!raw || !Array.isArray(raw.depends_on)) continue;
      if (raw.depends_on.some((id: string) => !ids.has(id) || id === raw.id)) fail("Unknown or self snapshot dependency");
    }
    const graph = new Map<string, string[]>(d.units.filter((u) => u && isSafeId(u.id)).map((u) => [u.id, Array.isArray(u.depends_on) ? u.depends_on : []]));
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return false;
      if (visited.has(id)) return true;
      visiting.add(id);
      for (const dep of graph.get(id) ?? []) if (!visit(dep)) return false;
      visiting.delete(id); visited.add(id); return true;
    };
    if ([...graph.keys()].some((id) => !visit(id))) fail("Cyclic snapshot dependencies");
  }
}
