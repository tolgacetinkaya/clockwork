/**
 * The panel → orchestrator command dictionary (CONCEPT.md §13, panel rule #3:
 * file-based command channel). Commands are REQUESTS, not state — the ledger
 * stays the single source of truth. A command only becomes real once the
 * orchestrator consumes it and writes the corresponding ledger event(s).
 *
 * The dictionary is CLOSED, mirroring the ledger event dictionary: free-text
 * command types are forbidden so every consumer (panel, CLI, orchestrator)
 * agrees on the shape.
 */

import type { ValidationIssue } from "../spec/types.js";

export const COMMAND_TYPES = ["answer_questions", "resolve_checkpoint", "note"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

const COMMAND_TYPE_SET: ReadonlySet<string> = new Set(COMMAND_TYPES);

export function isCommandType(type: string): type is CommandType {
  return COMMAND_TYPE_SET.has(type);
}

/** data: the operator's free-form answer to the currently pending questions. */
export interface AnswerQuestionsData {
  text: string;
}

/** data: which open checkpoint to resolve, with an optional operator note. */
export interface ResolveCheckpointData {
  ref: string;
  note?: string;
}

/** data: a free-form operator note the orchestrator can surface/act on. */
export interface NoteData {
  text: string;
}

/**
 * Command envelope. Same discipline as LedgerEvent: seq is monotonic per
 * file, ts is stamped on append, type is closed-dictionary.
 */
export interface Command {
  seq: number;
  ts: string;
  type: CommandType;
  data: Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCommandData(
  type: CommandType,
  data: unknown,
): ValidationIssue[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [{ level: "error", code: "command-envelope", message: "data must be an object" }];
  }
  const d = data as Record<string, unknown>;
  switch (type) {
    case "answer_questions":
      return isNonEmptyString(d.text)
        ? []
        : [{ level: "error", code: "command-data", message: "answer_questions requires a non-empty data.text" }];
    case "resolve_checkpoint": {
      const issues: ValidationIssue[] = [];
      if (!isNonEmptyString(d.ref)) {
        issues.push({ level: "error", code: "command-data", message: "resolve_checkpoint requires a non-empty data.ref" });
      }
      if (d.note !== undefined && typeof d.note !== "string") {
        issues.push({ level: "error", code: "command-data", message: "resolve_checkpoint data.note must be a string" });
      }
      return issues;
    }
    case "note":
      return isNonEmptyString(d.text)
        ? []
        : [{ level: "error", code: "command-data", message: "note requires a non-empty data.text" }];
  }
}

/** Envelope validation for a single parsed JSONL line. */
export function validateCommand(doc: unknown): { command?: Command; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { issues: [{ level: "error", code: "command-envelope", message: "Command must be an object" }] };
  }
  const c = doc as Record<string, unknown>;

  if (typeof c.seq !== "number" || !Number.isInteger(c.seq) || c.seq < 1) {
    issues.push({ level: "error", code: "command-envelope", message: `Invalid seq: ${String(c.seq)}` });
  }
  if (typeof c.ts !== "string" || Number.isNaN(Date.parse(c.ts))) {
    issues.push({ level: "error", code: "command-envelope", message: `Invalid ts: ${String(c.ts)}` });
  }
  if (typeof c.type !== "string" || !isCommandType(c.type)) {
    // The closed-dictionary rule: unknown types are rejected, not tolerated.
    issues.push({
      level: "error",
      code: "unknown-command-type",
      message: `Unknown command type: "${String(c.type)}"`,
    });
  } else {
    issues.push(...validateCommandData(c.type, c.data));
  }

  return issues.length ? { issues } : { command: doc as Command, issues };
}
