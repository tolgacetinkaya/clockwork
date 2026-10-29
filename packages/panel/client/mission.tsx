import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Play, ShieldCheck } from "lucide-react";
import type { LaunchState, PanelSnapshot } from "../src/protocol.js";
import { postJSON } from "./live.js";
import { PageHeading } from "./work.js";
import { planSpec, planIssues, launchReady, recoveryReady, budgetTokens, restoredTasks, workspaceHasExecution } from "./mission-plan.js";
import { IntegrationEvidence } from "./verification-evidence.js";
import type { PlanTask } from "./mission-plan.js";

export function Mission({ snapshot, disabled }: { snapshot: PanelSnapshot; disabled: boolean }) {
  const launch = snapshot.launch;
  const [goal, setGoal] = useState(launch?.draft?.spec.meta.goal ?? "");
  const [tasks, setTasks] = useState<PlanTask[]>(() => launch?.draft ? restoredTasks(launch.draft.spec) : [{ id: "task-1", description: "", owns: "", acceptance: "", dependencies: "", estimate: 10000 }]);
  const [budget, setBudget] = useState(budgetTokens(launch?.draft?.spec.priorities.budget_target ?? 100000));
  const [concurrency, setConcurrency] = useState(2);
  const [gates, setGates] = useState(launch?.draft?.spec.verification?.global_gates?.join("\n") ?? "");
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [recoveryReviewed, setRecoveryReviewed] = useState<string | null>(null);
  const spec = planSpec(goal, tasks, budget, gates);
  const issues = planIssues(spec, concurrency);
  const fingerprint = JSON.stringify(spec);
  const [saved, setSaved] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState<string | null>(null);
  const request = useMutation({ mutationFn: ({ path, body }: { path: string; body: unknown }) => postJSON<LaunchState>(`/api/launch/${path}`, body) });
  const blocked = disabled || !launch?.enabled || launch.status === "running" || request.isPending;
  const edit = (index: number, key: keyof PlanTask, value: string | number) => { setTasks((previous) => previous.map((task, i) => i === index ? { ...task, [key]: value } : task)); setReviewed(null); };
  const act = (path: string, body: unknown) => request.mutateAsync({ path, body });
  const existingExecution = workspaceHasExecution(snapshot);
  const changed = saved !== fingerprint || !savedRevision || savedRevision !== launch?.draft?.revision;
  const readiness = launchReady({ enabled: !!launch?.enabled, disabled: disabled || existingExecution, busy: request.isPending, running: launch?.status === "running", valid: !issues.length, saved: !changed, reviewed: reviewed === fingerprint, approval: !!launch?.approvalToken });
  const resumable = recoveryReady({ enabled: !!launch?.enabled, disabled, busy: request.isPending, running: launch?.status === "running", canResume: !!launch?.recovery?.canResume, token: launch?.recovery?.recoveryToken, reviewed: recoveryReviewed, concurrency });
  return <>
    <PageHeading eyebrow="MISSION CONTROL" title="Give the crew a clear mission." subtitle="Define ownership and evidence, review the plan, then explicitly start local execution." />
    {!launch?.enabled ? <div className="notice-banner" role="status">{launch?.disabledReason ?? "Execution is unavailable in this recorded or read-only panel. Connect a writable local workspace with a configured runner."}</div> : null}
    <div className="mission-layout">
      <section className="surface mission-form">
        <label htmlFor="mission-goal">Mission goal</label><textarea id="mission-goal" rows={3} value={goal} onChange={(event) => { setGoal(event.target.value); setReviewed(null); }} />
        <h2>Task plan</h2><p className="small-muted">One owned scope per task. Independent verification follows each delivery; acceptance alone does not mean integration has passed.</p>
        {tasks.map((task, index) => <fieldset key={index} className="mission-task"><legend>Task {index + 1}</legend>
          {([ ["id", "Task ID"], ["description", "What to deliver"], ["owns", "Owned paths / globs (one per line)"], ["acceptance", "Acceptance evidence (one per line)"], ["dependencies", "Depends on task IDs (comma separated)"] ] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={key === "acceptance" || key === "owns" ? 2 : 1} value={task[key]} onChange={(event) => edit(index, key, event.target.value)} /></label>)}
          <label>Estimated tokens<input type="number" min={1} value={task.estimate} onChange={(event) => edit(index, "estimate", Number(event.target.value))} /></label>
          <button className="quiet-button" disabled={tasks.length === 1} onClick={() => { setTasks((previous) => previous.filter((_, i) => i !== index)); setReviewed(null); }}>Remove task</button>
        </fieldset>)}
        <button className="secondary-button" onClick={() => { setTasks((previous) => [...previous, { id: `task-${previous.length + 1}`, description: "", owns: "", acceptance: "", dependencies: "", estimate: 10000 }]); setReviewed(null); }}><Plus size={14} /> Add task</button>
        <div className="mission-controls"><label>Token budget<input type="number" min={1} value={budget} onChange={(event) => { setBudget(Number(event.target.value)); setReviewed(null); }} /></label><label>Concurrent units<input type="number" min={1} max={8} value={concurrency} onChange={(event) => { setConcurrency(Number(event.target.value)); setReviewed(null); }} /></label></div>
        <label>Global acceptance checks (one per line)<textarea rows={3} value={gates} onChange={(event) => { setGates(event.target.value); setReviewed(null); }} /></label>
        <p className="small-muted">The independent verifier checks these criteria in a read-only integration workspace. Include suitable read-only commands and expected evidence. Tests that require writes are unsupported in this verification environment.</p>
        {issues.length ? <ul className="plan-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        <button className="secondary-button" disabled={blocked || existingExecution || issues.length > 0} onClick={() => { void act("draft", { spec }).then((result) => { setSaved(fingerprint); setSavedRevision(result.draft?.revision ?? null); setReviewed(null); }).catch(() => {}); }}>Save plan for review</button>
      </section>
      <aside className="mission-aside">
        <section className="surface mission-form"><h2>Review & start</h2>{existingExecution ? <p className="notice-banner">This workspace already has an executed mission. Inspect Recovery below for stopped work; use a fresh workspace for a new mission.</p> : null}<p>{tasks.length} tasks · {concurrency} concurrent units · {budget.toLocaleString()} token budget</p>
          <p className="small-muted">Launch uses the committed HEAD. Commit intended source changes and leave the source worktree clean before starting; the service rejects local changes.</p>
          <p className="small-muted">Starting invokes the configured local provider and may consume its quota. No execution begins when saving or reviewing.</p>
          {changed ? <p className="small-muted">Save the current edits before approval.</p> : null}
          <label className="mission-check"><input type="checkbox" checked={reviewed === fingerprint} onChange={(event) => setReviewed(event.target.checked ? fingerprint : null)} /> I reviewed ownership, dependencies, acceptance and combined verification commands.</label>
          <button className="secondary-button" disabled={!readiness.approve} onClick={() => { void act("approve", { revision: launch?.draft?.revision }).catch(() => {}); }}><ShieldCheck size={14} /> {launch?.approvalToken ? "Plan approved" : "Approve reviewed plan"}</button>
          <button className="primary-button" disabled={!readiness.start} onClick={() => { void act("start", { approvalToken: launch?.approvalToken, concurrency }).catch(() => {}); }}><Play size={14} /> Start approved mission</button>
          <p className="small-muted">Runner status: {launch?.status ?? "unavailable"}</p>
        </section>
        <section className="surface mission-form"><h2>Recovery review</h2><p className="small-muted">Inspect preserved work and blockers before resuming a stopped mission.</p>
          <button className="secondary-button" disabled={blocked} onClick={() => { setRecoveryReviewed(null); void act("recovery/inspect", {}).catch(() => {}); }}>Inspect recovery state</button>
          {launch?.recovery ? <><div className="recovery-summary"><h3>Preserved work summary</h3><p>Accepted and integrated task IDs: {launch.recovery.accepted?.join(", ") || "None recorded"}</p><p>Tasks to retry: {launch.recovery.retry?.join(", ") || "None recorded"}</p>{launch.recovery.integrationWorkspace ? <p>Integration workspace <code>{launch.recovery.integrationWorkspace}</code></p> : null}<p>Combined acceptance gate: {launch.recovery.integrationVerification?.status ?? "No result recorded"}</p>{Object.entries(launch.recovery.workspaces ?? {}).map(([unit, workspace]) => <p key={unit}>{unit}: <code>{workspace}</code></p>)}<p className="small-muted">This summary does not show file changes. Inspect these local worktrees and their evidence before confirming resume.</p></div><ul>{launch.recovery.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><label className="mission-check"><input type="checkbox" checked={recoveryReviewed === launch.recovery.recoveryToken} onChange={(event) => setRecoveryReviewed(event.target.checked ? launch.recovery!.recoveryToken : null)} /> I reviewed this inspection summary and separately inspected the preserved work.</label><button className="primary-button" disabled={!resumable} onClick={() => { void act("recovery/resume", { recoveryToken: launch.recovery?.recoveryToken, concurrency }).then(() => setRecoveryReviewed(null)).catch(() => {}); }}>Resume reviewed mission</button></> : null}
        </section>
        <IntegrationEvidence value={launch?.result?.integrationVerification} workspace={launch?.result?.integrationWorkspace} />
        {request.error || launch?.error ? <p role="alert" className="form-error">{request.error?.message ?? launch?.error}</p> : null}
      </aside>
    </div>
  </>;
}
