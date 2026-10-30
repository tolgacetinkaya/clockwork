import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertStorageFile, atomicWrite, LedgerWriter, loadLatestSpec, parseBudget, readLedger, reduceLedger, validateSpec, withStorageLock, writeSpecFile } from "@clockwork/core";
import type { ExecutionReport } from "@clockwork/core";
import type { LaunchState } from "./protocol.js";

export interface PanelExecution {
  run: (options: { project: string; concurrency: number; signal: AbortSignal }) => Promise<NonNullable<LaunchState["result"]>>;
  inspect: (project: string) => Promise<NonNullable<LaunchState["recovery"]> & { receipt?: unknown }>;
  resume: (options: { project: string; concurrency: number; signal: AbortSignal; recoveryToken: string }) => Promise<NonNullable<LaunchState["result"]>>;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function safeGate(value: unknown): NonNullable<LaunchState["result"]>["integrationVerification"] {
  if (!value || typeof value !== "object") return undefined;
  const gate = value as Record<string, unknown>;
  if (!["passed", "failed", "not_configured"].includes(String(gate.status))) return undefined;
  const report = gate.report as Record<string, unknown> | undefined;
  let safeReport: ExecutionReport | undefined;
  if (report && ["completed", "accepted", "rework", "blocked"].includes(String(report.outcome)) && typeof report.summary === "string" && Array.isArray(report.findings) && report.findings.every(f => typeof f === "string") && Array.isArray(report.evidence)) {
    const evidence = report.evidence.filter(e => e && typeof e === "object" && typeof e.criterion === "string" && typeof e.command === "string" && typeof e.result === "string" && typeof e.passed === "boolean").map(e => ({ criterion: e.criterion as string, command: e.command as string, result: e.result as string, passed: e.passed as boolean }));
    safeReport = { outcome: report.outcome as ExecutionReport["outcome"], summary: report.summary, findings: report.findings as string[], evidence };
  }
  return { status: gate.status as "passed" | "failed" | "not_configured", ...(typeof gate.reason === "string" ? { reason: gate.reason } : {}), ...(safeReport ? { report: safeReport } : {}) };
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
async function optional(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
export class LaunchService {
  private state: LaunchState;
  private binding?: string;
  private active?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private requiresRecovery = false;
  constructor(private project: string, private execution: PanelExecution | undefined, reason: string | undefined, private changed: () => void) {
    this.state = { enabled: !!execution, ...(reason ? { disabledReason: reason } : {}), status: "idle" };
  }
  snapshot(): LaunchState { return structuredClone(this.state); }
  private async fingerprint(): Promise<string> {
    const latest = await loadLatestSpec(join(this.project, ".teamsmith"));
    const head = (await exec("git", ["-C", this.project, "rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    return hash([head, await optional(join(this.project, ".teamsmith/ledger.jsonl")), latest?.doc ?? null, await optional(join(this.project, ".teamsmith/control.json")), await optional(join(this.project, ".teamsmith/team.json"))]);
  }
  private async save(): Promise<void> {
    await atomicWrite(join(this.project, ".teamsmith/launch.json"), JSON.stringify({ ...this.state, binding: this.binding, requiresRecovery: this.requiresRecovery }));
    this.changed();
  }
  async restore(): Promise<void> {
    if (!this.execution) return;
    await assertStorageFile(join(this.project, ".teamsmith/launch.json"));
    const raw = await optional(join(this.project, ".teamsmith/launch.json"));
    if (!raw) return;
    const saved = JSON.parse(raw) as LaunchState & { binding?: string; requiresRecovery?: boolean };
    if (!["idle", "running", "completed", "stopped", "error"].includes(saved.status) || (saved.approvalToken !== undefined && typeof saved.approvalToken !== "string") || (saved.binding !== undefined && typeof saved.binding !== "string")) throw new Error("Invalid persisted launch state");
    if (!saved.draft || (validateSpec(saved.draft.spec).spec && hash(saved.draft.spec) === saved.draft.revision)) {
      this.state = { enabled: true, status: saved.status, ...(saved.draft ? { draft: saved.draft } : {}), ...(saved.approvalToken && saved.draft ? { approvalToken: saved.approvalToken } : {}) };
      if (saved.recovery && typeof saved.recovery.recoveryToken === "string" && typeof saved.recovery.canResume === "boolean" && Array.isArray(saved.recovery.reasons) && saved.recovery.reasons.every(r => typeof r === "string")) {
        this.state.recovery = { recoveryToken: saved.recovery.recoveryToken, canResume: saved.recovery.canResume, reasons: saved.recovery.reasons,
          ...(typeof saved.recovery.teamId === "string" ? { teamId: saved.recovery.teamId } : {}),
          ...(Array.isArray(saved.recovery.accepted) && saved.recovery.accepted.every(id => typeof id === "string") ? { accepted: saved.recovery.accepted } : {}),
          ...(Array.isArray(saved.recovery.retry) && saved.recovery.retry.every(id => typeof id === "string") ? { retry: saved.recovery.retry } : {}),
          ...(typeof saved.recovery.integrationWorkspace === "string" ? { integrationWorkspace: saved.recovery.integrationWorkspace } : {}),
          ...(saved.recovery.workspaces && typeof saved.recovery.workspaces === "object" ? { workspaces: Object.fromEntries(Object.entries(saved.recovery.workspaces).filter((entry): entry is [string, string] => typeof entry[1] === "string")) } : {}),
          ...(safeGate(saved.recovery.integrationVerification) ? { integrationVerification: safeGate(saved.recovery.integrationVerification) } : {}) };
      }
      if (saved.result && ["completed", "stopped"].includes(saved.result.status) && Array.isArray(saved.result.accepted) && saved.result.accepted.every(id => typeof id === "string") && saved.result.failures && typeof saved.result.failures === "object") {
        this.state.result = { status: saved.result.status, accepted: saved.result.accepted, failures: Object.fromEntries(Object.entries(saved.result.failures).filter((entry): entry is [string, string] => typeof entry[1] === "string")), ...(typeof saved.result.integrationWorkspace === "string" ? { integrationWorkspace: saved.result.integrationWorkspace } : {}), ...(safeGate(saved.result.integrationVerification) ? { integrationVerification: safeGate(saved.result.integrationVerification) } : {}) };
      }
      this.binding = saved.binding;
      this.requiresRecovery = saved.status === "running" || saved.requiresRecovery === true;
      if (this.requiresRecovery) {
        this.state.status = "error";
        delete this.state.approvalToken;
        this.state.error = "Previous execution may be active or interrupted; inspect recovery before resuming.";
      }
    }
  }
  async request(action: string, body: Record<string, unknown>): Promise<LaunchState> {
    if (!this.execution || this.closed) throw new Error(this.state.disabledReason ?? "Execution is disabled");
    return withStorageLock(join(this.project, ".teamsmith/launch"), async () => {
      if (this.active) throw new Error("An execution is already running");
      await this.restore();
      if (this.requiresRecovery && !action.startsWith("recovery/")) throw new Error("Existing execution requires recovery inspection before changes");
      if (action === "draft") {
        const validation = validateSpec(body.spec);
        if (!validation.spec) throw new Error(validation.issues.map(i => i.message).join("; "));
        const spec = validation.spec;
        if (spec.work_units.length > 100 || JSON.stringify(spec).length > 60000) throw new Error("Plan exceeds the 100-unit / 60KB limit");
        if (!spec.verification?.global_gates?.length || spec.verification.global_gates.some(g => !g.trim())) throw new Error("At least one combined-result global gate is required");
        if (!spec.priorities.budget_target || parseBudget(spec.priorities.budget_target) <= 0 || spec.work_units.some(u => !u.budget_est || parseBudget(u.budget_est) <= 0)) throw new Error("A positive token budget and per-unit estimates are required");
        this.state = { enabled: true, status: "idle", draft: { revision: hash(spec), spec: structuredClone(spec) } };
        this.binding = undefined;
      } else if (action === "approve") {
        if (!this.state.draft || body.revision !== this.state.draft.revision) throw new Error("Draft revision is stale; review the current plan");
        if (this.state.approvalToken) throw new Error("Draft is already approved");
        this.binding = await this.fingerprint();
        this.state.approvalToken = randomUUID();
      } else if (action === "start") {
        if (!this.state.approvalToken || body.approvalToken !== this.state.approvalToken || !this.state.draft) throw new Error("A current reviewed approval token is required");
        if (this.binding !== await this.fingerprint()) throw new Error("Project changed since approval; review and approve again");
        const dirty = (await exec("git", ["-C", this.project, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).teamsmith"], { windowsHide: true })).stdout;
        if (dirty.trim()) throw new Error("Commit or preserve local changes before launching; teams start from committed HEAD");
        const concurrency = this.concurrency(body);
        const spec = this.state.draft.spec;
        await withStorageLock(join(this.project, ".teamsmith/execution"), async () => {
          if (this.binding !== await this.fingerprint()) throw new Error("Project changed since approval");
          const ledger = await readLedger(join(this.project, ".teamsmith/ledger.jsonl"));
          const latest = await loadLatestSpec(join(this.project, ".teamsmith"));
          const state = reduceLedger(ledger.events);
          if (ledger.issues.length || state.anomalies.length || await optional(join(this.project, ".teamsmith/team.json"))) throw new Error("Existing run requires inspection or recovery");
          if (ledger.events.length) {
            if (!latest?.spec || hash(latest.spec) !== hash(spec) || !state.specApproved || state.budgetTarget !== parseBudget(spec.priorities.budget_target!) || state.phase !== "execute" || state.outcome || state.paused || state.pendingQuestions.length || state.openCheckpoints.some(c => c.blocking) || Object.values(state.units).some(u => u.status !== "pending")) throw new Error("Existing run is incompatible with this approved plan");
          } else {
            if (latest) throw new Error("Existing specification must be approved through its current workflow");
            if (spec.spec_version !== 1) throw new Error("A new run must start at spec version 1");
            await mkdir(join(this.project, ".teamsmith"), { recursive: true });
            const controlPath = join(this.project, ".teamsmith/control.json");
            await withStorageLock(controlPath, async () => {
              const control = await optional(controlPath);
              if (control && canonical(JSON.parse(control)) !== canonical({ paused: false, kill: false })) throw new Error("Existing controls block initialization");
              if (!control) await atomicWrite(controlPath, JSON.stringify({ paused: false, kill: false }));
            });
            await writeSpecFile(join(this.project, ".teamsmith"), spec);
            const writer = await LedgerWriter.open(join(this.project, ".teamsmith/ledger.jsonl"));
            await writer.append("run.started", { data: { run_id: randomUUID(), teamsmith_version: "0.1.0", ledger_schema_version: 1 } });
            await writer.append("spec.approved", { actor: "user", data: { version: spec.spec_version, budget_target: parseBudget(spec.priorities.budget_target!), units: spec.work_units.map(u => ({ id: u.id, ...(u.depends_on ? { depends_on: u.depends_on } : {}) })) } });
            for (const unit of spec.work_units) await writer.append("budget.estimated", { unit_id: unit.id, data: { tokens: parseBudget(unit.budget_est!) } });
            await writer.append("run.phase_entered", { data: { phase: "execute" } });
          }
        });
        delete this.state.approvalToken;
        await this.begin(signal => this.execution!.run({ project: this.project, concurrency, signal }));
      } else if (action === "recovery/inspect") {
        const inspected = await this.execution!.inspect(this.project);
        const receipt = inspected.receipt && typeof inspected.receipt === "object" ? inspected.receipt as Record<string, unknown> : {};
        const accepted = Array.isArray(receipt.accepted) ? receipt.accepted.filter((id): id is string => typeof id === "string") : [];
        const workspaces = receipt.workspaces && typeof receipt.workspaces === "object" ? Object.fromEntries(Object.entries(receipt.workspaces).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
        this.state.recovery = { recoveryToken: inspected.recoveryToken, reasons: inspected.reasons, canResume: inspected.canResume, ...(typeof receipt.id === "string" ? { teamId: receipt.id } : {}), accepted, retry: Object.keys(reduceLedger((await readLedger(join(this.project, ".teamsmith/ledger.jsonl"))).events).units).filter(id => !accepted.includes(id)), workspaces, ...(typeof receipt.integrationWorkspace === "string" ? { integrationWorkspace: receipt.integrationWorkspace } : {}), ...(safeGate(receipt.integrationVerification) ? { integrationVerification: safeGate(receipt.integrationVerification) } : {}) };
      } else if (action === "recovery/resume") {
        if (typeof body.recoveryToken !== "string" || body.recoveryToken !== this.state.recovery?.recoveryToken || !this.state.recovery.canResume) throw new Error("Inspect and review recoverable state before resuming");
        const concurrency = this.concurrency(body), recoveryToken = body.recoveryToken;
        delete this.state.recovery;
        this.requiresRecovery = false;
        await this.begin(signal => this.execution!.resume({ project: this.project, concurrency, signal, recoveryToken }));
      } else throw new Error("Unknown launch action");
      await this.save();
      return this.snapshot();
    });
  }
  private concurrency(body: Record<string, unknown>): number {
    const value = body.concurrency ?? 2;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 8) throw new Error("Concurrency must be an integer from 1 to 8");
    return value;
  }
  private async begin(run: (signal: AbortSignal) => Promise<NonNullable<LaunchState["result"]>>): Promise<void> {
    this.state.status = "running"; delete this.state.error; delete this.state.result;
    this.controller = new AbortController();
    if (this.closed) this.controller.abort();
    const intent = this.save();
    this.active = intent.then(() => { this.controller!.signal.throwIfAborted(); return run(this.controller!.signal); }).then(result => {
      this.state.result = result; this.state.status = result.status;
    }).catch(() => { this.state.status = "error"; this.state.error = "Execution failed; inspect the ledger and recovery state."; }).finally(async () => {
      try { await withStorageLock(join(this.project, ".teamsmith/launch"), () => this.save()); }
      catch { this.state.status = "error"; this.state.error = "Execution settled but state persistence failed; inspect recovery."; this.changed(); }
      finally { this.active = undefined; }
    });
    await intent;
  }
  async close(): Promise<void> {
    this.closed = true; this.controller?.abort();
    if (!this.execution) return;
    await withStorageLock(join(this.project, ".teamsmith/launch"), async () => { this.controller?.abort(); });
    await this.active;
  }
}
