import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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
import { checkWorkspace, fingerprint, withinOwnership } from "./workspace.js";
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
    state.totalSpent >= state.budgetTarget ||
    state.budgetExhausted
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
export async function runUnit(
  options: RunUnitOptions,
): Promise<ExecutionReport> {
  const { project, unit: unitId, mode, adapter } = options;
  return withStorageLock(join(project, ".teamsmith/execution"), async () => {
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
  });
}
