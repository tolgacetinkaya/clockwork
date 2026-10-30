import { describe, expect, it } from "vitest";
import { reduceLedger } from "@clockwork/core";
import type { LedgerEvent } from "@clockwork/core";
import { crewContributions, finalReviewOutcome } from "../client/crew.js";
const event = (seq: number, type: LedgerEvent["type"], agent: string, mode: string) => ({ seq, ts: "2026-10-29T00:00:00.000Z", actor: "orchestrator", type, unit_id: "task", agent_id: agent, data: { mode, execution: mode === "verify" ? "verify-1" : "produce-1" } }) as LedgerEvent;
const events = [event(1, "agent.completed", "producer", "produce"), event(2, "agent.completed", "verifier", "verify"), event(3, "unit.accepted", "verifier", "verify")];
const accepted = { ...reduceLedger([]), units: { task: { status: "accepted" as const, dependsOn: [], reworkAttempts: 0, estimated: 0, spent: 0 } } };
describe("evidence-backed crew contributions", () => {
  it("credits distinct delivery and independent verification once per accepted unit", () => {
    const result = crewContributions({ events: [...events, events[2]!], state: accepted });
    expect(result.get("producer")).toEqual({ deliveries: ["task"], verifications: [] });
    expect(result.get("verifier")).toEqual({ deliveries: [], verifications: ["task"] });
  });
  it("does not reward failed/rework state, missing history or self verification", () => {
    expect(crewContributions({ events, state: { ...accepted, units: { task: { ...accepted.units.task, status: "rework" } } } }).size).toBe(0);
    expect(crewContributions({ events, state: { ...accepted, units: { task: { ...accepted.units.task, status: "failed" } } } }).size).toBe(0);
    expect(crewContributions({ events: events.slice(1), state: accepted }).size).toBe(0);
    expect(crewContributions({ events: events.map((value) => ({ ...value, agent_id: "same" })), state: accepted }).size).toBe(0);
    expect(crewContributions({ events: [events[0]!, event(2, "unit.rework", "verifier", "verify"), ...events.slice(1).map((value) => ({ ...value, seq: value.seq + 2 }))], state: accepted }).size).toBe(0);
  });
});

describe("final review report outcome", () => {
  it("separates accepted evidence from completed sessions requiring rework", () => {
    expect(finalReviewOutcome({ events: [{ ...events[1]!, data: { report: { outcome: "rework" } } }] }, "verifier")).toBe("Review report: needs rework");
    expect(finalReviewOutcome({ events: [{ ...events[1]!, data: { report: { outcome: "accepted" } } }] }, "verifier")).toBe("Review report: accepted");
    expect(finalReviewOutcome({ events: [] }, "verifier")).toBeNull();
  });
});
