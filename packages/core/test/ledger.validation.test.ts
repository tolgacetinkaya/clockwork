import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { LedgerEvent } from "../src/ledger/events.js";
import { validateEvent } from "../src/ledger/events.js";
import { reduceLedger, validateEventTransition } from "../src/ledger/reduce.js";
import { eventStream, nextEvent, openedRun } from "./ledger.fixtures.js";

describe("ledger admission and safe replay", () => {
  it.each([-1, NaN, Infinity, "12", undefined])("rejects unsafe spend %s", (tokens) => {
    expect(validateEvent(nextEvent("budget.spent", { data: { tokens } })).event).toBeUndefined();
    const state = reduceLedger(eventStream([...openedRun(), ["budget.spent", { data: { tokens } }]]));
    expect(state.totalSpent).toBe(0);
    expect(state.anomalies).toHaveLength(1);
  });
  it.each(["__proto__", "constructor", "toString", " ", "../outside", "a/b", "a\\b", "a:b", "a b", ".", ".."])("rejects unsafe snapshot key %s atomically", (id) => {
    const state = reduceLedger(eventStream([
      ["run.started", { data: { run_id: "run" } }],
      ["spec.approved", { data: { version: 1, units: [{ id: "safe" }, { id }] } }],
    ]));
    expect(Object.keys(state.units)).toEqual([]);
    expect(state.specApproved).toBe(false);
  });
  it("rejects dependent starts and completion while pending, failed or blocked", () => {
    const entries = openedRun();
    const state = reduceLedger(eventStream([...entries,
      ["unit.started", { unit_id: "wu-api" }],
      ["run.completed", { data: { outcome: "done" } }],
      ["unit.started", { unit_id: "wu-db" }],
      ["unit.failed", { unit_id: "wu-db" }],
      ["run.completed", { data: { outcome: "done" } }],
    ]));
    expect(state.units["wu-api"]!.status).toBe("blocked");
    expect(state.outcome).toBeNull();
    expect(state.anomalies).toHaveLength(3);
  });
  it("checks completion gates and leaves the supplied state untouched", () => {
    const state = reduceLedger(eventStream([
      ["run.started", { data: { run_id: "run" } }],
      ["spec.approved", { data: { version: 1, units: [{ id: "u" }] } }],
      ["unit.cancelled", { unit_id: "u" }],
      ["interaction.checkpoint_raised", { data: { ref: "gate" } }],
    ]));
    const before = structuredClone(state);
    expect(validateEventTransition(state, nextEvent("run.completed", { data: { outcome: "done" } }))).toHaveLength(1);
    expect(state).toEqual(before);
  });
  it("accepts final overhead accounting and rejects subsequent unit mutation", () => {
    const state = reduceLedger(eventStream([
      ["run.started", { data: { run_id: "run" } }],
      ["spec.approved", { data: { version: 1, units: [{ id: "u" }] } }],
      ["unit.started", { unit_id: "u" }],
      ["unit.verify_started", { unit_id: "u" }],
      ["unit.accepted", { unit_id: "u" }],
      ["run.completed", { data: { outcome: "done" } }],
      ["budget.spent", { data: { tokens: 4 } }],
      ["unit.started", { unit_id: "u" }],
      ["budget.spent", { unit_id: "u", data: { tokens: 5 } }],
    ]));
    expect(state.outcome).toBe("done");
    expect(state.totalSpent).toBe(4);
    expect(state.anomalies).toHaveLength(2);
  });
  it("rejects cyclic snapshots and mismatched amendments without partial cancellation", () => {
    const state = reduceLedger(eventStream([...openedRun(),
      ["spec.amended", { data: { from_version: 9, to_version: 10, units: [], cancelled: [{ unit: "wu-db" }] } }],
    ]));
    expect(state.specVersion).toBe(1);
    expect(state.units["wu-db"]!.status).toBe("pending");
    expect(validateEvent(nextEvent("spec.approved", { data: { version: 1, units: [
      { id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["a"] },
    ] } })).event).toBeUndefined();
  });
});

describe("historical compatibility and schema gates", () => {
  it("recognizes historical budget checkpoints as blocking gates", () => {
    const state = reduceLedger(eventStream([...openedRun(),
      ["interaction.checkpoint_raised", { data: { ref: "budget", kind: "budget", blocking: true } }],
    ]));
    expect(state.openCheckpoints).toEqual([{ ref: "budget", kind: "gate", blocking: true }]);
    expect(state.anomalies).toEqual([]);
  });
  it("requires the supported explicit schema and a nonempty snapshot", () => {
    expect(validateEvent(nextEvent("run.started", { data: { run_id: "run", ledger_schema_version: 2 } })).event).toBeUndefined();
    expect(validateEvent(nextEvent("run.started", { data: { run_id: "run" } })).event).toBeDefined();
    expect(validateEvent(nextEvent("spec.approved", { data: { version: 1, units: [] } })).event).toBeUndefined();
    expect(validateEvent(nextEvent("spec.amended", { data: { from_version: 1, to_version: 2, units: [] } })).event).toBeUndefined();
  });
  it.each(["accepted", "failed"] as const)("allows explicit amendment withdrawal of %s work", (terminal) => {
    const events = eventStream([...openedRun(),
      ["unit.started", { unit_id: "wu-db" }],
      ...(terminal === "accepted" ? [
        ["unit.verify_started", { unit_id: "wu-db" }],
        ["unit.accepted", { unit_id: "wu-db" }],
      ] as Parameters<typeof eventStream>[0] : [["unit.failed", { unit_id: "wu-db" }]] as Parameters<typeof eventStream>[0]),
      ["spec.amended", { data: { from_version: 1, to_version: 2, units: [{ id: "wu-docs" }],
        cancelled: [{ unit: "wu-db" }, { unit: "wu-api" }, { unit: "wu-front" }] } }],
    ]);
    const state = reduceLedger(events);
    expect(state.units["wu-db"]!.status).toBe("cancelled");
    expect(state.specVersion).toBe(2);
    expect(state.anomalies).toEqual([]);
  });
});

it.each([
  ["gp-1/run-2", 492986], ["gp-1/run-3", 533381],
  ["gp-2/run-1", 165200], ["gp-2/run-2", 146151], ["gp-2/run-3", 146206],
  ["gp-3/run-1", 330418],
])("replays historical bundle %s without changing accounting", (run, spent) => {
  const file = new URL(`./fixtures/historical/${run}/ledger.jsonl`, import.meta.url);
  const events = readFileSync(file, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as LedgerEvent);
  for (const event of events) expect(validateEvent(event).issues).toEqual([]);
  const state = reduceLedger(events);
  expect(state.anomalies).toEqual([]);
  expect(state.outcome).toBe("done");
  expect(state.totalSpent).toBe(spent);
});
