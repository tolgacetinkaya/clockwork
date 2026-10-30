import { describe, expect, it } from "vitest";
import { reduceLedger } from "../src/ledger/reduce.js";
import { validateEvent } from "../src/ledger/events.js";
import { eventStream, nextEvent, openedRun } from "./ledger.fixtures.js";

describe("explicit user-authorized unit retry replay", () => {
  it("restores failed work and dependency readiness while retaining spent tokens", () => {
    const events = eventStream([...openedRun(),
      ["unit.started", { unit_id: "wu-db" }],
      ["budget.spent", { unit_id: "wu-db", data: { tokens: 43 } }],
      ["unit.failed", { unit_id: "wu-db" }],
      ["unit.retry_requested", { actor: "user", unit_id: "wu-db", data: { reason: "Reviewed the stopped attempt" } }],
    ]);
    const pending = reduceLedger(events);
    expect(pending.units["wu-db"]!.status).toBe("pending");
    expect(pending.units["wu-api"]!.status).toBe("pending");
    expect(pending.units["wu-db"]!.spent).toBe(43);
    expect(pending.totalSpent).toBe(43);
    expect(pending.userInterventionsExecute).toBe(1);
    expect(pending.anomalies).toEqual([]);
    const accepted = reduceLedger([...events,
      nextEvent("unit.started", { unit_id: "wu-db" }),
      nextEvent("unit.verify_started", { unit_id: "wu-db" }),
      nextEvent("unit.accepted", { unit_id: "wu-db" }),
      nextEvent("unit.started", { unit_id: "wu-api" }),
    ]);
    expect(accepted.units["wu-db"]!.status).toBe("accepted");
    expect(accepted.units["wu-api"]!.status).toBe("running");
    expect(accepted.totalSpent).toBe(43);
    expect(accepted.anomalies).toEqual([]);
  });
  it("retries a rejected verification without erasing rework history", () => {
    const state = reduceLedger(eventStream([...openedRun(),
      ["unit.started", { unit_id: "wu-db" }],
      ["unit.verify_started", { unit_id: "wu-db" }],
      ["unit.rework", { unit_id: "wu-db" }],
      ["unit.retry_requested", { actor: "user", unit_id: "wu-db", data: { reason: "Reviewed verifier findings" } }],
    ]));
    expect(state.units["wu-db"]!.status).toBe("pending");
    expect(state.units["wu-db"]!.reworkAttempts).toBe(1);
    expect(state.anomalies).toEqual([]);
  });
  it.each(["orchestrator", "system"] as const)("rejects %s-origin retries in validation and replay", actor => {
    const bad = { actor, unit_id: "wu-db", data: { reason: "Retry automatically" } };
    expect(validateEvent(nextEvent("unit.retry_requested", bad)).event).toBeUndefined();
    const state = reduceLedger(eventStream([...openedRun(),
      ["unit.started", { unit_id: "wu-db" }], ["unit.failed", { unit_id: "wu-db" }],
      ["unit.retry_requested", bad],
    ]));
    expect(state.units["wu-db"]!.status).toBe("failed");
    expect(state.anomalies).toHaveLength(1);
  });
  it("refuses retries of accepted units and requires a review reason", () => {
    expect(validateEvent(nextEvent("unit.retry_requested", { actor: "user", unit_id: "wu-db", data: { reason: " " } })).event).toBeUndefined();
    const state = reduceLedger(eventStream([...openedRun(),
      ["unit.started", { unit_id: "wu-db" }], ["unit.verify_started", { unit_id: "wu-db" }], ["unit.accepted", { unit_id: "wu-db" }],
      ["unit.retry_requested", { actor: "user", unit_id: "wu-db", data: { reason: "Attempt duplicate" } }],
    ]));
    expect(state.units["wu-db"]!.status).toBe("accepted");
    expect(state.anomalies).toHaveLength(1);
  });
});
