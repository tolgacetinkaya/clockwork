/**
 * Append-only JSONL command queue: the file-based panel → orchestrator
 * channel (CONCEPT.md §13, panel rule #3). Mirrors the ledger store's
 * discipline (see ../ledger/store.ts) — commands are immutable once
 * written. Diagnostic reads report corrupt lines; delivery, acknowledgment,
 * and append refuse corrupted queues.
 *
 * Commands are REQUESTS: consuming a command does not change run state by
 * itself. Only the orchestrator, after acting on a consumed command, writes
 * the resulting ledger event(s).
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isCommandType, validateCommand } from "./types.js";
import type { Command, CommandType } from "./types.js";
import { Redactor } from "../ledger/redact.js";
import type { ValidationIssue } from "../spec/types.js";

import { assertStorageFile, atomicWrite, withStorageLock } from "../storage/lock.js";

const TS_DIR = ".teamsmith";
const COMMANDS_FILE = "commands.jsonl";
const CURSOR_FILE = "commands.cursor";

function commandsFilePath(projectDir: string): string {
  return join(projectDir, TS_DIR, COMMANDS_FILE);
}

function cursorFilePath(projectDir: string): string {
  return join(projectDir, TS_DIR, CURSOR_FILE);
}

export interface ReadCommandsResult {
  commands: Command[];
  /** Per-line problems: parse failures, envelope violations, seq gaps. */
  issues: ValidationIssue[];
}

/**
 * Reads and validates the command queue. Invalid lines are reported and
 * skipped — a single corrupted line must not make the whole queue unusable.
 */
export async function readCommands(projectDir: string): Promise<ReadCommandsResult> {
  let raw: string;
  try {
    raw = await readFile(commandsFilePath(projectDir), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { commands: [], issues: [] };
    }
    throw err;
  }

  const commands: Command[] = [];
  const issues: ValidationIssue[] = [];
  if (raw.length && !raw.endsWith("\n")) {
    issues.push({
      level: "error",
      code: "command-truncated",
      message: "Queue ends with an incomplete record",
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
        code: "command-parse",
        message: `Line ${i + 1}: not valid JSON`,
        path: `line.${i + 1}`,
      });
      continue;
    }
    const { command, issues: cmdIssues } = validateCommand(doc);
    if (!command) {
      issues.push(...cmdIssues.map((issue) => ({ ...issue, path: `line.${i + 1}` })));
      continue;
    }
    commands.push(command);
  }

  if (commands.length && commands[0]!.seq !== 1) {
    issues.push({ level: "error", code: "seq-gap", message: "Queue must start at seq 1" });
  }
  // Monotonic seq check across surviving commands.
  for (let i = 1; i < commands.length; i++) {
    if (commands[i]!.seq !== commands[i - 1]!.seq + 1) {
      issues.push({
        level: "error",
        code: "seq-not-monotonic",
        message: `seq ${commands[i]!.seq} follows ${commands[i - 1]!.seq}`,
      });
    }
  }

  return { commands, issues };
}

export interface AppendCommandOptions {
  /** Injectable clock for deterministic tests. */
  clock?: () => Date;
  /** Additional known secrets to reject alongside built-in credential formats. */
  redactor?: Redactor;
}

/** Appends one command, rejecting malformed data and detected secrets without altering command meaning. */
export async function appendCommand(
  projectDir: string,
  type: string,
  data: Record<string, unknown>,
  options: AppendCommandOptions = {},
): Promise<Command> {
  if (!isCommandType(type)) {
    throw new Error("Refusing to append unknown command type");
  }
  const filePath = commandsFilePath(projectDir);
  return withStorageLock(filePath, async () => {
    const { commands, issues } = await readCommands(projectDir);
    const fatal = issues[0];
    if (fatal) {
      throw new Error(`Refusing to append to a corrupted command queue: ${fatal.message}`);
    }
    const lastSeq = commands.length ? commands[commands.length - 1]!.seq : 0;
    const command: Command = {
      seq: lastSeq + 1,
      ts: (options.clock ?? (() => new Date()))().toISOString(),
      type,
      data,
    };
    // Inspect the exact JSON snapshot that will be persisted (including keys and
    // toJSON output). Reject rather than substitute meaningful answers or refs.
    let serialized: string;
    let snapshot: Command;
    try {
      serialized = JSON.stringify(command);
      snapshot = JSON.parse(serialized) as Command;
    } catch {
      throw new Error("Refusing to append non-serializable command");
    }
    const redactor = options.redactor ?? new Redactor();
    if (JSON.stringify(redactor.redactValue(snapshot)) !== serialized) {
      throw new Error("Refusing to append command containing detected secrets");
    }
    const { issues: cmdIssues } = validateCommand(snapshot);
    if (cmdIssues.length) {
      throw new Error(`Refusing to append invalid command: ${cmdIssues[0]!.message}`);
    }
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${serialized}\n`, "utf8");
    return snapshot;
  });
}

/** Reads the cursor file; a missing cursor means "consume from start"; corruption is fatal. */
export async function readCursor(projectDir: string): Promise<number> {
  try {
    await assertStorageFile(cursorFilePath(projectDir));
    const raw = (await readFile(cursorFilePath(projectDir), "utf8")).trim();
    if (!/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new Error("Corrupted command cursor");
    }
    return Number(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw err;
  }
}

async function writeCursor(projectDir: string, seq: number): Promise<void> {
  await mkdir(join(projectDir, TS_DIR), { recursive: true });
  await atomicWrite(cursorFilePath(projectDir), `${seq}\n`);
}

export interface QueueStatus {
  /** Commands with seq greater than the stored cursor, oldest first. */
  queued: Command[];
  consumedSeq: number;
}

/** Read-only view of the queue against the cursor — does not advance it. */
export async function peekCommands(projectDir: string): Promise<QueueStatus> {
  return withStorageLock(commandsFilePath(projectDir), async () => {
    const { commands, issues } = await readCommands(projectDir);
    if (issues.length) {
      throw new Error(`Corrupted command queue: ${issues[0]!.message}`);
    }
    const consumedSeq = await readCursor(projectDir);
    if (consumedSeq > commands.length) {
      throw new Error("Command cursor exceeds queue prefix");
    }
    return { queued: commands.filter((c) => c.seq > consumedSeq), consumedSeq };
  });
}

/** Pull pending commands without acknowledging them. A crash before acknowledgment replays them. */
export async function consumeCommands(projectDir: string): Promise<Command[]> {
  return (await peekCommands(projectDir)).queued;
}

/** Acknowledge a successfully handled contiguous prefix. Repeated/older acknowledgments are harmless. */
export async function acknowledgeCommands(projectDir: string, throughSeq: number): Promise<void> {
  if (!Number.isSafeInteger(throughSeq) || throughSeq < 0) {
    throw new Error("Invalid command acknowledgment sequence");
  }
  await withStorageLock(commandsFilePath(projectDir), async () => {
    const { commands, issues } = await readCommands(projectDir);
    if (issues.length) {
      throw new Error(`Corrupted command queue: ${issues[0]!.message}`);
    }
    const cursor = await readCursor(projectDir);
    if (cursor > commands.length || throughSeq > commands.length) {
      throw new Error("Command acknowledgment exceeds valid queue prefix");
    }
    if (throughSeq > cursor) await writeCursor(projectDir, throughSeq);
  });
}

export type { Command, CommandType };
