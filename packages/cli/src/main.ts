/**
 * clockwork CLI â€” the orchestrator's hands.
 *
 * The PreToolUse guard denies write-tool access to `.teamsmith/**` for
 * everyone (ledger integrity); the orchestrator maintains ledger, specs,
 * guard, and control files exclusively through this CLI. Commands are thin
 * wrappers over @clockwork/core â€” no business logic lives here.
 */

import { exec } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import YAML from "yaml";
import {
  buildAgentDefinition,
  buildUnitPrompt,
  buildVerifierPrompt,
  EVENT_TYPES,
  acknowledgeCommands,
  LedgerWriter,
  applyAmendment,
  CheckRunError,
  ThresholdsError,
  buildAuditReport,
  buildExperiencePrior,
  checkRun,
  collectScannableFiles,
  consumeCommands,
  findInLibrary,
  isEventType,
  listLibrary,
  loadRetroRecords,
  loadThresholds,
  parseNpmAuditJson,
  renderCheck,
  peekCommands,
  renderAuditReport,
  saveToLibrary,
  scanSecrets,
  vetSkill,
  buildBudgetReport,
  buildRetroRecord,
  latestSpecVersion,
  loadLatestSpec,
  parseBudget,
  readLedger,
  reduceLedger,
  renderBudgetReport,
  renderChangelog,
  specFileName,
  validateAmendment,
  validateSpec,
  validateEventTransition,
  writeRetroRecord,
  writeSpecFile,
} from "@clockwork/core";
import type { EventType, LedgerEvent, RunState, Spec } from "@clockwork/core";
import {
  validConfig,
} from "@clockwork/adapter-claude";
import { startPanel } from "@clockwork/panel";
import { CodexAdapter } from "@clockwork/adapter-codex";
import { runUnit } from "@clockwork/runner";

const TS_DIR = ".teamsmith";
const LEDGER = "ledger.jsonl";

export interface CliResult {
  code: number;
  out: string;
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        flags[arg.slice(2)] = argv[++i]!;
      } else {
        flags[arg.slice(2)] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const ok = (out: string): CliResult => ({ code: 0, out });
const fail = (out: string): CliResult => ({ code: 1, out });

async function parseYamlFile(filePath: string): Promise<unknown> {
  try {
    return YAML.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (err) {
    throw new Error(
      `cannot parse "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function deriveState(cwd: string): Promise<{ state: RunState; events: LedgerEvent[] }> {
  const { events, issues } = await readLedger(join(cwd, TS_DIR, LEDGER));
  const fatal = issues.filter((i) => i.level === "error");
  if (fatal.length) {
    // Diagnosable, not fatal to reads: reducer works on surviving events.
    process.stderr.write(`ledger issues: ${fatal.map((i) => i.message).join("; ")}\n`);
  }
  return { state: reduceLedger(events), events };
}

async function latestSpec(cwd: string): Promise<Spec> {
  const loaded = await loadLatestSpec(join(cwd, TS_DIR));
  if (!loaded) throw new Error("no spec found â€” run `clockwork spec save` first");
  if (!loaded.spec) {
    throw new Error(
      `latest spec is invalid: ${loaded.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return loaded.spec;
}

/* ---------------- commands ---------------- */

async function cmdInit(cwd: string): Promise<CliResult> {
  await mkdir(join(cwd, TS_DIR), { recursive: true });
  try {
    await writeFile(
      join(cwd, TS_DIR, "control.json"),
      JSON.stringify({ paused: false, kill: false }),
      { encoding: "utf8", flag: "wx" },
    );
  } catch (err) {
    // Re-initialization must never clear an operator's pause/kill decision.
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  return ok(`initialized ${TS_DIR}/`);
}

async function cmdEvent(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const type = args.positional[0];
  if (!type || !isEventType(type)) {
    return fail(
      `${type ? `unknown event type: "${type}" â€” the dictionary is closed.` : "usage: clockwork event <type> [--actor a --unit u --agent g --data '{...}']"}\nvalid types:\n${EVENT_TYPES.map((t) => `  ${t}`).join("\n")}`,
    );
  }

  let data: Record<string, unknown> | undefined;
  if (args.flags.data !== undefined) {
    try {
      data = JSON.parse(args.flags.data) as Record<string, unknown>;
    } catch {
      return fail("--data is not valid JSON");
    }
  }
  const actor = args.flags.actor;
  if (actor !== undefined && !["orchestrator", "user", "system"].includes(actor)) {
    return fail(`invalid actor: ${actor}`);
  }

  const writer = await LedgerWriter.open(join(cwd, TS_DIR, LEDGER));
  const event = await writer.append(type as EventType, {
    ...(actor !== undefined ? { actor: actor as LedgerEvent["actor"] } : {}),
    ...(args.flags.unit !== undefined ? { unit_id: args.flags.unit } : {}),
    ...(args.flags.agent !== undefined ? { agent_id: args.flags.agent } : {}),
    ...(data !== undefined ? { data } : {}),
  });
  return ok(JSON.stringify(event));
}

async function cmdState(cwd: string): Promise<CliResult> {
  const { state } = await deriveState(cwd);
  return ok(JSON.stringify(state, null, 2));
}

async function cmdStatus(cwd: string): Promise<CliResult> {
  const { state } = await deriveState(cwd);
  const lines: string[] = [];
  lines.push(`run: ${state.runId ?? "(none)"}  phase: ${state.phase ?? "-"}  spec: v${state.specVersion ?? "-"}`);
  if (state.paused) lines.push("** PAUSED **");
  if (state.outcome) lines.push(`outcome: ${state.outcome}`);

  const units = Object.entries(state.units);
  if (units.length) {
    lines.push("", "| unit | status | agent | rework | spent |", "|---|---|---|---:|---:|");
    for (const [id, u] of units) {
      lines.push(`| ${id} | ${u.status} | ${u.agent ?? "-"} | ${u.reworkAttempts} | ${u.spent} |`);
    }
  }
  if (state.openCheckpoints.length) {
    lines.push("", `open checkpoints: ${state.openCheckpoints.map((c) => c.ref).join(", ")}`);
  }
  if (state.pendingQuestions.length) {
    lines.push(`pending questions: ${state.pendingQuestions.length}`);
  }
  if (state.anomalies.length) {
    lines.push("", `anomalies (${state.anomalies.length}):`, ...state.anomalies.map((a) => `  - ${a}`));
  }
  lines.push("", renderBudgetReport(buildBudgetReport(state)));
  return ok(lines.join("\n"));
}

async function cmdChangelog(cwd: string): Promise<CliResult> {
  const { events } = await deriveState(cwd);
  if (events.length === 0) {
    return fail(`no ledger events found under ${join(cwd, TS_DIR, LEDGER)} â€” wrong directory?`);
  }
  return ok(renderChangelog(events));
}

async function cmdSpecSave(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const draftPath = args.positional[0];
  if (!draftPath) return fail("usage: clockwork spec save <draft.yaml>");

  const doc = await parseYamlFile(draftPath);
  const { spec, issues } = validateSpec(doc);
  const warnings = issues.filter((i) => i.level === "warning");
  if (!spec) {
    return fail(`invalid spec:\n${issues.map((i) => `  [${i.code}] ${i.message}`).join("\n")}`);
  }

  const dir = join(cwd, TS_DIR);
  const latest = await latestSpecVersion(dir);
  const expected = (latest ?? 0) + 1;
  if (spec.spec_version !== expected) {
    return fail(`spec_version must be ${expected} (latest is ${latest ?? "none"})`);
  }
  const filePath = await writeSpecFile(dir, spec);
  const warningText = warnings.length
    ? `\nwarnings:\n${warnings.map((i) => `  [${i.code}] ${i.message}`).join("\n")}`
    : "";
  return ok(`saved ${filePath}${warningText}`);
}

async function cmdSpecLatest(cwd: string): Promise<CliResult> {
  const dir = join(cwd, TS_DIR);
  const version = await latestSpecVersion(dir);
  if (version === null) return fail("no spec found");
  return ok(join(dir, specFileName(version)));
}

async function cmdAmend(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const amendmentPath = args.positional[0];
  if (!amendmentPath) return fail("usage: clockwork amend <amendment.yaml>");

  const doc = await parseYamlFile(amendmentPath);
  const { amendment, issues } = validateAmendment(doc);
  if (!amendment) {
    return fail(`invalid amendment:\n${issues.map((i) => `  [${i.code}] ${i.message}`).join("\n")}`);
  }

  const spec = await latestSpec(cwd);
  const { state } = await deriveState(cwd);
  const spentByUnit = Object.fromEntries(
    Object.entries(state.units).map(([id, u]) => [id, u.spent]),
  );

  const result = applyAmendment(spec, amendment, spentByUnit);
  if (!result.next) {
    return fail(
      `amendment rejected:\n${result.issues.map((i) => `  [${i.code}] ${i.message}`).join("\n")}`,
    );
  }

  const writer = await LedgerWriter.open(join(cwd, TS_DIR, LEDGER));
  const amendmentFields = {
    actor: amendment.initiated_by === "user" ? "user" : "system",
    data: {
      from_version: amendment.base_version,
      to_version: result.next.spec_version,
      initiated_by: amendment.initiated_by,
      reason: amendment.reason,
      units: result.next.work_units.map((u) => ({
        id: u.id,
        ...(u.depends_on !== undefined ? { depends_on: u.depends_on } : {}),
      })),
      cancelled: result.impact.cancel,
      ...(result.impact.retarget !== undefined
        ? { budget_target: parseBudget(result.impact.retarget.budget_target) }
        : {}),
    },
  } as const;
  const admission = validateEventTransition(state, {
    seq: state.lastSeq + 1,
    ts: new Date().toISOString(),
    type: "spec.amended",
    ...amendmentFields,
  });
  if (state.anomalies.length || admission.length) {
    return fail(`amendment rejected: ${state.anomalies[0] ?? admission[0]!.message}`);
  }
  await writeSpecFile(join(cwd, TS_DIR), result.next);
  await writer.append("spec.amended", amendmentFields);

  return ok(JSON.stringify({ next_version: result.next.spec_version, impact: result.impact }, null, 2));
}

async function cmdGuardSet(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const configPath = args.positional[0];
  if (!configPath) return fail("usage: clockwork guard set <guard.json>");
  const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (!validConfig(parsed)) {
    return fail("invalid guard config: require version 1, absolute roots, owns, worktrees, allow_main_tree, and valid scopes/budget/patterns");
  }
  await mkdir(join(cwd, TS_DIR), { recursive: true });
  await writeFile(join(cwd, TS_DIR, "guard.json"), JSON.stringify(parsed, null, 2), "utf8");
  return ok("guard config written");
}

async function setControl(cwd: string, control: { paused: boolean; kill: boolean }): Promise<CliResult> {
  await mkdir(join(cwd, TS_DIR), { recursive: true });
  await writeFile(join(cwd, TS_DIR, "control.json"), JSON.stringify(control), "utf8");
  return ok(JSON.stringify(control));
}

async function cmdRetro(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const { state } = await deriveState(cwd);

  let goal: string | undefined;
  let bias: Spec["priorities"]["bias"] | undefined;
  try {
    const spec = await latestSpec(cwd);
    goal = spec.meta.goal;
    bias = spec.priorities.bias;
  } catch {
    // A retro without a spec is unusual but not impossible (abandoned early).
  }

  const record = buildRetroRecord(state, {
    ...(goal !== undefined ? { goal } : {}),
    context: {
      ...(bias !== undefined ? { bias } : {}),
      ...(args.flags["project-type"] !== undefined ? { project_type: args.flags["project-type"] } : {}),
      platform: args.flags.platform ?? "claude-code",
    },
    ...(args.flags.satisfied !== undefined
      ? {
          userVerdict: {
            satisfied: args.flags.satisfied === "true",
            ...(args.flags.note !== undefined ? { note: args.flags.note } : {}),
          },
        }
      : {}),
  });

  const filePath = await writeRetroRecord(join(cwd, TS_DIR, "retro"), record);

  // Mirror to the user-scope store so experience accumulates ACROSS projects â€”
  // recall in a fresh workspace would otherwise start cold every time.
  try {
    await writeRetroRecord(join(homedir(), ".teamsmith", "retro"), record);
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("immutable"))) throw err;
  }
  return ok(filePath);
}

async function cmdPrompt(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const [kind, id] = args.positional;
  if (!kind || !id) return fail("usage: clockwork prompt <unit|verify|agentdef> <id>");
  if (args.flags.adapter !== undefined && !["claude", "codex"].includes(args.flags.adapter)) return fail("unknown adapter (expected claude or codex)");
  const spec = await latestSpec(cwd);
  switch (kind) {
    case "unit":
      return ok(buildUnitPrompt(spec, id, args.flags.adapter === "codex" ? "workspace" : "hook"));
    case "verify":
      return ok(buildVerifierPrompt(spec, id));
    case "agentdef":
      return ok(buildAgentDefinition(spec, id, args.flags.adapter === "codex" ? "workspace" : "hook"));
    default:
      return fail(`unknown prompt kind: ${kind}`);
  }
}

async function cmdRecall(cwd: string, args: ParsedArgs): Promise<CliResult> {
  // Merge the project's own records with the user-scope store (cross-project
  // experience); an explicit --dir reads only that directory.
  const dirs = args.flags.dir
    ? [args.flags.dir]
    : [join(cwd, TS_DIR, "retro"), join(homedir(), ".teamsmith", "retro")];

  const records: Awaited<ReturnType<typeof loadRetroRecords>>["records"] = [];
  const errors: Awaited<ReturnType<typeof loadRetroRecords>>["errors"] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const result = await loadRetroRecords(dir);
    for (const record of result.records) {
      if (seen.has(record.run_id)) continue; // project copy wins over the mirror
      seen.add(record.run_id);
      records.push(record);
    }
    errors.push(...result.errors);
  }

  const prior = buildExperiencePrior(
    records,
    args.flags["project-type"] !== undefined ? { projectType: args.flags["project-type"] } : {},
  );

  const lines: string[] = [];
  lines.push(`experience prior (${prior.confidence}): ${prior.confidence_note}`);
  if (prior.matching_runs.length) {
    lines.push("", "| run | outcome | verdict | spent/target |", "|---|---|---|---|");
    for (const r of prior.matching_runs) {
      lines.push(
        `| ${r.run_id} | ${r.outcome ?? "-"} | ${r.user_verdict ? (r.user_verdict.satisfied ? "satisfied" : "UNSATISFIED") : "-"} | ${r.budget_spent}/${r.budget_target ?? "-"} |`,
      );
    }
  }
  if (prior.estimation_calibration.length) {
    lines.push("", "| unit | samples | mean estâ†’actual | deviation |", "|---|---:|---:|---:|");
    for (const c of prior.estimation_calibration) {
      lines.push(`| ${c.unit} | ${c.samples} | x${c.mean_ratio.toFixed(2)} | ${c.deviation_pct > 0 ? "+" : ""}${c.deviation_pct}% |`);
    }
  }
  for (const w of prior.warnings) {
    lines.push(`WARNING [${w.reason}] ${w.run_id}: ${w.detail}`);
  }
  for (const e of errors) {
    lines.push(`(unreadable record: ${e.file} â€” ${e.message})`);
  }
  return ok(lines.join("\n"));
}

async function cmdUi(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const port = args.flags.port !== undefined ? Number(args.flags.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    return fail(`invalid port: ${args.flags.port}`);
  }
  const handle = await startPanel({ projectDir: cwd, ...(port !== undefined ? { port } : {}) });
  // The server keeps the event loop alive; Ctrl+C shuts it down cleanly.
  process.on("SIGINT", () => {
    void handle.close().then(() => process.exit(0));
  });
  return ok(`panel running at ${handle.url} â€” Ctrl+C to stop`);
}

/** Repo root, resolved from this module's location (dev layout). */
function clockworkRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

async function cmdGp(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const [sub, evidenceDir] = args.positional;
  if (sub !== "verify" || !evidenceDir) {
    return fail("usage: clockwork gp verify <evidence-dir> (--thresholds <file> | --golden-path gp-1|gp-2|gp-3)");
  }
  const thresholdsPath =
    args.flags.thresholds ??
    (args.flags["golden-path"] !== undefined
      ? join(clockworkRoot(), "golden-paths", "thresholds", `${args.flags["golden-path"]}.json`)
      : undefined);
  if (!thresholdsPath) {
    return fail("provide --thresholds <file> or --golden-path gp-1|gp-2|gp-3");
  }

  try {
    const thresholds = await loadThresholds(thresholdsPath);
    const result = await checkRun({ evidenceDir: join(cwd, evidenceDir), thresholds });
    const rendered = renderCheck(result);
    // needs-manual exits 0: nothing mechanical failed; the reviewer gates on
    // the manual rows themselves.
    return result.verdict === "fail" ? fail(rendered) : ok(rendered);
  } catch (err) {
    if (err instanceof ThresholdsError) {
      return fail(`invalid thresholds file:\n${err.issues.map((i) => `  - ${i}`).join("\n")}`);
    }
    if (err instanceof CheckRunError) {
      return fail(`cannot check run: ${err.message}`);
    }
    throw err;
  }
}

async function cmdAudit(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const dir = args.flags.dir ?? cwd;
  const files = await collectScannableFiles(dir);
  const secrets = scanSecrets(files);

  // npm audit exits nonzero when vulnerabilities exist â€” that is a result,
  // not a command failure. Only a spawn failure / empty output is an error.
  let dependencies;
  let depWarning: string | undefined;
  let raw = "";
  try {
    const { stdout } = await execAsync("npm audit --json", { cwd: dir, maxBuffer: 16 * 1024 * 1024 });
    raw = stdout;
  } catch (err) {
    raw = (err as { stdout?: string }).stdout ?? "";
  }
  if (raw.trim()) {
    const parsed = parseNpmAuditJson(raw);
    if (parsed.ok) {
      dependencies = parsed.summary;
    } else {
      depWarning = `dependency audit skipped: ${parsed.error}`;
    }
  } else {
    depWarning = "dependency audit skipped: npm audit produced no output (no package.json or npm missing?)";
  }

  const report = buildAuditReport({ secrets, ...(dependencies !== undefined ? { dependencies } : {}) });
  const body = args.flags.json === "true" ? JSON.stringify(report, null, 2) : renderAuditReport(report);
  const out = depWarning ? `${body}\n(${depWarning})` : body;
  // Composes in scripts: reject (leaked secret) exits nonzero; ok/caution exit 0.
  return report.decision === "reject" ? fail(out) : ok(out);
}

async function cmdCommands(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const sub = args.positional[0];
  switch (sub) {
    case "pull": {
      const commands = await consumeCommands(cwd);
      if (!commands.length) return ok("(nothing new)");
      return ok(commands.map((c) => JSON.stringify(c)).join("\n"));
    }
    case "peek": {
      const status = await peekCommands(cwd);
      return ok(
        `consumed through seq ${status.consumedSeq}; queued: ${status.queued.length}\n${status.queued
          .map((c) => JSON.stringify(c))
          .join("\n")}`.trimEnd(),
      );
    }
    case "ack": {
      const raw = args.positional[1];
      if (raw === undefined || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        return fail("usage: clockwork commands ack <positive-seq> (only after applying the command)");
      }
      await acknowledgeCommands(cwd, Number(raw));
      return ok(`acknowledged through seq ${raw}`);
    }
    default:
      return fail("usage: clockwork commands <pull|peek|ack <seq>>");
  }
}

const VET_EXTENSIONS = new Set([".md", ".sh", ".ps1", ".js", ".mjs", ".cjs", ".py", ".txt", ".json", ".yaml", ".yml"]);
const VET_MAX_FILE_BYTES = 512 * 1024;

async function collectSkillFiles(root: string, dir: string, out: { path: string; content: string }[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await collectSkillFiles(root, full, out);
    } else if (VET_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      const content = await readFile(full, "utf8");
      if (Buffer.byteLength(content) <= VET_MAX_FILE_BYTES) {
        out.push({ path: relative(root, full).replaceAll("\\", "/"), content });
      }
    }
  }
}

async function cmdVet(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const target = args.positional[0];
  if (!target) return fail("usage: clockwork vet <skill-dir>");
  const root = join(cwd, target);
  const files: { path: string; content: string }[] = [];
  await collectSkillFiles(root, root, files);
  if (!files.length) return fail(`no vettable files found under ${root}`);

  const verdict = vetSkill({ name: args.flags.name ?? target, files });
  const lines = [
    `decision: ${verdict.decision.toUpperCase()}`,
    verdict.summary,
    "",
    `permissions: ${verdict.permissions.length ? verdict.permissions.join(", ") : "(none extracted)"}`,
  ];
  for (const f of verdict.findings) {
    lines.push(`- [${f.rule}] ${f.path}: ${f.evidence}`);
  }
  // The card informs; the USER decides. A reject exits non-zero so scripts notice.
  return verdict.decision === "reject" ? fail(lines.join("\n")) : ok(lines.join("\n"));
}

function libraryDir(args: ParsedArgs): string {
  return args.flags.dir ?? join(homedir(), ".teamsmith", "library");
}

async function cmdLibrary(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const [sub, ...rest] = args.positional;
  const dir = libraryDir(args);
  switch (sub) {
    case "list": {
      const entries = await listLibrary(dir);
      if (!entries.length) return ok(`(library empty: ${dir})`);
      return ok(entries.map((e) => `${e.name} [${e.provenance ?? "?"}] â€” ${e.description ?? ""}`).join("\n"));
    }
    case "find": {
      const entries = await findInLibrary(dir, {
        ...(args.flags.query !== undefined ? { query: args.flags.query } : {}),
        ...(args.flags.tags !== undefined ? { tags: args.flags.tags.split(",") } : {}),
      });
      if (!entries.length) return fail("(no matching library entries)");
      return ok(entries.map((e) => `${e.name} [${e.provenance ?? "?"}] â€” ${e.description ?? ""}\n  ${e.filePath}`).join("\n"));
    }
    case "save": {
      const file = rest[0];
      const name = args.flags.name;
      if (!file || !name) return fail("usage: clockwork library save <file> --name <n> [--tags a,b --overwrite]");
      const filePath = await saveToLibrary(
        dir,
        {
          name,
          content: await readFile(join(cwd, file), "utf8"),
          ...(args.flags.tags !== undefined ? { tags: args.flags.tags.split(",") } : {}),
        },
        args.flags.overwrite === "true" ? { overwrite: true } : {},
      );
      return ok(filePath);
    }
    default:
      return fail("usage: clockwork library <list|find|save> [flags]");
  }
}

async function cmdDoctor(cwd: string): Promise<CliResult> {
  const lines: string[] = [];
  let healthy = true;

  const major = Number(process.versions.node.split(".")[0]);
  lines.push(`node ${process.versions.node} ${major >= 20 ? "OK" : "TOO OLD (need >= 20)"}`);
  if (major < 20) healthy = false;

  const { events, issues } = await readLedger(join(cwd, TS_DIR, LEDGER));
  const errors = issues.filter((i) => i.level === "error");
  lines.push(`ledger: ${events.length} events, ${errors.length} error(s)`);
  if (errors.length) {
    healthy = false;
    lines.push(...errors.map((i) => `  - [${i.code}] ${i.message}`));
  }

  const state = reduceLedger(events);
  if (state.runId && !state.outcome) {
    lines.push(`unfinished run detected: ${state.runId} (phase: ${state.phase ?? "?"}) â€” resume from ledger`);
  }
  if (state.anomalies.length) {
    lines.push(`state anomalies: ${state.anomalies.length}`);
    lines.push(...state.anomalies.map((anomaly) => `  - ${anomaly}`));
    healthy = false;
  }

  const loaded = await loadLatestSpec(join(cwd, TS_DIR));
  if (loaded) {
    lines.push(loaded.spec ? `spec: v${loaded.spec.spec_version} valid` : "spec: INVALID");
    if (!loaded.spec) healthy = false;
  } else {
    lines.push("spec: none");
  }

  lines.push(healthy ? "doctor: healthy" : "doctor: PROBLEMS FOUND");
  return healthy ? ok(lines.join("\n")) : fail(lines.join("\n"));
}

async function cmdCodex(cwd: string, args: ParsedArgs): Promise<CliResult> {
  const [mode, unit] = args.positional;
  if ((mode !== "produce" && mode !== "verify") || !unit || !args.flags.workspace) {
    return fail("usage: clockwork codex <produce|verify> <unit> --workspace <linked-worktree> [--model ID --codex-bin /absolute/codex --timeout-ms N --windows-sandbox elevated|unelevated|mxc]");
  }
  const timeoutMs = args.flags["timeout-ms"] === undefined ? 15 * 60_000 : Number(args.flags["timeout-ms"]);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) return fail("timeout-ms must be between 1000 and 3600000");
  const windowsSandbox = args.flags["windows-sandbox"];
  if (windowsSandbox !== undefined && !["elevated", "unelevated", "mxc"].includes(windowsSandbox)) return fail("windows-sandbox must be elevated, unelevated or mxc");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const report = await runUnit({ project: cwd, workspace: args.flags.workspace, unit,
      mode, model: args.flags.model, signal: controller.signal,
      adapter: new CodexAdapter({ executable: args.flags["codex-bin"], timeoutMs, windowsSandbox: windowsSandbox as "elevated" | "unelevated" | "mxc" | undefined }),
    });
    return { code: report.outcome === "rework" || report.outcome === "blocked" ? 1 : 0, out: JSON.stringify(report, null, 2) };
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

/* ---------------- dispatch ---------------- */

const USAGE = `clockwork <command>

  init                          create .teamsmith/
  event <type> [flags]          append a ledger event (--actor --unit --agent --data)
  state                         print derived run state (JSON)
  status                        human-readable run summary + budget
  changelog                     print the changelog projection
  spec save <draft.yaml>        validate and store the next spec version
  spec latest                   print the path of the latest spec
  amend <amendment.yaml>        apply an amendment (new spec version + event)
  guard set <guard.json>        install the hook guard config
  pause | resume | kill         flip the control switch
  retro [flags]                 write the retro record (--project-type --satisfied --note)
  ui [--port N]                 serve the local management panel (ledger projection)
  recall [--project-type X --dir D]   summarize prior experience from retro records
  vet <skill-dir> [--name N]    static vetting card for a third-party skill
  library <list|find|save>      private library of reusable agent definitions
  commands <pull|peek|ack N>    read/replay panel commands; ack only after applying them
  audit [--dir D --json]        secret scan + npm audit card (reject exits nonzero)
  gp verify <evidence-dir>      mechanical golden-path threshold check (--golden-path gp-N)
  prompt <unit|verify|agentdef> <id>   print a generated prompt
  codex <produce|verify> <unit> --workspace <path>   run a bounded local Codex worker
  doctor                        environment and ledger self-check`;

export async function runCli(argv: string[], cwd: string): Promise<CliResult> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  try {
    switch (command) {
      case "init":
        return await cmdInit(cwd);
      case "event":
        return await cmdEvent(cwd, args);
      case "state":
        return await cmdState(cwd);
      case "status":
        return await cmdStatus(cwd);
      case "changelog":
        return await cmdChangelog(cwd);
      case "spec":
        if (args.positional[0] === "save") {
          return await cmdSpecSave(cwd, { ...args, positional: args.positional.slice(1) });
        }
        if (args.positional[0] === "latest") return await cmdSpecLatest(cwd);
        return fail(USAGE);
      case "amend":
        return await cmdAmend(cwd, args);
      case "guard":
        if (args.positional[0] === "set") {
          return await cmdGuardSet(cwd, { ...args, positional: args.positional.slice(1) });
        }
        return fail(USAGE);
      case "pause":
        return await setControl(cwd, { paused: true, kill: false });
      case "resume":
        return await setControl(cwd, { paused: false, kill: false });
      case "kill":
        return await setControl(cwd, { paused: false, kill: true });
      case "retro":
        return await cmdRetro(cwd, args);
      case "ui":
        return await cmdUi(cwd, args);
      case "recall":
        return await cmdRecall(cwd, args);
      case "vet":
        return await cmdVet(cwd, args);
      case "commands":
        return await cmdCommands(cwd, args);
      case "audit":
        return await cmdAudit(cwd, args);
      case "gp":
        return await cmdGp(cwd, args);
      case "library":
        return await cmdLibrary(cwd, args);
      case "prompt":
        return await cmdPrompt(cwd, args);
      case "codex":
        return await cmdCodex(cwd, args);
      case "doctor":
        return await cmdDoctor(cwd);
      default:
        return fail(USAGE);
    }
  } catch (err) {
    return fail(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2), process.cwd());
  process.stdout.write(`${result.out}\n`);
  process.exitCode = result.code;
}
