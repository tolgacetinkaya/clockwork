import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertStorageFile, atomicWrite, buildPlanningPrompt, modelIdSchema, readLedger, reduceLedger, validatePlanningInput, validatePlanningProposal, validatePlanningReceipt, withStorageLock } from "@clockwork/core";
import type { ExecutionEvent, GoalPlan, GoalPlanningInput, PlanningAdapter, PlanningEvent, PlanningReceipt } from "@clockwork/core";
import type { WorkspaceFingerprint } from "./workspace.js";
import { fingerprint, git } from "./workspace.js";
import { WatchdogError, watchExecution, resolveWatchdogPolicy } from "./watchdog.js";
import type { WatchdogPolicy } from "./watchdog.js";

export interface PlanningUsage { input: number; cached: number; output: number }
export interface GoalPlanResult extends GoalPlan { usage: PlanningUsage; provider: string; model?: string; head: string }
export interface GenerateGoalPlanOptions {
  project: string; input: GoalPlanningInput; adapter: PlanningAdapter; model?: string;
  watchdog?: Partial<WatchdogPolicy>; signal?: AbortSignal;
}
/** A lease cannot be retained after a crashed process; this durable receipt closes that gap. */
export async function assertPlanningSettled(project: string): Promise<void> {
  const path = join(project, ".teamsmith/planning.json");
  await assertStorageFile(path);
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const receipt = validatePlanningReceipt(JSON.parse(raw));
  if (receipt.status === "running" || receipt.unreconciled || receipt.usageUnknown !== false || receipt.workspaceChanged) throw new Error("Planning requires reconciliation of termination, unknown usage, or workspace changes; inspect .teamsmith/planning.json and any retained workspace before retrying or executing");
}
async function assertCanPlan(project: string, ownActivePlan = false): Promise<void> {
  if (!ownActivePlan) await assertPlanningSettled(project);
  const ledger = await readLedger(join(project, ".teamsmith/ledger.jsonl"));
  const state = reduceLedger(ledger.events);
  if (ledger.issues.length || state.anomalies.length || ledger.events.length) throw new Error("Existing run requires inspection or recovery; planning cannot replace execution state");
  try { await readFile(join(project, ".teamsmith/team.json")); throw new Error("Existing team requires inspection or recovery before planning"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if ((await git(project, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).teamsmith")).trim()) throw new Error("Commit or preserve local changes before planning; planning reads committed HEAD");
}
/** Reads a disposable committed snapshot; never approves a specification or launches work.
 * input.budget belongs to the proposed execution. Planning usage is recorded separately.
 */
export async function generateGoalPlan(options: GenerateGoalPlanOptions): Promise<GoalPlanResult> {
  const input = validatePlanningInput(options.input);
  if (options.model !== undefined && (typeof options.model !== "string" || Array.from(options.model).length < modelIdSchema.minLength || Array.from(options.model).length > modelIdSchema.maxLength || !new RegExp(modelIdSchema.pattern, "u").test(options.model))) throw new Error("Invalid planning model identity");
  const policy = resolveWatchdogPolicy({ hard_ms: 300_000, ...options.watchdog });
  return withStorageLock(join(options.project, ".teamsmith/execution"), async () => {
    options.signal?.throwIfAborted();
    await assertCanPlan(options.project);
    const head = await git(options.project, "rev-parse", "HEAD");
    const workspace = await mkdtemp(join(tmpdir(), "clockwork-plan-"));
    let linked = false, closed = false, changed = false;
    let before: WorkspaceFingerprint | undefined;
    let usage: PlanningUsage | undefined, proposal: unknown;
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const receipt: PlanningReceipt = { version: 1, id: randomUUID(), status: "running", head, workspace, provider: options.adapter.id, ...(options.model ? { model: options.model } : {}), usageUnknown: true, unreconciled: true };
    const save = () => atomicWrite(join(options.project, ".teamsmith/planning.json"), JSON.stringify(receipt));
    try {
      await git(options.project, "-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", workspace, head); linked = true;
      before = await fingerprint(workspace);
      await save();
      const source = options.adapter.plan({ workspace, prompt: buildPlanningPrompt(input), ...(options.model ? { model: options.model } : {}), signal: controller.signal });
      // Forward return() to the real iterator. An async-generator wrapper could hide a
      // stuck outstanding next(), making its shutdown impossible to establish.
      const iterator = source[Symbol.asyncIterator]();
      const map = (step: IteratorResult<PlanningEvent>): IteratorResult<ExecutionEvent> => {
        if (step.done) { closed = true; return { done: true, value: undefined }; }
        if (step.value.type !== "plan") return { done: false, value: step.value };
        if (proposal !== undefined) throw new Error("Planner returned multiple proposals");
        proposal = step.value.proposal;
        return { done: false, value: { type: "report", report: { outcome: "completed", summary: "Planning proposal received", evidence: [], findings: [] } } };
      };
      const mapped: AsyncIterable<ExecutionEvent> = { [Symbol.asyncIterator]: () => ({
        next: async () => map(await iterator.next()),
        return: async () => { const step = await iterator.return?.(); if (step?.done) closed = true; return step ? map(step) : { done: false, value: { type: "heartbeat" } }; },
      }) };
      for await (const event of watchExecution(mapped, { signal: options.signal, abort: reason => controller.abort(reason), policy })) {
        if (event.type === "usage") {
          if (usage || ![event.input, event.cached, event.output].every(n => Number.isSafeInteger(n) && n >= 0) || event.cached > event.input || !Number.isSafeInteger(event.input + event.output)) throw new Error("Invalid or repeated planning usage");
          usage = { input: event.input, cached: event.cached, output: event.output };
          receipt.usage = usage; receipt.usageUnknown = false; await save();
        }
      }
      controller.signal.throwIfAborted();
      if (!usage || proposal === undefined) throw new Error("Planner did not return usage and a proposal");
      const after = await fingerprint(workspace);
      changed = before.head !== after.head || before.hash !== after.hash;
      if (changed) throw new Error("Read-only planner changed its workspace; retained for review");
      if (head !== await git(options.project, "rev-parse", "HEAD")) throw new Error("Project HEAD changed during planning; generate again from the current revision");
      await assertCanPlan(options.project, true);
      const plan = validatePlanningProposal(proposal, input);
      receipt.status = "completed"; receipt.unreconciled = false; await save();
      return { ...plan, usage, provider: options.adapter.id, ...(options.model ? { model: options.model } : {}), head };
    } catch (error) {
      receipt.status = "error"; receipt.unreconciled = error instanceof WatchdogError ? error.unreconciled : !closed && linked;
      receipt.error = error instanceof Error ? error.message : "Planning failed";
      if (linked) await save();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (linked && closed && !receipt.unreconciled) {
        try {
          const after = await fingerprint(workspace);
          changed ||= !before || before.head !== after.head || before.hash !== after.hash;
        } catch { changed = true; }
        if (changed) {
          receipt.workspaceChanged = true; receipt.status = "error";
          receipt.error = "Read-only planning workspace changed or cannot be inspected; retained for review";
          await save();
          throw new Error(receipt.error);
        }
      }
      // Never delete a worktree while a planner might still be touching it.
      if (linked && closed && !receipt.unreconciled && !changed) await git(options.project, "worktree", "remove", "--force", workspace);
      else if (!linked) await rmdir(workspace).catch(() => {});
    }
  });
}
