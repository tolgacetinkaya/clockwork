import { t } from "./i18n.js";
import type { PanelSnapshot } from "../src/protocol.js";
import type { Spec } from "../../core/src/spec/types.js";
export interface PlanTask { id: string; description: string; owns: string; acceptance: string; dependencies: string; estimate: number }
export function budgetTokens(value: unknown): number {
  if (typeof value === "number") return value;
  const match = typeof value === "string" ? value.trim().match(/^(\d+(?:\.\d+)?)\s*([km]?)$/i) : null;
  return match ? Number(match[1]) * (match[2]?.toLowerCase() === "m" ? 1000000 : match[2]?.toLowerCase() === "k" ? 1000 : 1) : NaN;
}
export function restoredTasks(spec: Spec): PlanTask[] {
  return spec.work_units.map((unit) => ({ id: unit.id, description: unit.description, owns: unit.owns.join("\n"), acceptance: unit.acceptance.join("\n"), dependencies: unit.depends_on?.join(", ") ?? "", estimate: budgetTokens(unit.budget_est ?? 10000) }));
}
export const lines = (text: string) => text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
export function planSpec(goal: string, tasks: PlanTask[], budget: number, gates: string): Spec {
  return { spec_version: 1, meta: { goal: goal.trim() }, priorities: { bias: "thorough", budget_target: budget },
    agents: tasks.map((task) => ({ id: `builder-${task.id}`, purpose: task.description.trim(), model_tier: "standard" })),
    assignment: Object.fromEntries(tasks.map((task) => [task.id, `builder-${task.id}`])),
    work_units: tasks.map((task) => ({ id: task.id, type: "code", description: task.description.trim(), owns: lines(task.owns), acceptance: lines(task.acceptance), budget_est: task.estimate, depends_on: task.dependencies.split(",").map((id) => id.trim()).filter(Boolean) })),
    verification: { global_gates: lines(gates) },
  };
}
export function planIssues(spec: Spec, concurrency: number): string[] {
  const issues: string[] = [];
  if (!spec.meta.goal) issues.push(t("Describe the mission goal."));
  if (!spec.work_units.length) issues.push(t("Add at least one task."));
  if (!Number.isFinite(Number(spec.priorities.budget_target)) || Number(spec.priorities.budget_target) <= 0) issues.push(t("Set a positive token budget."));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) issues.push(t("Concurrency must be between 1 and 8."));
  if (!spec.verification?.global_gates?.length) issues.push(t("Add a combined verification command."));
  const ids = new Set(spec.work_units.map((unit) => unit.id));
  if (ids.size !== spec.work_units.length) issues.push(t("Task IDs must be unique."));
  for (const unit of spec.work_units) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(unit.id)) issues.push(t("Use letters, numbers, hyphens or underscores for task IDs."));
    if (!Number.isFinite(Number(unit.budget_est)) || Number(unit.budget_est) <= 0) issues.push(t("{task}: add a positive estimated token budget.", { task: unit.id || t("Task") }));
    if (!unit.description || !unit.owns.length || !unit.acceptance.length) issues.push(t("{task}: add description, owned scope and acceptance criteria.", { task: unit.id || t("Task") }));
    if (unit.depends_on?.some((id) => !ids.has(id) || id === unit.id)) issues.push(t("{task}: dependencies must refer to other tasks.", { task: unit.id }));
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (spec.work_units.find((unit) => unit.id === id)?.depends_on?.some(cycle)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (spec.work_units.some((unit) => cycle(unit.id))) issues.push(t("Dependencies must not form a cycle."));
  return [...new Set(issues)];
}

export function launchReady(input: { enabled: boolean; disabled: boolean; busy: boolean; running: boolean; valid: boolean; saved: boolean; reviewed: boolean; approval: boolean }) {
  const available = input.enabled && !input.disabled && !input.busy && !input.running;
  return { approve: available && input.valid && input.saved && input.reviewed && !input.approval, start: available && input.valid && input.saved && input.reviewed && input.approval };
}
export function recoveryReady(input: { enabled: boolean; disabled: boolean; busy: boolean; running: boolean; canResume: boolean; token?: string; reviewed?: string | null; concurrency: number }) {
  return input.enabled && !input.disabled && !input.busy && !input.running && input.canResume && !!input.token && input.reviewed === input.token && Number.isInteger(input.concurrency) && input.concurrency >= 1 && input.concurrency <= 8;
}

export function workspaceHasExecution(snapshot: Pick<PanelSnapshot, "state" | "launch">): boolean {
  return !!snapshot.state.outcome || !!snapshot.launch?.result || snapshot.launch?.status === "completed" || snapshot.launch?.status === "stopped" || Object.values(snapshot.state.units).some((unit) => unit.status !== "pending");
}
