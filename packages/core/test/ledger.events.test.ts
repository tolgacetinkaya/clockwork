import { describe, expect, it } from "vitest";
import { EVENT_TYPES, isEventType, validateEvent } from "../src/ledger/events.js";
import { nextEvent } from "./ledger.fixtures.js";

describe("event dictionary", () => {
  it("is closed: unknown types are rejected", () => {
    expect(isEventType("unit.started")).toBe(true);
    expect(isEventType("unit.finished")).toBe(false);
    expect(isEventType("")).toBe(false);
  });

  it("groups every type into a known family", () => {
    const families = new Set(["run", "spec", "unit", "agent", "interaction", "budget", "escalation"]);
    for (const type of EVENT_TYPES) {
      expect(families.has(type.split(".")[0]!)).toBe(true);
    }
  });
});

describe("validateEvent", () => {
  it("accepts a well-formed event", () => {
    const { event, issues } = validateEvent(nextEvent("unit.started", { unit_id: "wu-db" }));
    expect(issues).toEqual([]);
    expect(event).toBeDefined();
  });

  it("rejects unknown event types with a dedicated code", () => {
    const bad = { ...nextEvent("unit.started"), type: "unit.exploded" };
    const { event, issues } = validateEvent(bad);
    expect(event).toBeUndefined();
    expect(issues.map((i) => i.code)).toContain("unknown-event-type");
  });

  it("rejects envelope violations", () => {
    expect(validateEvent(null).issues.length).toBeGreaterThan(0);
    expect(validateEvent({ seq: 0, ts: "x", type: "run.started", actor: "orchestrator" }).issues.length)
      .toBeGreaterThan(0);
    const badActor = { ...nextEvent("run.started"), actor: "agent" };
    expect(validateEvent(badActor).issues.map((i) => i.code)).toContain("event-envelope");
    const badData = { ...nextEvent("run.started"), data: [1, 2] };
    expect(validateEvent(badData).issues.map((i) => i.code)).toContain("event-envelope");
  });
});
