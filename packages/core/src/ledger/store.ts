/**
 * Append-only JSONL ledger store. Events are immutable once written;
 * there is no update or delete. Only the orchestrator appends.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withStorageLock } from "../storage/lock.js";
import { validateEvent } from "./events.js";
import type { EventType, LedgerEvent } from "./events.js";
import { Redactor } from "./redact.js";
import { reduceLedger, validateEventTransition } from "./reduce.js";
import type { ValidationIssue } from "../spec/types.js";

export interface ReadLedgerResult {
  events: LedgerEvent[];
  /** Per-line problems: parse failures, envelope violations, seq gaps. */
  issues: ValidationIssue[];
}

/**
 * Reads and validates a ledger file. Invalid lines are reported and skipped —
 * a single corrupted line must not make the whole run unrecoverable.
 */
export async function readLedger(filePath: string): Promise<ReadLedgerResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { events: [], issues: [] };
    }
    throw err;
  }

  const events: LedgerEvent[] = [];
  const issues: ValidationIssue[] = [];
  if (raw.length && !raw.endsWith("\n")) {
    issues.push({
      level: "error",
      code: "ledger-truncated",
      message: "Ledger ends with an incomplete record",
    });
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  for (const [i, line] of lines.entries()) {
    let doc: unknown;
    try {
      doc = JSON.parse(line);
    } catch {
      issues.push({
        level: "error",
        code: "ledger-parse",
        message: `Line ${i + 1}: not valid JSON`,
        path: `line.${i + 1}`,
      });
      continue;
    }
    const { event, issues: eventIssues } = validateEvent(doc);
    if (!event) {
      issues.push(
        ...eventIssues.map((issue) => ({ ...issue, path: `line.${i + 1}` })),
      );
      continue;
    }
    events.push(event);
  }

  if (events.length && events[0]!.seq !== 1) {
    issues.push({ level: "error", code: "seq-gap", message: "Ledger must start at seq 1" });
  }
  // Monotonic seq check across surviving events.
  for (let i = 1; i < events.length; i++) {
    if (events[i]!.seq !== events[i - 1]!.seq + 1) {
      issues.push({
        level: "error",
        code: "seq-not-monotonic",
        message: `seq ${events[i]!.seq} follows ${events[i - 1]!.seq}`,
      });
    }
  }

  return { events, issues };
}

export interface AppendFields {
  actor?: LedgerEvent["actor"];
  unit_id?: string;
  agent_id?: string;
  data?: Record<string, unknown>;
}

export interface LedgerWriterOptions {
  /** Injectable clock for deterministic tests. */
  clock?: () => Date;
  redactor?: Redactor;
}

/**
 * Appender: assigns seq under the process lock, validates the current run,
 * and redacts data before it touches disk.
 */
export class LedgerWriter {
  private constructor(
    private readonly filePath: string,
    private readonly clock: () => Date,
    readonly redactor: Redactor,
  ) {}

  /** Opens (or creates) a ledger, resuming seq numbering from the last event. */
  static async open(filePath: string, options: LedgerWriterOptions = {}): Promise<LedgerWriter> {
    await mkdir(dirname(filePath), { recursive: true });
    await withStorageLock(filePath, async () => {
      const { issues } = await readLedger(filePath);
      if (issues.length) {
        throw new Error(`Refusing to append to a corrupted ledger: ${issues[0]!.message}`);
      }
    });
    return new LedgerWriter(
      filePath,
      options.clock ?? (() => new Date()),
      options.redactor ?? new Redactor(),
    );
  }

  async append(type: EventType, fields: AppendFields = {}): Promise<LedgerEvent> {
    return withStorageLock(this.filePath, async () => {
      const { events, issues: storedIssues } = await readLedger(this.filePath);
      if (storedIssues.length) {
        throw new Error(`Refusing to append to a corrupted ledger: ${storedIssues[0]!.message}`);
      }
      const event: LedgerEvent = {
        seq: events.length + 1,
        ts: this.clock().toISOString(),
        type,
        actor: fields.actor ?? "orchestrator",
        ...(fields.unit_id !== undefined ? { unit_id: fields.unit_id } : {}),
        ...(fields.agent_id !== undefined ? { agent_id: fields.agent_id } : {}),
        ...(fields.data !== undefined ? { data: this.redactor.redactValue(fields.data) } : {}),
      };
      const { issues } = validateEvent(event);
      if (issues.length) {
        throw new Error(`Refusing to append invalid event: ${issues[0]!.message}`);
      }
      const state = reduceLedger(events);
      if (state.anomalies.length) {
        throw new Error(`Refusing to append to a corrupted ledger: ${state.anomalies[0]}`);
      }
      const transitionIssues = validateEventTransition(state, event);
      if (transitionIssues.length) {
        throw new Error(`Refusing to append invalid transition: ${transitionIssues[0]!.message}`);
      }
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
      return event;
    });
  }
}
