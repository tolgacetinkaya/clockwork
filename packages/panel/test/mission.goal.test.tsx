import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBudgetReport, reduceLedger } from "@clockwork/core";
import type { PanelSnapshot, LaunchState } from "../src/protocol.js";
import { planSpec } from "../client/mission-plan.js";

// Exercise the component's actual event handlers and fetch boundary without a DOM dependency.
// The hook harness retains local state across streamed-snapshot rerenders.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, mutation: { isPending: false, variables: undefined as { path: string; body: unknown } | undefined, error: null as Error | null } }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index = hooks.cursor++;
  if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
  return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value; }];
} }));
vi.mock("../client/i18n.js", async original => ({ ...await original<typeof import("../client/i18n.js")>(), useI18n: () => ({}) }));
vi.mock("../client/state.js", () => ({ usePanelUI: (selector: (state: unknown) => unknown) => selector({ setView: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useMutation: ({ mutationFn }: { mutationFn: (value: unknown) => Promise<LaunchState> }) => ({
  ...hooks.mutation,
  mutateAsync: async (value: { path: string; body: unknown }) => {
    hooks.mutation.isPending = true; hooks.mutation.variables = value; hooks.mutation.error = null;
    try { return await mutationFn(value); } catch (error) { hooks.mutation.error = error as Error; throw error; }
    finally { hooks.mutation.isPending = false; }
  },
}) }));
import { Mission } from "../client/mission.js";

type Tree = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): Tree[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Tree; return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Tree).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
const task = { id: "docs", description: "Review documentation", owns: "docs/**", acceptance: "References checked", dependencies: "", estimate: 1000 };
const base = planSpec("Audit existing documentation", [task], 20000, "Read all referenced documents", { producer_model: "planner-model", verifier_model: "review-model" });
function initial(): PanelSnapshot {
  const state = reduceLedger([]);
  return { schemaVersion: 1, mode: "workspace", streamId: "goal", revision: 1, updatedAt: "now", state, budget: buildBudgetReport(state), events: [], eventCount: 0, agents: [], spec: null, control: { paused: false, kill: false }, queue: { queued: [], consumedSeq: 0 }, issues: [], launch: { enabled: true, planSupported: true, status: "idle", draft: { revision: "initial", spec: structuredClone(base) } } };
}
let snapshot: PanelSnapshot;
let tree: Tree[];
let reply: LaunchState;
let calls: { path: string; body: any }[];
function render() { hooks.cursor = 0; tree = nodes(Mission({ snapshot, disabled: false })); }
function button(label: string) { const value = tree.find(node => node.type === "button" && text(node.props.children).trim() === label); if (!value) throw new Error(`Missing button ${label}`); return value; }
function field(id: string) { return tree.find(node => node.props.id === id)!; }
function change(id: string, value: string) { field(id).props.onChange({ target: { value } }); render(); }
async function click(label: string) { expect(button(label).props.disabled).toBeFalsy(); button(label).props.onClick(); await new Promise(resolve => setTimeout(resolve, 0)); render(); }
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.mutation = { isPending: false, variables: undefined, error: null };
  snapshot = initial(); reply = snapshot.launch!; calls = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => { calls.push({ path, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify(reply), { status: 200 }); }));
  render();
});

describe("explicit goal planning in the mission form", () => {
  it("calls the planner only on request with goal, constraints, budget and selected models", async () => {
    expect(calls).toEqual([]);
    expect(text(tree)).toContain("consumes quota separately from the task budget below");
    expect(text(tree)).toContain("uses the host\'s planning model");
    change("mission-constraints", "Keep public APIs unchanged");
    reply = { ...snapshot.launch!, planning: { status: "running" } };
    await click("Create task plan from goal");
    expect(calls).toEqual([{ path: "/api/launch/plan", body: { goal: base.meta.goal, constraints: "Keep public APIs unchanged", budget: 20000, execution: base.execution } }]);
    expect(calls.some(call => /approve|start/.test(call.path))).toBe(false);
  });
  it("preserves later edits across completion and adopts only the explicitly selected generated revision", async () => {
    await click("Create task plan from goal");
    change("mission-goal", "My later manual edit");
    const generated = structuredClone(base);
    generated.meta.constraints = ["Do not modify application code\nKeep public APIs unchanged"];
    generated.meta.goal = "Generated documentation audit"; generated.meta.assumptions = ["Existing docs only"]; generated.meta.open_questions = ["Which release?"];
    generated.agents[0]!.purpose = "Check documentation consistency";
    generated.work_units[0]!.type = "research"; generated.work_units[0]!.allowed_test_changes = ["docs/references.test.ts"];
    snapshot = { ...snapshot, launch: { ...snapshot.launch!, draft: { revision: "generated", spec: generated }, planning: { status: "completed", draftRevision: "generated", summary: "Documentation team planned", usage: { input: 10, cached: 2, output: 20 } } } };
    render();
    expect(field("mission-goal").props.value).toBe("My later manual edit");
    expect(text(tree)).toContain("replaces the current form edits");
    await click("Use generated plan");
    expect(field("mission-goal").props.value).toBe(generated.meta.goal);
    expect(field("mission-assumptions").props.value).toBe("Existing docs only");
    expect(field("mission-questions").props.value).toBe("Which release?");
    expect(tree.find(node => node.props["aria-label"] === "Agent purpose: builder-docs")?.props.value).toBe("Check documentation consistency");
    expect(field("mission-constraints").props.value).toBe(generated.meta.constraints[0]);
    expect(button("Approve reviewed plan").props.disabled).toBe(true);
    expect(button("Start approved mission").props.disabled).toBe(true);
    expect(calls).toHaveLength(1);
    reply = snapshot.launch!;
    await click("Save plan for review");
    tree.find(node => node.type === "input" && node.props.type === "checkbox")!.props.onChange({ target: { checked: true } }); render();
    expect(button("Approve reviewed plan").props.disabled).toBe(true);
    expect(button("Start approved mission").props.disabled).toBe(true);
    const saved = calls.at(-1)!.body.spec;
    expect(saved.work_units[0]).toMatchObject({ type: "research", allowed_test_changes: ["docs/references.test.ts"] });
    expect(saved.meta.open_questions).toEqual(["Which release?"]);
    expect(saved.meta.constraints).toEqual(generated.meta.constraints);
    expect(saved.agents[0].purpose).toBe("Check documentation consistency");
    change("mission-goal", "A second local edit"); render();
    expect(field("mission-goal").props.value).toBe("A second local edit");
    expect(tree.some(node => node.type === "button" && text(node.props.children) === "Use generated plan")).toBe(false);
    expect(calls.some(call => /approve|start/.test(call.path))).toBe(false);
    change("mission-questions", "");
    await click("Save plan for review");
    expect(calls.at(-1)!.body.spec.meta.open_questions).toEqual([]);
    tree.find(node => node.type === "input" && node.props.type === "checkbox")!.props.onChange({ target: { checked: true } }); render();
    expect(button("Approve reviewed plan").props.disabled).toBe(false);
    expect(button("Start approved mission").props.disabled).toBe(true);
  });
  it("offers a fresh generated request even when the generated spec hash repeats", async () => {
    snapshot.launch!.planning = { status: "completed", requestId: "plan-1", draftRevision: "initial" }; render();
    await click("Use generated plan");
    change("mission-goal", "Preserve local changes");
    render();
    expect(tree.some(node => node.type === "button" && text(node.props.children) === "Use generated plan")).toBe(false);
    snapshot.launch!.planning = { status: "completed", requestId: "plan-2", draftRevision: "initial" }; render();
    expect(field("mission-goal").props.value).toBe("Preserve local changes");
    expect(button("Use generated plan").props.disabled).toBe(false);
    await click("Use generated plan");
    expect(field("mission-goal").props.value).toBe(base.meta.goal);
    expect(calls).toEqual([]);
  });
  it("rejects stale draft correlation and exposes cancellation while keeping manual edits", async () => {
    snapshot.launch!.planning = { status: "completed", draftRevision: "other" }; render();
    expect(tree.some(node => node.type === "button" && text(node.props.children) === "Use generated plan")).toBe(false);
    snapshot.launch!.planning = { status: "running" }; render();
    expect(button("Create task plan from goal").props.disabled).toBe(true);
    change("mission-goal", "Manual draft stays editable");
    reply = { ...snapshot.launch!, planning: { status: "error", error: "Planning cancelled" } };
    await click("Cancel planning");
    expect(calls.at(-1)).toEqual({ path: "/api/launch/cancel-plan", body: {} });
    snapshot.launch = reply; render();
    expect(field("mission-goal").props.value).toBe("Manual draft stays editable");
    expect(text(tree)).toContain("Planning cancelled");
  });
  it("keeps planner submission disabled for invalid provider model IDs", () => {
    for (const model of ["bad model", "-flag", "x".repeat(201), "bad\u0001id"]) {
      change("mission-producer-model", model);
      expect(button("Create task plan from goal").props.disabled).toBe(true);
    }
    expect(calls).toEqual([]);
  });
  it("disables planning for demo, unsupported, unavailable and executed workspaces", () => {
    for (const patch of [{ mode: "recorded-demo" as const }, { launch: { ...snapshot.launch!, planSupported: false } }, { launch: { ...snapshot.launch!, enabled: false } }, { launch: { ...snapshot.launch!, status: "running" as const } }, { launch: { ...snapshot.launch!, status: "completed" as const } }]) {
      snapshot = { ...initial(), ...patch }; render();
      expect(button("Create task plan from goal").props.disabled).toBe(true);
    }
    expect(calls).toEqual([]);
  });
});
