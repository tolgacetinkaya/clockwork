import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBudgetReport, LedgerWriter, reduceLedger } from "@clockwork/core";
import type { PanelExecution, PanelSnapshot } from "../src/protocol.js";
import { readPanelData } from "../src/snapshot.js";
import { ExecutionHealth } from "../client/execution-health.js";
import { locales, setLocale, translate } from "../client/i18n.js";
import { watchdogMessages } from "../client/locales/watchdog.js";
import type { Connection } from "../client/state.js";

const executionId = "11111111-1111-4111-8111-111111111111";
const startedAt = "2026-10-30T10:00:00.000Z";
const activityAt = "2026-10-30T10:00:05.000Z";
const heartbeatAt = "2026-10-30T10:01:00.000Z";
const watchdog = { idle_ms: 20_000, expected_ms: 40_000, hard_ms: 120_000, delivery_ms: 30_000 };
function execution(extra: Partial<PanelExecution> = {}): PanelExecution {
  return { execution: executionId, agentId: "builder", unitId: "task", mode: "produce", startedAt, lastActivityAt: activityAt, lastHeartbeatAt: heartbeatAt, status: "running", watchdog, ...extra };
}
function snapshot(tracked?: PanelExecution): PanelSnapshot {
  const state = reduceLedger([]);
  if (tracked) state.executions = { [tracked.execution]: tracked };
  return { schemaVersion: 1, mode: "workspace", streamId: "health-test", revision: 1, updatedAt: heartbeatAt, state, budget: buildBudgetReport(state), events: [], eventCount: 0, agents: [], spec: null, control: { paused: false, kill: false }, queue: { queued: [], consumedSeq: 0 }, issues: [] };
}
function render(value: PanelSnapshot, connection: Connection = "live") {
  return renderToStaticMarkup(createElement(ExecutionHealth, { snapshot: value, connection }));
}
beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("recorded execution monitoring", () => {
  it("keeps historical runs untracked without inventing healthy executions", () => {
    const html = render(snapshot());
    expect(html).toContain("Execution monitoring is unavailable for this run.");
    expect(html).not.toContain("Execution running");
    expect(html).not.toContain("Live ledger updates");
  });
  it("separates real agent activity from execution heartbeats and panel connectivity", () => {
    const html = render(snapshot(execution()));
    expect(html).toContain(`Last agent activity <time dateTime="${activityAt}"`);
    expect(html).toContain(`Last execution heartbeat <time dateTime="${heartbeatAt}"`);
    expect(html).toContain("Live ledger updates");
    expect(html).toContain("Panel connectivity does not measure process liveness.");
    expect(html).not.toContain("warning recorded");
    expect(html).not.toContain("timeout recorded");
  });
  it("marks stale snapshots without fabricating execution failure", () => {
    for (const connection of ["connecting", "reconnecting", "stale"] as const) {
      const html = render(snapshot(execution()), connection);
      expect(html).toContain("Updates unavailable · showing last snapshot");
      expect(html).toContain("Execution running");
      expect(html).not.toContain("Execution failed");
      expect(html).not.toContain("Termination unconfirmed");
    }
  });
  it("marks demos and ended runs as recorded history even with a live panel connection", () => {
    const demo = snapshot(execution());
    demo.mode = "recorded-demo";
    expect(render(demo)).toContain("Recorded execution history");
    expect(render(demo)).not.toContain("Live ledger updates");
    const ended = snapshot(execution({ status: "completed" }));
    ended.state.outcome = "done";
    expect(render(ended)).toContain("Recorded execution history");
    expect(render(ended)).toContain("Execution completed");
  });
  it("shows core-recorded idle and overdue alerts without assigning a failure", () => {
    for (const [alert, label] of [["idle", "Idle warning recorded"], ["overdue", "Expected duration exceeded"]] as const) {
      const html = render(snapshot(execution({ alert })));
      expect(html).toContain(label);
      expect(html).toContain("Execution running");
      expect(html).not.toContain("Execution failed");
    }
  });
  it("distinguishes a failure from unconfirmed execution termination and a pending delivery", () => {
    const failure = render(snapshot(execution({ status: "error", alert: "hard_timeout" })));
    expect(failure).toContain("Execution failed");
    expect(failure).toContain("Execution timeout recorded");
    expect(failure).not.toContain("Termination unconfirmed");
    const pending = execution({ delivery: { id: "delivery-1", receivedSeq: 4, receivedAt: heartbeatAt, outcome: "completed" } });
    const pendingHTML = render(snapshot(pending));
    expect(pendingHTML).toContain("Delivery received · awaiting acknowledgement");
    expect(pendingHTML).not.toContain("Termination unconfirmed");
    const unresolved = render(snapshot(execution({ ...pending, status: "error", executionUnreconciled: true, alert: "delivery_timeout" })));
    expect(unresolved).toContain("Execution failed");
    expect(unresolved).toContain("Termination unconfirmed");
    expect(unresolved).toContain("Delivery reconciliation timeout recorded");
  });
  it("shows acknowledgement as processing without declaring task acceptance", () => {
    const html = render(snapshot(execution({ status: "completed", delivery: { id: "delivery-2", receivedSeq: 4, receivedAt: activityAt, acknowledgedAt: heartbeatAt, outcome: "rework" } })));
    expect(html).toContain("Delivery acknowledged");
    expect(html).toContain("Acknowledgement records processing, not task acceptance.");
    expect(html).toContain("<code>rework</code>");
    expect(html).not.toContain("awaiting acknowledgement");
    expect(html).not.toContain("Task accepted");
  });
  it("registers all translations and preserves placeholder names", () => {
    for (const locale of locales.filter(locale => locale !== "en")) {
      for (const [key, value] of Object.entries(watchdogMessages[locale])) {
        expect(translate(locale, key)).toBe(value);
        expect(value.match(/\{\w+\}/g) ?? []).toEqual(key.match(/\{\w+\}/g) ?? []);
      }
      setLocale(locale);
      const html = render(snapshot(execution({ alert: "idle" })));
      expect(html).toContain(watchdogMessages[locale]["Execution monitoring"]);
      expect(html).not.toContain("Idle warning recorded");
    }
  });
  it("projects tracked activity rather than a later process heartbeat into crew activity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-health-"));
    let now = startedAt;
    const writer = await LedgerWriter.open(join(dir, ".teamsmith", "ledger.jsonl"), { clock: () => new Date(now) });
    try {
      await writer.append("run.started", { data: { run_id: "health-run", ledger_schema_version: 1 } });
      await writer.append("spec.approved", { data: { version: 1, units: [{ id: "task" }] } });
      await writer.append("unit.started", { agent_id: "builder", unit_id: "task" });
      await writer.append("agent.spawned", { agent_id: "builder", unit_id: "task", data: { execution: executionId, mode: "produce", watchdog } });
      now = activityAt;
      await writer.append("agent.activity", { agent_id: "builder", unit_id: "task", data: { execution: executionId, kind: "message", status: "updated" } });
      now = heartbeatAt;
      await writer.append("agent.activity", { agent_id: "builder", unit_id: "task", data: { execution: executionId, kind: "process_heartbeat", status: "updated" } });
      const data = await readPanelData(dir);
      expect(data.issues).toEqual([]);
      expect(data.agents.find(agent => agent.id === "builder")?.lastEventAt).toBe(activityAt);
      expect(data.state.executions?.[executionId]?.lastHeartbeatAt).toBe(heartbeatAt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
