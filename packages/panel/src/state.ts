/**
 * Panel data access — thin wrappers over @clockwork/core (CONCEPT.md §13,
 * Phase 2 panel rules). The panel never derives state on its own: everything
 * shown is `readLedger` + `reduceLedger` output or a projection built by core.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appendCommand,
  atomicWrite,
  withStorageLock,
  buildBudgetReport,
  peekCommands,
  readLedger,
  reduceLedger,
  renderChangelog,
} from "@clockwork/core";
import type { BudgetReport, Command, LedgerEvent, QueueStatus, RunState } from "@clockwork/core";

export const TS_DIR = ".teamsmith";
const LEDGER_FILE = "ledger.jsonl";
const CONTROL_FILE = "control.json";

export interface ControlState {
  paused: boolean;
  kill: boolean;
}

export async function loadLedger(
  projectDir: string,
): Promise<{ state: RunState; events: LedgerEvent[] }> {
  const { events } = await readLedger(join(projectDir, TS_DIR, LEDGER_FILE));
  return { state: reduceLedger(events), events };
}

export async function loadBudget(projectDir: string): Promise<BudgetReport> {
  const { state } = await loadLedger(projectDir);
  return buildBudgetReport(state);
}

export async function loadChangelog(projectDir: string): Promise<string> {
  const { events } = await loadLedger(projectDir);
  return renderChangelog(events);
}

/**
 * Writes the file-based command channel — the ONLY mutation this package
 * performs. Same shape the CLI's `pause`/`resume`/`kill` commands write.
 * Unspecified fields carry the current on-disk value forward.
 */
export async function writeControl(
  projectDir: string,
  patch: Partial<ControlState>,
): Promise<ControlState> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new Error("Control patch must be an object");
  }
  for (const field of ["paused", "kill"] as const) {
    if (field in patch && typeof patch[field] !== "boolean") {
      throw new Error(`Control patch ${field} must be a boolean`);
    }
  }
  const path = join(projectDir, TS_DIR, CONTROL_FILE);
  return withStorageLock(path, async () => {
    const current = await readControlFile(projectDir);
    const next: ControlState = { paused: patch.paused ?? current.paused, kill: patch.kill ?? current.kill };
    await atomicWrite(path, JSON.stringify(next));
    return next;
  });
}

/**
 * Queues one command for the orchestrator to pick up (CONCEPT.md §13, panel
 * rule #3: file-based command channel). The panel never interprets what the
 * command means — it only appends the request and lets @clockwork/core
 * validate the closed type dictionary.
 */
export async function submitCommand(
  projectDir: string,
  type: string,
  data: Record<string, unknown>,
): Promise<Command> {
  return appendCommand(projectDir, type, data);
}

/** Queued-but-not-yet-consumed commands, for the panel's status display. */
export async function loadCommandQueue(projectDir: string): Promise<QueueStatus> {
  return peekCommands(projectDir);
}

/** Only an absent file is an uninitialized control channel. Invalid data must
 * never turn a partial update into an implicit resume or kill reset. */
export async function readControlFile(projectDir: string): Promise<ControlState> {
  let raw: string;
  try {
    raw = await readFile(join(projectDir, TS_DIR, CONTROL_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { paused: false, kill: false };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid control file: malformed JSON");
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    !("paused" in parsed) || typeof parsed.paused !== "boolean" ||
    !("kill" in parsed) || typeof parsed.kill !== "boolean"
  ) {
    throw new Error("Invalid control file: paused and kill must be booleans");
  }
  return { paused: parsed.paused, kill: parsed.kill };
}
