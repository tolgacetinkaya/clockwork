import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LEDGER_SCHEMA_VERSION, validateEvent } from "../src/ledger/events.js";
import type { LedgerEvent } from "../src/ledger/events.js";
import { reduceLedger, validateEventTransition } from "../src/ledger/reduce.js";
import { LedgerWriter, readLedger } from "../src/ledger/store.js";
import { eventStream, openedRun } from "./ledger.fixtures.js";

const execution = "6cb581c5-afb4-460c-9434-848747322884";
const other = "ec3fe3a1-3d6e-478c-ae5d-109af561835d";
const watchdog = { idle_ms: 10, expected_ms: 20, hard_ms: 100, delivery_ms: 10 };
const identity = { agent_id: "worker", unit_id: "wu-db" };
const data = { execution, mode: "produce", watchdog };
function start(): LedgerEvent[] {
  return eventStream([...openedRun(), ["agent.spawned", { ...identity, data }]]);
}
function next(events: LedgerEvent[], type: LedgerEvent["type"], data: Record<string, unknown>, fields: Partial<LedgerEvent> = {}): LedgerEvent {
  return { seq: events.length + 1, ts: new Date(Date.UTC(2026, 0, 1, 12, 1, events.length)).toISOString(), type, actor: "orchestrator", ...identity, data: { execution, ...data }, ...fields };
}
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("durable execution tracking", () => {
  it("keeps schema version and historical projections unchanged", () => {
    const events = eventStream([...openedRun(), ["agent.spawned", { ...identity, data: { execution, mode: "produce" } }], ["agent.activity", { ...identity, data: { execution, kind: "command", status: "completed" } }], ["agent.completed", { ...identity, data: { execution } }]]);
    const state = reduceLedger(events);
    expect(LEDGER_SCHEMA_VERSION).toBe(1);
    expect(state).not.toHaveProperty("executions");
    expect(state.anomalies).toEqual([]);
  });

  it("separates meaningful activity, heartbeat, and watchdog alerts across replay", () => {
    const events = start();
    const activity = next(events, "agent.activity", { kind: "command_execution", status: "completed" }); events.push(activity);
    const heartbeat = next(events, "agent.activity", { kind: "process_heartbeat", status: "updated" }); events.push(heartbeat);
    const alert = next(events, "agent.watchdog", { kind: "idle", elapsed_ms: 30, idle_ms: 10 }); events.push(alert);
    let state = reduceLedger(events);
    expect(state.anomalies).toEqual([]);
    expect(state.executions![execution]).toMatchObject({ execution, agentId: "worker", unitId: "wu-db", mode: "produce", status: "running", watchdog, lastActivityAt: activity.ts, lastHeartbeatAt: heartbeat.ts, alert: "idle" });
    events.push(next(events, "agent.watchdog", { kind: "recovered", elapsed_ms: 31, idle_ms: 0 }));
    state = reduceLedger(events);
    expect(state.executions![execution]).not.toHaveProperty("alert");
    expect(state.executions![execution]!.lastActivityAt).toBe(activity.ts);
    expect(state.executions![execution]!.lastHeartbeatAt).toBe(heartbeat.ts);
  });

  it("keeps the expected deadline warning after meaningful work recovers an idle warning", () => {
    const events = start();
    events.push(next(events, "agent.watchdog", { kind: "idle", elapsed_ms: 10, idle_ms: 10 }));
    events.push(next(events, "agent.watchdog", { kind: "overdue", elapsed_ms: 20, idle_ms: 20 }));
    const activity = next(events, "agent.activity", { kind: "command_execution", status: "completed" }); events.push(activity);
    events.push(next(events, "agent.watchdog", { kind: "recovered", elapsed_ms: 21, idle_ms: 0 }));
    const state = reduceLedger(events);
    expect(state.anomalies).toEqual([]);
    expect(state.executions![execution]).toMatchObject({ alert: "overdue", overdue: true, lastActivityAt: activity.ts });
  });

  it("records receipt separately from acknowledgement and unit acceptance", () => {
    const events = start();
    const receipt = next(events, "agent.delivery_received", { delivery_id: "delivery-1", outcome: "completed" }); events.push(receipt);
    events.push(next(events, "agent.completed", {}));
    let state = reduceLedger(events);
    expect(state.executions![execution]!.status).toBe("completed");
    expect(state.executions![execution]!.delivery).toEqual({ id: "delivery-1", receivedSeq: receipt.seq, receivedAt: receipt.ts, outcome: "completed" });
    const timeout = next(events, "agent.watchdog", { kind: "delivery_timeout", elapsed_ms: 100, idle_ms: 30 }); events.push(timeout);
    const ack = next(events, "agent.delivery_acknowledged", { delivery_id: "delivery-1", received_seq: receipt.seq, outcome: "rejected" }); events.push(ack);
    state = reduceLedger(events);
    expect(state.anomalies).toEqual([]);
    expect(state.executions![execution]!.delivery).toMatchObject({ acknowledgedAt: ack.ts, outcome: "rejected" });
    expect(state.units["wu-db"]!.status).toBe("pending");
    expect(validateEventTransition(state, next(events, "agent.delivery_acknowledged", ack.data!))).not.toEqual([]);
    expect(validateEventTransition(state, next(events, "agent.watchdog", timeout.data!))).not.toEqual([]);
  });

  it("allows hard timeout followed by error and preserves unreconciled execution state", () => {
    const events = start();
    const initial = reduceLedger(events).executions![execution]!.lastActivityAt;
    events.push(next(events, "agent.watchdog", { kind: "hard_timeout", elapsed_ms: 100, idle_ms: 100 }));
    events.push(next(events, "agent.error", { execution_unreconciled: true }));
    const state = reduceLedger(events);
    expect(state.anomalies).toEqual([]);
    expect(state.executions![execution]).toMatchObject({ status: "error", alert: "hard_timeout", executionUnreconciled: true, lastActivityAt: initial });
    expect(validateEventTransition(state, next(events, "agent.delivery_received", { delivery_id: "late", outcome: "completed" }))).not.toEqual([]);
  });

  it("supports integration attempts without a unit", () => {
    const events = eventStream([...openedRun(), ["agent.spawned", { agent_id: "integration", data: { execution, mode: "integration_verify", watchdog } }]]);
    const state = reduceLedger(events);
    expect(state.anomalies).toEqual([]);
    expect(state.executions![execution]).toMatchObject({ agentId: "integration", mode: "integration_verify" });
    expect(state.executions![execution]).not.toHaveProperty("unitId");
  });

  it("rejects mismatched identities, unspawned references, duplicate spawns and invalid acknowledgements without mutation", () => {
    const events = start();
    const state = reduceLedger(events);
    for (const event of [
      next(events, "agent.watchdog", { kind: "idle", elapsed_ms: 10, idle_ms: 10, execution: other }),
      next(events, "agent.watchdog", { kind: "idle", elapsed_ms: 10, idle_ms: 10 }, { agent_id: "impostor" }),
      next(events, "agent.watchdog", { kind: "idle", elapsed_ms: 10, idle_ms: 10 }, { unit_id: "wu-api" }),
      next(events, "agent.spawned", data),
      next(events, "agent.activity", { kind: "command", status: "updated", execution: other }),
      next(events, "agent.completed", {}, { agent_id: "impostor" }),
      next(events, "agent.delivery_acknowledged", { delivery_id: "missing", received_seq: 1, outcome: "accepted" }),
    ]) expect(validateEventTransition(state, event).length).toBeGreaterThan(0);
    const receipt = next(events, "agent.delivery_received", { delivery_id: "delivery-1", outcome: "accepted" }); events.push(receipt);
    const received = reduceLedger(events);
    for (const fields of [{ delivery_id: "other", received_seq: receipt.seq }, { delivery_id: "delivery-1", received_seq: receipt.seq + 1 }]) {
      const event = next(events, "agent.delivery_acknowledged", { ...fields, outcome: "accepted" });
      expect(validateEventTransition(received, event).length).toBeGreaterThan(0);
      expect(reduceLedger([...events, event]).executions).toEqual(received.executions);
    }
  });

  it("requires terminal processing before acknowledgement", () => {
    const events = start();
    const receipt = next(events, "agent.delivery_received", { delivery_id: "delivery-1", outcome: "completed" }); events.push(receipt);
    const ack = next(events, "agent.delivery_acknowledged", { delivery_id: "delivery-1", received_seq: receipt.seq, outcome: "completed" });
    expect(validateEventTransition(reduceLedger(events), ack).some(issue => issue.message.includes("terminal"))).toBe(true);
  });

  it("allows only reasoned user reconciliation of an unreconciled terminal error", () => {
    const events = start();
    const active = next(events, "agent.execution_reconciled", { reason: "Confirmed stopped" }, { actor: "user" });
    expect(validateEventTransition(reduceLedger(events), active).length).toBeGreaterThan(0);
    events.push(next(events, "agent.error", { execution_unreconciled: true, usage_unknown: true }));
    const state = reduceLedger(events);
    for (const event of [
      next(events, "agent.execution_reconciled", { reason: "Confirmed stopped" }),
      next(events, "agent.execution_reconciled", { reason: "   " }, { actor: "user" }),
      next(events, "agent.execution_reconciled", { reason: "Confirmed stopped" }, { actor: "user", agent_id: "other" }),
      next(events, "agent.execution_reconciled", { reason: "Confirmed stopped", execution: other }, { actor: "user" }),
    ]) expect(validateEventTransition(state, event).length).toBeGreaterThan(0);
    const reconciled = next(events, "agent.execution_reconciled", { reason: "Confirmed the child process stopped" }, { actor: "user" }); events.push(reconciled);
    const final = reduceLedger(events);
    expect(final.anomalies).toEqual([]);
    expect(final.executions![execution]).toMatchObject({ status: "error", executionUnreconciled: false });
    expect(final.totalSpent).toBe(state.totalSpent);
    expect(final.executions![execution]!.delivery).toEqual(state.executions![execution]!.delivery);
    expect(validateEventTransition(final, next(events, "agent.execution_reconciled", reconciled.data!, { actor: "user" })).length).toBeGreaterThan(0);
  });

  it("blocks done until executions stop, deliveries are acknowledged and uncertain cleanup is reconciled", () => {
    const events = start();
    const complete = (events: LedgerEvent[]) => {
      const state = reduceLedger(events);
      for (const unit of Object.values(state.units)) unit.status = "accepted";
      return validateEventTransition(state, next(events, "run.completed", { outcome: "done" }, { agent_id: undefined, unit_id: undefined }));
    };
    expect(complete(events).some(issue => issue.message.includes("executions"))).toBe(true);
    const receipt = next(events, "agent.delivery_received", { delivery_id: "delivery-1", outcome: "completed" }); events.push(receipt);
    events.push(next(events, "agent.error", { execution_unreconciled: true }));
    expect(complete(events).some(issue => issue.message.includes("executions"))).toBe(true);
    events.push(next(events, "agent.delivery_acknowledged", { delivery_id: "delivery-1", received_seq: receipt.seq, outcome: "rejected" }));
    expect(complete(events).some(issue => issue.message.includes("executions"))).toBe(true);
    events.push(next(events, "agent.execution_reconciled", { reason: "Child confirmed stopped" }, { actor: "user" }));
    expect(complete(events)).toEqual([]);
    const pending = start();
    const pendingReceipt = next(pending, "agent.delivery_received", { delivery_id: "delivery-2", outcome: "completed" }); pending.push(pendingReceipt);
    pending.push(next(pending, "agent.completed", {}));
    expect(complete(pending).some(issue => issue.message.includes("executions"))).toBe(true);
    pending.push(next(pending, "agent.delivery_acknowledged", { delivery_id: "delivery-2", received_seq: pendingReceipt.seq, outcome: "completed" }));
    expect(complete(pending)).toEqual([]);
  });

  it("validates finite bounded policies, UUIDs, and watchdog payloads", () => {
    const events = start();
    const spawn = events.at(-1)!;
    for (const policy of [{ ...watchdog, idle_ms: 0 }, { ...watchdog, hard_ms: Infinity }, { ...watchdog, delivery_ms: 3_600_001 }, { ...watchdog, idle_ms: 10.5 }, { ...watchdog, expected_ms: 100 }, { idle_ms: 10 }]) {
      expect(validateEvent({ ...spawn, data: { ...data, watchdog: policy } }).issues.length).toBeGreaterThan(0);
    }
    expect(validateEvent({ ...spawn, data: { ...data, execution: "not-a-uuid" } }).issues.length).toBeGreaterThan(0);
    expect(validateEvent(next(events, "agent.watchdog", { kind: "idle", elapsed_ms: NaN, idle_ms: 0 })).issues.length).toBeGreaterThan(0);
    expect(validateEvent(next(events, "agent.watchdog", { kind: "unknown", elapsed_ms: 10, idle_ms: 0 })).issues.length).toBeGreaterThan(0);
  });

  it("persists and replays delivery acknowledgement with append-time duplicate rejection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-tracking-")); paths.push(dir);
    const file = join(dir, "ledger.jsonl");
    const writer = await LedgerWriter.open(file);
    for (const event of start()) await writer.append(event.type, { actor: event.actor, unit_id: event.unit_id, agent_id: event.agent_id, data: event.data });
    const receipt = await writer.append("agent.delivery_received", { ...identity, data: { execution, delivery_id: "delivery-1", outcome: "blocked" } });
    await writer.append("agent.error", { ...identity, data: { execution } });
    const fields = { ...identity, data: { execution, delivery_id: "delivery-1", received_seq: receipt.seq, outcome: "blocked" } };
    await writer.append("agent.delivery_acknowledged", fields);
    await expect(writer.append("agent.delivery_acknowledged", fields)).rejects.toThrow("already acknowledged");
    const ledger = await readLedger(file);
    expect(ledger.issues).toEqual([]);
    const state = reduceLedger(ledger.events);
    expect(state.anomalies).toEqual([]);
    expect(state.executions![execution]!.delivery).toMatchObject({ receivedSeq: receipt.seq, outcome: "blocked", acknowledgedAt: expect.any(String) });
  });
});
