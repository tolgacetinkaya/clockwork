import { t, useI18n } from "./i18n.js";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Play, ShieldCheck } from "lucide-react";
import type { LaunchState, PanelSnapshot } from "../src/protocol.js";
import { number } from "./format.js";
import { postJSON } from "./live.js";
import { PageHeading } from "./work.js";
import { usePanelUI } from "./state.js";
import "./onboarding.css";
import { planSpec, planIssues, launchReady, recoveryReady, budgetTokens, restoredTasks, workspaceHasExecution } from "./mission-plan.js";
import { IntegrationEvidence } from "./verification-evidence.js";
import type { PlanTask } from "./mission-plan.js";

export function Mission({ snapshot, disabled }: { snapshot: PanelSnapshot; disabled: boolean }) {
  useI18n();
  const launch = snapshot.launch;
  const setView = usePanelUI(state => state.setView);
  const [baseSpec] = useState(launch?.draft?.spec);
  const [models, setModels] = useState(() => ({ producer_model: launch?.draft?.spec.execution?.producer_model ?? "", verifier_model: launch?.draft?.spec.execution?.verifier_model ?? "", integration_verifier_model: launch?.draft?.spec.execution?.integration_verifier_model ?? "" }));
  const [goal, setGoal] = useState(launch?.draft?.spec.meta.goal ?? "");
  const [tasks, setTasks] = useState<PlanTask[]>(() => launch?.draft ? restoredTasks(launch.draft.spec) : [{ id: "task-1", description: "", owns: "", acceptance: "", dependencies: "", estimate: 10000 }]);
  const [budget, setBudget] = useState(budgetTokens(launch?.draft?.spec.priorities.budget_target ?? 100000));
  const [concurrency, setConcurrency] = useState(2);
  const [gates, setGates] = useState(launch?.draft?.spec.verification?.global_gates?.join("\n") ?? "");
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [recoveryReviewed, setRecoveryReviewed] = useState<string | null>(null);
  const spec = planSpec(goal, tasks, budget, gates, models, baseSpec);
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
  return <div className="workflow-mission">
    <PageHeading eyebrow={t("MISSION CONTROL")} title={t("Give the crew a clear mission.")} subtitle={t("Define ownership and evidence, review the plan, then explicitly start local execution.")} />
    {snapshot.mode === "recorded-demo" ? <div className="notice-banner" role="status"><p>{t("You are viewing a recorded demo. No agents will start here.")}</p><button className="secondary-button" onClick={() => setView("start")}>{t("Connect a workspace first")}</button>{launch?.disabledReason ? <details className="mission-notes"><summary>{t("Execution details")}</summary><p>{launch.disabledReason}</p></details> : null}</div> : !launch?.enabled ? <div className="notice-banner" role="status">{launch?.disabledReason ?? t("Execution is unavailable in this recorded or read-only panel. Connect a writable local workspace with a configured runner.")}</div> : null}
    <div className="mission-layout">
      <section className="surface mission-form"><fieldset className="mission-editor" disabled={snapshot.mode === "recorded-demo"}><section className="mission-step"><h2 className="mission-section-title">{t("1. Goal")}</h2><p className="mission-short-help">{t("Planning is manual: write a goal, then add tasks, owned files, dependencies and acceptance evidence.")}</p>
        <label htmlFor="mission-goal">{t("Mission goal")}</label><textarea id="mission-goal" rows={3} value={goal} onChange={(event) => { setGoal(event.target.value); setReviewed(null); }} />
        </section><section className="mission-step"><h2 className="mission-section-title">{t("2. Tasks and evidence")}</h2><p className="small-muted">{t("One owned scope per task. Independent verification follows each delivery; acceptance alone does not mean integration has passed.")}</p>
        {tasks.map((task, index) => <fieldset key={index} className="mission-task"><legend>{t("Task {count}", { count: index + 1 })}</legend>
          {([ ["description", t("What to deliver")], ["owns", t("Owned paths / globs (one per line)")], ["acceptance", t("Acceptance evidence (one per line)")] ] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={key === "acceptance" || key === "owns" ? 2 : 1} value={task[key]} onChange={(event) => edit(index, key, event.target.value)} /></label>)}
          <details className="mission-task-details"><summary>{t("Task setup")}</summary><label>{t("Task ID")}<input value={task.id} onChange={(event) => edit(index, "id", event.target.value)} /></label><label>{t("Depends on task IDs (comma separated)")}<input value={task.dependencies} onChange={(event) => edit(index, "dependencies", event.target.value)} /></label><label>{t("Estimated tokens")}<input type="number" min={1} value={task.estimate} onChange={(event) => edit(index, "estimate", Number(event.target.value))} /></label></details>
          <button className="quiet-button" disabled={tasks.length === 1} onClick={() => { setTasks((previous) => previous.filter((_, i) => i !== index)); setReviewed(null); }}>{t("Remove task")}</button>
        </fieldset>)}
        <button className="secondary-button" onClick={() => { setTasks((previous) => [...previous, { id: `task-${previous.length + 1}`, description: "", owns: "", acceptance: "", dependencies: "", estimate: 10000 }]); setReviewed(null); }}><Plus size={14} />{t("Add task")}</button>
        </section><section className="mission-step"><h2 className="mission-section-title">{t("3. Budget and final checks")}</h2><div className="mission-controls"><label>{t("Token budget")}<input type="number" min={1} value={budget} onChange={(event) => { setBudget(Number(event.target.value)); setReviewed(null); }} /></label><label>{t("Concurrent units")}<input type="number" min={1} max={8} value={concurrency} onChange={(event) => { setConcurrency(Number(event.target.value)); setReviewed(null); }} /></label></div>
        <h3>{t("Execution models")}</h3><p id="mission-model-help" className="small-muted">{t("Use model IDs supported by the configured provider. Empty fields use host / CLI defaults; an empty final-review field follows the resolved verifier.")}</p>
        <div className="mission-controls"><label htmlFor="mission-producer-model">{t("Producer model (optional)")}<input id="mission-producer-model" aria-describedby="mission-model-help mission-model-sessions" value={models.producer_model} className="mission-model-input" onChange={(event) => { setModels(previous => ({ ...previous, producer_model: event.target.value })); setReviewed(null); }} /></label><label htmlFor="mission-verifier-model">{t("Independent verifier model (optional)")}<input id="mission-verifier-model" aria-describedby="mission-model-help mission-model-sessions" value={models.verifier_model} className="mission-model-input" onChange={(event) => { setModels(previous => ({ ...previous, verifier_model: event.target.value })); setReviewed(null); }} /></label></div>
        <details className="mission-notes"><summary>{t("Final review model override")}</summary><label htmlFor="mission-integration-model">{t("Final review model (optional)")}<input id="mission-integration-model" aria-describedby="mission-model-help mission-model-sessions" value={models.integration_verifier_model} className="mission-model-input" onChange={(event) => { setModels(previous => ({ ...previous, integration_verifier_model: event.target.value })); setReviewed(null); }} /></label></details>
        <p id="mission-model-sessions" className="small-muted">{t("Production and verification use separate sessions, even with the same model. Choosing different models alone does not guarantee independent judgment.")}</p>
        <label>{t("Global acceptance checks (one per line)")}<textarea rows={3} value={gates} onChange={(event) => { setGates(event.target.value); setReviewed(null); }} /></label>
        <details className="mission-notes"><summary>{t("Execution details")}</summary><p className="small-muted">{t("The independent verifier checks these criteria in a read-only integration workspace. Include suitable read-only commands and expected evidence. Tests that require writes are unsupported in this verification environment.")}</p></details></section><section className="mission-step"><h2 className="mission-section-title">{t("4. Save your plan")}</h2>
        {issues.length ? <ul className="plan-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
        <button className="secondary-button" disabled={blocked || existingExecution || issues.length > 0} onClick={() => { void act("draft", { spec }).then((result) => { setSaved(fingerprint); setSavedRevision(result.draft?.revision ?? null); setReviewed(null); }).catch(() => {}); }}>{t("Save plan for review")}</button></section></fieldset>
      </section>
      <aside className="mission-aside">
        <section className="surface mission-form"><h2 className="mission-section-title">{t("5. Review and launch")}</h2><p className="mission-primary-help">{t("Saving does not run agents. Review the plan, approve it, then start explicitly.")}</p>{existingExecution ? <p className="notice-banner">{t("This workspace already has an executed mission. Inspect Recovery below for stopped work; use a fresh workspace for a new mission.")}</p> : null}<p>{t("{count} tasks · {concurrency} concurrent units · {budget} token budget", { count: tasks.length, concurrency, budget: number(budget) })}</p>
          <dl className="mission-model-review"><dt>{t("Producer model (optional)")}</dt><dd>{spec.execution?.producer_model ?? t("Host / CLI default")}</dd><dt>{t("Independent verifier model (optional)")}</dt><dd>{spec.execution?.verifier_model ?? t("Host / CLI default")}</dd><dt>{t("Final review model (optional)")}</dt><dd>{spec.execution?.integration_verifier_model ?? t("Follows resolved verifier")}</dd></dl>
          <details className="mission-notes"><summary>{t("Execution details")}</summary><p className="small-muted">{t("Launch uses the committed HEAD. Commit intended source changes and leave the source worktree clean before starting; the service rejects local changes.")}</p>
          <p className="small-muted">{t("Starting invokes the configured local provider and may consume its quota. No execution begins when saving or reviewing.")}</p></details>
          {changed ? <p className="small-muted">{t("Save the current edits before approval.")}</p> : null}
          <label className="mission-check"><input type="checkbox" checked={reviewed === fingerprint} onChange={(event) => setReviewed(event.target.checked ? fingerprint : null)} />{t("I reviewed ownership, dependencies, acceptance and combined verification commands.")}</label>
          <button className="secondary-button" disabled={!readiness.approve} onClick={() => { void act("approve", { revision: launch?.draft?.revision }).catch(() => {}); }}><ShieldCheck size={14} /> {launch?.approvalToken ? t("Plan approved") : t("Approve reviewed plan")}</button>
          <button className="primary-button" disabled={!readiness.start} onClick={() => { void act("start", { approvalToken: launch?.approvalToken, concurrency }).catch(() => {}); }}><Play size={14} />{t("Start approved mission")}</button>
          <p className="small-muted">{t("Runner status: {status}", { status: t(launch?.status ?? "unavailable") })}</p>
        </section>
        <details className="surface mission-form workflow-recovery" open={launch?.recovery ? true : undefined}><summary>{t("Recovery review")}</summary><p className="small-muted">{t("Inspect preserved work and blockers before resuming a stopped mission.")}</p>
          <button className="secondary-button" disabled={blocked} onClick={() => { setRecoveryReviewed(null); void act("recovery/inspect", {}).catch(() => {}); }}>{t("Inspect recovery state")}</button>
          {launch?.recovery ? <><div className="recovery-summary"><h3>{t("Preserved work summary")}</h3><p>{t("Accepted and integrated task IDs:")}{" "}{launch.recovery.accepted?.join(", ") || t("None recorded")}</p><p>{t("Tasks to retry:")}{" "}{launch.recovery.retry?.join(", ") || t("None recorded")}</p>{launch.recovery.integrationWorkspace ? <p>{t("Integration workspace")}{" "}<code>{launch.recovery.integrationWorkspace}</code></p> : null}<p>{t("Combined acceptance gate:")}{" "}{launch.recovery.integrationVerification?.status ? t(launch.recovery.integrationVerification.status) : t("No result recorded")}</p>{Object.entries(launch.recovery.workspaces ?? {}).map(([unit, workspace]) => <p key={unit}>{unit}: <code>{workspace}</code></p>)}<p className="small-muted">{t("This summary does not show file changes. Inspect these local worktrees and their evidence before confirming resume.")}</p></div><ul>{launch.recovery.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><label className="mission-check"><input type="checkbox" checked={recoveryReviewed === launch.recovery.recoveryToken} onChange={(event) => setRecoveryReviewed(event.target.checked ? launch.recovery!.recoveryToken : null)} />{t("I reviewed this inspection summary and separately inspected the preserved work.")}</label><button className="primary-button" disabled={!resumable} onClick={() => { void act("recovery/resume", { recoveryToken: launch.recovery?.recoveryToken, concurrency }).then(() => setRecoveryReviewed(null)).catch(() => {}); }}>{t("Resume reviewed mission")}</button></> : null}
        </details>
        <IntegrationEvidence value={launch?.result?.integrationVerification} workspace={launch?.result?.integrationWorkspace} />
        {request.error || launch?.error ? <p role="alert" className="form-error">{request.error?.message ?? launch?.error}</p> : null}
      </aside>
    </div>
  </div>;
}
