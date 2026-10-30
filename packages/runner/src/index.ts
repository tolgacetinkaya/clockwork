import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  atomicWrite,
  assertStorageFile,
  buildUnitPrompt,
  buildVerifierPrompt,
  LedgerWriter,
  loadLatestSpec,
  parseBudget,
  readLedger,
  reduceLedger,
  withStorageLock,
} from "@clockwork/core";
import type {
  ExecutionAdapter,
  ExecutionReport,
  Spec,
  RunState,
} from "@clockwork/core";
import { git, checkWorkspace, fingerprint, withinOwnership } from "./workspace.js";
export interface RunUnitOptions {
  project: string;
  workspace: string;
  unit: string;
  mode: "produce" | "verify";
  adapter: ExecutionAdapter;
  model?: string;
  signal?: AbortSignal;
}
interface Receipt {
  version: number;
  workspace: string;
  head: string;
  hash: string;
  execution: string;
}
async function control(project: string): Promise<void> {
  const value: unknown = JSON.parse(
    await readFile(join(project, ".teamsmith/control.json"), "utf8"),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { paused?: unknown }).paused !== "boolean" ||
    typeof (value as { kill?: unknown }).kill !== "boolean"
  )
    throw new Error("Control file is invalid");
  if (
    (value as { paused: boolean }).paused ||
    (value as { kill: boolean }).kill
  )
    throw new Error("Execution is paused or stopped");
}
async function preflight(
  project: string,
  allowExhausted = false,
): Promise<{ spec: Spec; state: RunState }> {
  await control(project);
  const ledger = await readLedger(join(project, ".teamsmith/ledger.jsonl"));
  const state = reduceLedger(ledger.events);
  const loaded = await loadLatestSpec(join(project, ".teamsmith"));
  if (ledger.issues.length || state.anomalies.length)
    throw new Error("Repair ledger diagnostics before execution");
  if (
    !loaded?.spec ||
    !state.specApproved ||
    loaded.spec.spec_version !== state.specVersion
  )
    throw new Error("Execution requires the current approved specification");
  if (
    state.phase !== "execute" ||
    state.outcome ||
    state.paused ||
    state.pendingQuestions.length ||
    state.openCheckpoints.some((c) => c.blocking)
  )
    throw new Error("Run is not ready for execution");
  if (
    !state.budgetTarget ||
    (!allowExhausted && (state.totalSpent >= state.budgetTarget ||
    state.budgetExhausted))
  )
    throw new Error("No recorded token budget remains");
  // A failed process may have consumed tokens without returning its usage. Never infer zero.
  for (const e of ledger.events.filter(
    (e) => e.type === "agent.error" && e.data?.usage_unknown === true,
  )) {
    if (
      !ledger.events.some(
        (reconciled) =>
          reconciled.type === "budget.spent" &&
          reconciled.data?.reconciles_execution === e.data?.execution,
      )
    ) {
      throw new Error(
        "A previous execution has unknown usage; reconcile it before starting another worker",
      );
    }
  }
  return { spec: loaded.spec, state };
}
/** One active worker per project. The orchestration policy is independent of the provider. */
export async function runUnit(options: RunUnitOptions): Promise<ExecutionReport> {
  return withStorageLock(join(options.project, ".teamsmith/execution"), () => executeUnit(options));
}
// Private: only the scheduler holding the project execution lease may bypass it.
async function executeUnit(options: RunUnitOptions): Promise<ExecutionReport> {
  const { project, unit: unitId, mode, adapter } = options;
    options.signal?.throwIfAborted();
    const { spec, state } = await preflight(project);
    const unit = spec.work_units.find((u) => u.id === unitId);
    const current = state.units[unitId];
    if (!unit || !current) throw new Error("Unknown work unit");
    if (
      mode === "produce" &&
      (!["pending", "rework"].includes(current.status) ||
        current.dependsOn.some((id) => state.units[id]?.status !== "accepted"))
    )
      throw new Error("Unit is not ready for a producer");
    if (mode === "verify" && current.status !== "running")
      throw new Error(
        "Verification requires a completed producer in running state",
      );
    if (
      mode === "produce" &&
      unit.budget_est !== undefined &&
      parseBudget(unit.budget_est) > state.budgetTarget! - state.totalSpent
    )
      throw new Error("Unit estimate exceeds the remaining token budget");
    const workspace = await checkWorkspace(project, options.workspace);
    const before = await fingerprint(workspace);
    const receipts = join(project, ".teamsmith/executions");
    const receiptPath = join(receipts, `${unitId}.json`);
    if (
      mode === "produce" &&
      current.status !== "rework" &&
      before.files.length
    )
      throw new Error(
        "Producer worktree must be clean; preserve or commit previous changes first",
      );
    if (mode === "verify" || current.status === "rework") {
      await assertStorageFile(receiptPath);
      const receipt: Receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      if (
        receipt.version !== spec.spec_version ||
        receipt.workspace !== workspace ||
        receipt.head !== before.head ||
        receipt.hash !== before.hash
      )
        throw new Error(
          "Worktree changed since production; review it before verification",
        );
    }
    const execution = randomUUID();
    const role = spec.assignment[unitId]!;
    const agent = `${role}-${adapter.id}-${mode}-${execution.slice(0, 8)}`;
    const writer = await LedgerWriter.open(
      join(project, ".teamsmith/ledger.jsonl"),
    );
    const append = (
      type: Parameters<typeof writer.append>[0],
      data?: Record<string, unknown>,
    ) => writer.append(type, { unit_id: unitId, agent_id: agent, data });
    const data = {
      provider: adapter.id,
      execution,
      mode,
      ...(options.model ? { model: options.model } : {}),
    };
    await append(
      mode === "produce" ? "unit.started" : "unit.verify_started",
      data,
    );
    await append("agent.spawned", data);
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("Execution interrupted"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void control(project)
        .catch(abort)
        .finally(() => {
          checking = false;
        });
    }, 200);
    let threadId: string | undefined,
      report: ExecutionReport | undefined,
      usageRecorded = false;
    try {
      const prompt =
        (mode === "produce"
          ? buildUnitPrompt(spec, unitId, "workspace")
          : buildVerifierPrompt(spec, unitId)) +
        `

## Runtime contract
You run in a dedicated Git worktree. Never commit, reset, merge, publish, start other agents,
read credential stores, or modify Git metadata or orchestration state. No external services.
${mode === "verify" ? "This session is read-only. A check that requires writes must be reported as unverified/rework; do not weaken the sandbox." : "Keep changes within the listed ownership scopes. Do not create ignored files to hide changes."}
Return ONLY the JSON object required by the output schema. Use outcome ${mode === "verify" ? '"accepted", "rework", or "blocked"' : '"completed" or "blocked"'}.
For evidence, copy each acceptance criterion exactly and give the actual command, observed result,
and passed boolean. Missing evidence is not success. Do not put credentials into reports.
`;
      for await (const event of adapter.execute({
        workspace,
        prompt,
        mode,
        model: options.model,
        signal: controller.signal,
      })) {
        controller.signal.throwIfAborted();
        if (event.type === "thread") threadId = event.id;
        if (event.type === "activity")
          await append("agent.activity", {
            ...data,
            kind: event.kind,
            status: event.status,
          });
        if (event.type === "usage") {
          if (
            usageRecorded ||
            ![event.input, event.cached, event.output].every(
              (n) => Number.isSafeInteger(n) && n >= 0,
            ) ||
            event.cached > event.input ||
            !Number.isSafeInteger(event.input + event.output)
          )
            throw new Error("Invalid or repeated adapter usage");
          await append("budget.spent", {
            ...data,
            tokens: event.input + event.output,
            input_tokens: event.input,
            cached_input_tokens: event.cached,
            output_tokens: event.output,
          });
          usageRecorded = true;
        }
        if (event.type === "report") {
          if (report) throw new Error("Repeated execution report");
          report = event.report;
        }
      }
      await control(project);
      controller.signal.throwIfAborted();
      const latest = await readLedger(join(project, ".teamsmith/ledger.jsonl"));
      const latestState = reduceLedger(latest.events);
      if (
        latest.issues.length ||
        latestState.anomalies.length ||
        latestState.specVersion !== spec.spec_version ||
        latestState.units[unitId]?.status !==
          (mode === "produce" ? "running" : "verifying") ||
        latestState.paused ||
        latestState.outcome
      ) {
        throw new Error(
          "Run changed during execution; delivery needs manual review",
        );
      }
      if (!usageRecorded || !report)
        throw new Error("Worker did not return usage and a report");
      const after = await fingerprint(workspace);
      if (after.head !== before.head)
        throw new Error(
          "Worker changed Git HEAD; review the worktree manually",
        );
      if (
        mode === "produce" &&
        after.files.some((file) => !withinOwnership(file, unit.owns))
      )
        throw new Error(
          "Worker changed a file outside unit ownership; review the worktree manually",
        );
      if (mode === "verify" && after.hash !== before.hash)
        throw new Error("Verifier modified the worktree; acceptance refused");
      if (mode === "produce") {
        if (report.outcome === "blocked") {
          await append("agent.completed", {
            ...data,
            thread_id: threadId,
            report,
          });
          await append("unit.failed", {
            ...data,
            reason: "Producer reported blocked",
          });
          return report;
        }
        if (report.outcome !== "completed")
          throw new Error("Producer returned an invalid completion outcome");
        await mkdir(receipts, { recursive: true });
        if (!(await lstat(receipts)).isDirectory())
          throw new Error("Execution receipt directory must not be an alias");
        await atomicWrite(
          receiptPath,
          JSON.stringify({
            version: spec.spec_version,
            workspace,
            head: after.head,
            hash: after.hash,
            execution,
          } satisfies Receipt),
        );
      } else {
        const completeEvidence = unit.acceptance.every((criterion) =>
          report!.evidence.some(
            (e) =>
              e.criterion === criterion &&
              e.passed &&
              e.command.trim() &&
              e.result.trim(),
          ),
        );
        if (
          report.outcome !== "accepted" ||
          !completeEvidence ||
          report.findings.length ||
          report.evidence.some((e) => !e.passed)
        ) {
          report = {
            ...report,
            outcome: "rework",
            findings: [
              ...report.findings,
              ...(!completeEvidence
                ? ["Acceptance evidence is incomplete"]
                : []),
            ],
          };
        }
      }
      await append("agent.completed", { ...data, thread_id: threadId, report });
      if (mode === "verify")
        await append(
          report.outcome === "accepted" ? "unit.accepted" : "unit.rework",
          { ...data, thread_id: threadId },
        );
      return report;
    } catch (error) {
      // Provider errors do not contain raw stderr/tool output. Redaction still applies at append.
      await append("agent.error", {
        ...data,
        thread_id: threadId,
        usage_unknown: !usageRecorded,
        reason: error instanceof Error ? error.message : "Execution failed",
      });
      const failedState = reduceLedger(
        (await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events,
      );
      if (
        !failedState.outcome &&
        failedState.units[unitId]?.status ===
          (mode === "verify" ? "verifying" : "running")
      ) {
        await append(mode === "verify" ? "unit.rework" : "unit.failed", {
          ...data,
          reason: "Execution did not pass the delivery gate",
        });
      }
      throw error;
    } finally {
      clearInterval(timer);
      options.signal?.removeEventListener("abort", abort);
    }

}

export interface RunTeamOptions {
  project: string;
  adapter: ExecutionAdapter;
  concurrency?: number;
  model?: string;
  signal?: AbortSignal;
}
export interface TeamResult {
  status: "completed" | "stopped";
  accepted: string[];
  failures: Record<string, string>;
  integrationWorkspace?: string;
  integrationVerification?: { status: "passed" | "failed" | "not_configured"; report?: ExecutionReport; reason?: string };
}

/** Owns one project lease for the entire team, including integration and settlement.
 * Worktrees and the durable receipt are deliberately retained for operator review.
 * Estimates reserve BOTH producer and verifier sessions; these are admission limits,
 * not provider token caps. Actual usage remains authoritative in the ledger.
 */
export async function runTeam(options: RunTeamOptions): Promise<TeamResult> {
  return withStorageLock(join(options.project, ".teamsmith/execution"), () => executeTeam(options));
}
interface TeamReceipt extends TeamResult {
  version: number; specVersion: number; id: string;
  workspaces: Record<string, string>; commits: Record<string, string>;
  integrationHead: string; attempt: number;
}
async function executeTeam(options: RunTeamOptions, recovery?: TeamReceipt): Promise<TeamResult> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("Team concurrency must be an integer from 1 to 8");
  const { project } = options;
  const result: TeamResult = { status: "stopped", accepted: [...(recovery?.accepted ?? [])], failures: {}, ...(recovery?.integrationWorkspace ? { integrationWorkspace: recovery.integrationWorkspace } : {}) };
  const receiptPath = join(project, ".teamsmith/team.json");
  await assertStorageFile(receiptPath);
  if (!recovery) {
    try {
      await readFile(receiptPath, "utf8");
      throw new Error("A team receipt already exists; review its preserved worktrees and reconcile state before another team run");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const initial = await preflight(project);
  if (!recovery && Object.values(initial.state.units).some(u => u.status !== "pending"))
    throw new Error("Team execution requires pending units; existing deliveries need manual reconciliation");
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("Team execution stopped"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const id = recovery?.id ?? randomUUID();
    const attempt = (recovery?.attempt ?? 0) + 1;
    let integrationHead = recovery?.integrationHead ?? "";
    // Git's own worktree registry owns these paths; never delete them automatically.
    const root = join(project, "..", `.clockwork-team-${id}`);
    const workspaces: Record<string, string> = { ...recovery?.workspaces };
    const commits: Record<string, string> = { ...recovery?.commits };
    const active = new Map<string, Promise<void>>();
    const reservations = new Map<string, number>();
    let stopped = false;
    let integration: Promise<void> = Promise.resolve();
    let persistence: Promise<void> = Promise.resolve();
    const persist = () => {
      const next = persistence.then(() => atomicWrite(receiptPath, JSON.stringify({
        version: 2, specVersion: initial.spec.spec_version, id, attempt, integrationHead,
        ...result, workspaces, commits, reservations: Object.fromEntries(reservations),
      }, null, 2)));
      persistence = next.catch(() => {});
      return next;
    };
    const fail = (unit: string, error: unknown) => {
      result.failures[unit] ??= error instanceof Error ? error.message : String(error);
      stopped = true;
      abort();
    };
    const observe = async () => {
      controller.signal.throwIfAborted();
      const current = await preflight(project, true);
      if (current.spec.spec_version !== initial.spec.spec_version)
        throw new Error("Specification changed during team execution");
      if (Object.values(current.state.units).some(u => ["cancelled", "failed", "rework"].includes(u.status)))
        throw new Error("A unit was cancelled, failed, or requires rework");
      return current;
    };
    const teamWriter = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
    let observation: Promise<void> | undefined;
    let observing = false;
    const timer = setInterval(() => {
      if (observing || stopped) return;
      observing = true;
      observation = observe().then(() => {}).catch(error => fail("team", error)).finally(() => { observing = false; });
    }, 200);
    try {
      await persist(); // Record intent BEFORE creating any Git worktree.
      controller.signal.throwIfAborted();
      await mkdir(root, { recursive: true });
      result.integrationWorkspace = join(root, "integration");
      await persist();
      if (!recovery) {
        await git(project, "worktree", "add", "-b", `clockwork/team-${id}`, result.integrationWorkspace, "HEAD");
        integrationHead = await git(result.integrationWorkspace, "rev-parse", "HEAD");
        await persist();
      }
      while (!stopped) {
        const { spec } = await observe();
        if (result.accepted.length === spec.work_units.length) {
          result.status = "completed";
          break;
        }
        for (const unit of spec.work_units) {
          if (active.size >= concurrency || stopped) break;
          if (active.has(unit.id) || result.accepted.includes(unit.id)) continue;
          if (!(unit.depends_on ?? []).every(dep => result.accepted.includes(dep))) continue;
          if (unit.budget_est === undefined) {
            fail(unit.id, new Error("Team execution requires an explicit budget estimate for producer and verifier reservations"));
            break;
          }
          const reservation = 2 * parseBudget(unit.budget_est);
          if (!Number.isSafeInteger(reservation) || reservation <= 0) {
            fail(unit.id, new Error("Team budget estimate must be a positive safe integer"));
            break;
          }
          // Git creation and other admissions await I/O: refresh actual usage and
          // live reservations for EVERY candidate, never reuse an old snapshot.
          const admission = await observe();
          const available = admission.state.budgetTarget! - admission.state.totalSpent - [...reservations.values()].reduce((a, b) => a + b, 0);
          if (reservation > available) continue;
          reservations.set(unit.id, reservation);
          const workspace = join(root, recovery ? `${unit.id}-attempt-${attempt}` : unit.id);
          workspaces[unit.id] = workspace;
          await persist();
          await git(project, "worktree", "add", "--detach", workspace, await git(result.integrationWorkspace!, "rev-parse", "HEAD"));
          await observe();
          const task = (async () => {
            try {
              const common = { project, workspace, unit: unit.id, adapter: options.adapter, model: options.model, signal: controller.signal };
              const produced = await executeUnit({ ...common, mode: "produce" });
              if (produced.outcome !== "completed") throw new Error("Producer reported blocked");
              await observe();
              const verified = await executeUnit({ ...common, mode: "verify" });
              if (verified.outcome !== "accepted") throw new Error("Verification requires rework; automatic retries are disabled");
              // Queue integration: independent workers may finish simultaneously.
              const next = integration.then(async () => {
                await observe();
                const delivery: Receipt = JSON.parse(await readFile(join(project, ".teamsmith/executions", `${unit.id}.json`), "utf8"));
                const current = await fingerprint(workspace);
                if (current.head !== delivery.head || current.hash !== delivery.hash)
                  throw new Error("Verified delivery changed before integration; manual review required");
                await git(workspace, "add", "--all");
                await git(workspace, "-c", "user.name=Clockwork", "-c", "user.email=clockwork@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", `Clockwork accepted ${unit.id}`);
                const commit = await git(workspace, "rev-parse", "HEAD");
                // Persist the source commit before cherry-pick: interruption is recoverable.
                commits[unit.id] = commit;
                await persist();
                await observe();
                await git(result.integrationWorkspace!, "-c", "user.name=Clockwork", "-c", "user.email=clockwork@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "cherry-pick", "--allow-empty", commit);
                integrationHead = await git(result.integrationWorkspace!, "rev-parse", "HEAD");
                result.accepted.push(unit.id);
                await persist();
              });
              integration = next.catch(() => {});
              await next;
            } catch (error) {
              fail(unit.id, error);
            }
            finally { reservations.delete(unit.id); active.delete(unit.id); }
          })();
          active.set(unit.id, task);
        }
        if (stopped) break;
        if (result.accepted.length === spec.work_units.length) {
          result.status = "completed";
          break;
        }
        if (!active.size) {
          fail("team", new Error("No dispatchable unit fits the remaining producer/verifier budget reservations or dependency graph"));
          break;
        }
        await Promise.race(active.values());
      }
    } catch (error) { fail("team", error); }
    finally {
      clearInterval(timer);
      await observation;
      await Promise.allSettled(active.values());
      await integration;
      if (!stopped) {
        try { await observe(); } catch (error) { fail("team", error); }
      }
      if (!stopped && result.status === "completed") {
        try {
          result.integrationVerification = await verifyIntegration(options, initial.spec, result.integrationWorkspace!, controller.signal);
          await observe();
          if (result.integrationVerification.status === "failed") fail("integration", new Error(result.integrationVerification.reason ?? "Combined integration acceptance failed"));
        } catch (error) {
          result.integrationVerification = { status: "failed", reason: error instanceof Error ? error.message : String(error) };
          fail("integration", error);
        }
      }
      options.signal?.removeEventListener("abort", abort);
      if (stopped) {
        result.status = "stopped";
        await teamWriter.append("interaction.checkpoint_raised", { actor: "orchestrator", data: {
          ref: `team-${id}`, kind: "gate", blocking: true,
          message: "Team execution stopped. Review the preserved team receipt, worktrees, and integration state before resuming.",
          failures: result.failures, integration_workspace: result.integrationWorkspace,
        } });
      }
      await persist();
    }
    return result;
}
async function verifyIntegration(options: RunTeamOptions, spec: Spec, workspace: string, signal: AbortSignal): Promise<NonNullable<TeamResult["integrationVerification"]>> {
  const gates = spec.verification?.global_gates ?? [];
  if (!gates.length) return { status: "not_configured" };
  await preflight(options.project);
  const before = await fingerprint(await checkWorkspace(options.project, workspace));
  if (before.files.length) throw new Error("Integration verification requires a clean worktree");
  const writer = await LedgerWriter.open(join(options.project, ".teamsmith/ledger.jsonl"));
  const execution = randomUUID();
  const data = { execution, provider: options.adapter.id, mode: "integration_verify", ...(options.model ? { model: options.model } : {}) };
  const agent_id = `integration-${execution}`;
  const append = (type: Parameters<typeof writer.append>[0], extra: Record<string, unknown> = {}) => writer.append(type, { agent_id, data: { ...data, ...extra } });
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Integration verification interrupted"));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let observing: Promise<void> | undefined;
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    observing = control(options.project).catch(abort).finally(() => { checking = false; });
  }, 200);
  let usageRecorded = false;
  let report: ExecutionReport | undefined;
  let verdict: NonNullable<TeamResult["integrationVerification"]> | undefined;
  try {
    await append("agent.spawned");
    for await (const event of options.adapter.execute({
      workspace, mode: "verify", model: options.model, signal: controller.signal,
      prompt: `# Final integration verification\n\nGoal: ${spec.meta.goal}\nYou are a fresh independent read-only verifier over the combined integrated result.\nRun EVERY global acceptance gate below and give exact criterion, actual command, observed result and passed boolean.\nNever modify files, Git metadata, commit, start agents, publish, access credentials or external services.\nA gate without actual evidence fails. Return ONLY the report JSON with outcome accepted, rework, or blocked.\n\n## Global acceptance gates\n${gates.map(g => `- ${g}`).join("\n")}\n`,
    })) {
      controller.signal.throwIfAborted();
      if (event.type === "activity") await append("agent.activity", { kind: event.kind, status: event.status });
      if (event.type === "usage") {
        if (usageRecorded || ![event.input, event.cached, event.output].every(n => Number.isSafeInteger(n) && n >= 0) || event.cached > event.input || !Number.isSafeInteger(event.input + event.output))
          throw new Error("Invalid or repeated integration verifier usage");
        await append("budget.spent", { tokens: event.input + event.output, input_tokens: event.input, cached_input_tokens: event.cached, output_tokens: event.output });
        usageRecorded = true;
      }
      if (event.type === "report") {
        if (report) throw new Error("Repeated integration verification report");
        report = event.report;
      }
    }
    controller.signal.throwIfAborted();
    const latest = await preflight(options.project, true);
    if (latest.spec.spec_version !== spec.spec_version) throw new Error("Specification changed during integration verification");
    if (!usageRecorded || !report) throw new Error("Integration verifier did not return usage and report");
    const after = await fingerprint(workspace);
    if (after.head !== before.head || after.hash !== before.hash) throw new Error("Integration verifier modified the combined delivery");
    await append("agent.completed", { report });
    if (report.outcome !== "accepted" || report.findings.length || report.evidence.some(e => !e.passed) || !gates.every(criterion => report!.evidence.some(e => e.criterion === criterion && e.passed && e.command.trim() && e.result.trim())))
      verdict = { status: "failed", report, reason: "Combined integration acceptance gates failed or evidence is incomplete" };
    else verdict = { status: "passed", report };
  } catch (error) {
    await append("agent.error", { usage_unknown: !usageRecorded, reason: error instanceof Error ? error.message : "Integration verification failed" });
    throw error;
  } finally {
    clearInterval(timer);
    await observing;
    signal.removeEventListener("abort", abort);
  }
  controller.signal.throwIfAborted();
  const settled = await preflight(options.project, true);
  if (settled.spec.spec_version !== spec.spec_version) throw new Error("Specification changed after integration verification");
  return verdict!;
}

export interface TeamRecoveryInspection {
  recoveryToken: string;
  receipt: TeamReceipt | null;
  reasons: string[];
  canResume: boolean;
}
/** Read-only review. The opaque revision binds receipt, ledger, controls and actual Git state. */
export async function inspectTeamRecovery(project: string): Promise<TeamRecoveryInspection> {
  return inspectRecovery(project, false);
}
async function inspectRecovery(project: string, ownsLease: boolean): Promise<TeamRecoveryInspection> {
  const reasons: string[] = [];
  const hash = createHash("sha256");
  const read = async (name: string) => {
    const path = join(project, ".teamsmith", name);
    await assertStorageFile(path);
    const contents = await readFile(path, "utf8");
    hash.update(name).update(contents);
    return contents;
  };
  let receipt: TeamReceipt | null = null;
  try {
    const value: unknown = JSON.parse(await read("team.json"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid team receipt");
    const r = value as TeamReceipt;
    if (r.version !== 2 || typeof r.id !== "string" || !/^[a-f0-9-]{36}$/.test(r.id) || !Number.isSafeInteger(r.attempt) || r.attempt < 1 || !Array.isArray(r.accepted) || r.accepted.some(id => typeof id !== "string") || new Set(r.accepted).size !== r.accepted.length || typeof r.integrationWorkspace !== "string" || typeof r.integrationHead !== "string" || !r.workspaces || Array.isArray(r.workspaces) || typeof r.workspaces !== "object" || !r.commits || Array.isArray(r.commits) || typeof r.commits !== "object" || !Number.isSafeInteger(r.specVersion) || !/^[a-f0-9]{40,64}$/.test(r.integrationHead))
      throw new Error("Team receipt is invalid or predates controlled recovery; manual reconciliation required");
    receipt = r;
    if (r.status !== "stopped") reasons.push("Only a stopped team can be resumed");
    const ledgerText = await read("ledger.jsonl");
    const ledger = await readLedger(join(project, ".teamsmith/ledger.jsonl"));
    const state = reduceLedger(ledger.events);
    if (ledger.issues.length || state.anomalies.length) reasons.push("Repair ledger diagnostics before recovery");
    const loaded = await loadLatestSpec(join(project, ".teamsmith"));
    hash.update(JSON.stringify(loaded?.spec));
    if (!loaded?.spec || !state.specApproved || loaded.spec.spec_version !== r.specVersion || state.specVersion !== r.specVersion)
      reasons.push("Team receipt does not match the current approved specification");
    if (state.phase !== "execute" || state.outcome) reasons.push("Run is not in an active execution phase");
    if (state.pendingQuestions.length || state.openCheckpoints.some(c => c.blocking && c.ref !== `team-${r.id}`))
      reasons.push("Unrelated questions or blocking checkpoints require resolution");
    if (!state.budgetTarget || state.totalSpent >= state.budgetTarget || state.budgetExhausted) reasons.push("No recorded token budget remains");
    if (Object.values(state.units).some(u => ["running", "verifying"].includes(u.status))) reasons.push("A worker is still running or unreconciled; manual review required");
    if (Object.values(state.units).some(u => u.status === "cancelled")) reasons.push("Cancelled units require specification reconciliation");
    if (ledger.events.some(event => event.type === "agent.spawned" && !ledger.events.some(terminal => ["agent.completed", "agent.error"].includes(terminal.type) && terminal.data?.execution === event.data?.execution)))
      reasons.push("A worker or integration verifier session is still running or unreconciled; manual review required");
    for (const event of ledger.events.filter(e => e.type === "agent.error" && e.data?.usage_unknown === true))
      if (!ledger.events.some(e => e.type === "budget.spent" && e.data?.reconciles_execution === event.data?.execution)) reasons.push("Unknown execution usage must be reconciled before recovery");
    if (r.accepted.some(id => state.units[id]?.status !== "accepted") || Object.entries(state.units).some(([id,u]) => u.status === "accepted" && !r.accepted.includes(id)))
      reasons.push("Accepted ledger units and integrated receipt disagree; manual integration reconciliation required");
    const controls: unknown = JSON.parse(await read("control.json"));
    if (!controls || typeof controls !== "object" || typeof (controls as { paused?: unknown }).paused !== "boolean" || typeof (controls as { kill?: unknown }).kill !== "boolean") reasons.push("Control file is invalid");
    const workspace = await checkWorkspace(project, r.integrationWorkspace);
    const expectedWorkspace = await realpath(join(project, "..", `.clockwork-team-${r.id}`, "integration"));
    if (workspace !== expectedWorkspace || await git(workspace, "branch", "--show-current") !== `clockwork/team-${r.id}`)
      reasons.push("Integration workspace or branch does not match the team identity");
    if (r.accepted.some(id => !loaded?.spec?.work_units.some(u => u.id === id) || typeof r.commits[id] !== "string"))
      reasons.push("Integrated receipt contains unknown units or missing source commits");
    const actual = await fingerprint(workspace);
    hash.update(JSON.stringify(actual));
    if (actual.head !== r.integrationHead || actual.files.length) reasons.push("Integration HEAD or files changed, or a Git conflict remains; manual reconciliation required");
    const unmerged = await git(workspace, "ls-files", "--unmerged");
    if (unmerged) reasons.push("Integration Git conflict remains unresolved");
    const executionReceipts: Record<string, unknown> = {};
    for (const [unit, path] of Object.entries(r.workspaces)) {
      if (typeof path !== "string" || !loaded?.spec?.work_units.some(u => u.id === unit)) throw new Error("Invalid worker workspace receipt");
      const worker = await checkWorkspace(project, path);
      const workerName = relative(dirname(expectedWorkspace), worker);
      if (workerName !== unit && !new RegExp(`^${unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-attempt-[0-9]+$`).test(workerName)) reasons.push("Worker path does not match its team identity");
      const current = await fingerprint(worker);
      const executionReceipt = join(project, ".teamsmith/executions", `${unit}.json`);
      await assertStorageFile(executionReceipt);
      try {
        const raw = await readFile(executionReceipt, "utf8");
        hash.update(unit).update(raw);
        executionReceipts[unit] = JSON.parse(raw);
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (r.accepted.includes(unit) && (current.files.length || current.head !== r.commits[unit])) reasons.push("Accepted source commit changed; manual review required");
      hash.update(unit).update(JSON.stringify(current));
    }
    const archivePath = join(project, ".teamsmith", `team-${r.id}-attempt-${r.attempt}.json`);
    await assertStorageFile(archivePath);
    try {
      const archived = await readFile(archivePath, "utf8");
      hash.update("archive").update(archived);
      if (archived !== JSON.stringify({ ...r, executionReceipts }, null, 2)) reasons.push("Recovery archive differs from the reviewed stopped attempt; manual reconciliation required");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("archive-absent");
    }
    hash.update(ledgerText);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Recovery inspection failed");
  }
  if (!ownsLease) {
    try { await lstat(join(project, ".teamsmith/execution.lock")); reasons.push("Execution lease is active or stale; never remove a live owner's lock"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") reasons.push("Cannot inspect execution lease"); }
  }
  return { recoveryToken: hash.digest("hex"), receipt, reasons: [...new Set(reasons)], canResume: reasons.length === 0 };
}

export async function resumeTeam(options: RunTeamOptions & { recoveryToken: string }): Promise<TeamResult> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("Team concurrency must be an integer from 1 to 8");
  return withStorageLock(join(options.project, ".teamsmith/execution"), async () => {
    options.signal?.throwIfAborted();
    const recovery = await withStorageLock(join(options.project, ".teamsmith/control.json"), async () => {
    const inspection = await inspectRecovery(options.project, true);
    if (inspection.recoveryToken !== options.recoveryToken) throw new Error("Recovery review is stale; inspect the team again before resuming");
    if (!inspection.canResume || !inspection.receipt) throw new Error(`Recovery is blocked: ${inspection.reasons.join("; ")}`);
    const r = inspection.receipt;
    const archive = join(options.project, ".teamsmith", `team-${r.id}-attempt-${r.attempt}.json`);
    // Exclusive creation preserves the old attempt, including its original execution receipts.
    const receipts: Record<string, unknown> = {};
    for (const unit of Object.keys(r.workspaces)) {
      try { receipts[unit] = JSON.parse(await readFile(join(options.project, ".teamsmith/executions", `${unit}.json`), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const archiveContents = JSON.stringify({ ...r, executionReceipts: receipts }, null, 2);
    try { await writeFile(archive, archiveContents, { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await assertStorageFile(archive);
      if (await readFile(archive, "utf8") !== archiveContents)
        throw new Error("Recovery archive differs from the reviewed attempt; manual reconciliation required");
    }
    // Reserve the next attempt durably BEFORE changing retry/checkpoint/control state.
    // A newer stop after the control lock releases must leave another reviewable attempt.
    await atomicWrite(join(options.project, ".teamsmith/team.json"), JSON.stringify({ ...r, attempt: r.attempt + 1, status: "stopped", failures: { team: "Reviewed recovery has not settled" }, reservations: {} }, null, 2));
    const writer = await LedgerWriter.open(join(options.project, ".teamsmith/ledger.jsonl"));
    let state = reduceLedger((await readLedger(join(options.project, ".teamsmith/ledger.jsonl"))).events);
    if (state.openCheckpoints.some(c => c.ref === `team-${r.id}`))
      await writer.append("interaction.checkpoint_resolved", { actor: "user", data: { ref: `team-${r.id}`, reason: "Explicit reviewed team resume" } });
    if (state.paused) await writer.append("run.resumed", { actor: "user", data: { reason: "Explicit reviewed team resume" } });
    for (const [unit, value] of Object.entries(state.units))
      if (["failed", "rework"].includes(value.status)) await writer.append("unit.retry_requested", { actor: "user", unit_id: unit, data: { reason: "Explicit reviewed team resume", team_id: r.id } });
    await atomicWrite(join(options.project, ".teamsmith/control.json"), JSON.stringify({ paused: false, kill: false }));
    return r;
    });
    try { return await executeTeam(options, recovery); }
    catch (error) {
      const reason = error instanceof Error ? error.message : "Recovery execution failed";
      const stopped: TeamReceipt = JSON.parse(await readFile(join(options.project, ".teamsmith/team.json"), "utf8"));
      stopped.status = "stopped";
      stopped.failures = { ...stopped.failures, team: reason };
      const ledger = await readLedger(join(options.project, ".teamsmith/ledger.jsonl"));
      const state = reduceLedger(ledger.events);
      if (!state.outcome && !state.openCheckpoints.some(c => c.ref === `team-${stopped.id}`)) {
        const writer = await LedgerWriter.open(join(options.project, ".teamsmith/ledger.jsonl"));
        await writer.append("interaction.checkpoint_raised", { data: { ref: `team-${stopped.id}`, kind: "gate", blocking: true, message: reason } });
      }
      await atomicWrite(join(options.project, ".teamsmith/team.json"), JSON.stringify(stopped, null, 2));
      return stopped;
    }
  });
}
