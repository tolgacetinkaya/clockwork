import { describe, expect, it } from "vitest";
import { reduceLedger } from "../src/ledger/reduce.js";
import { eventStream, openedRun } from "./ledger.fixtures.js";

describe("reduceLedger — run and spec", () => {
  it("derives run identity, phase, and spec approval", () => {
    const state = reduceLedger(eventStream(openedRun()));
    expect(state.runId).toBe("run-1");
    expect(state.teamsmithVersion).toBe("0.1.0");
    expect(state.ledgerSchemaVersion).toBe(1);
    expect(state.phase).toBe("execute");
    expect(state.specVersion).toBe(1);
    expect(state.specApproved).toBe(true);
    expect(Object.keys(state.units)).toEqual(["wu-db", "wu-api", "wu-front", "wu-docs"]);
    expect(state.units["wu-db"]!.status).toBe("pending");
  });

  it("flags a duplicate run.started and unknown phases", () => {
    const state = reduceLedger(
      eventStream([
        ["run.started", { data: { run_id: "run-1" } }],
        ["run.started", { data: { run_id: "run-2" } }],
        ["run.phase_entered", { data: { phase: "shipping" } }],
      ]),
    );
    expect(state.runId).toBe("run-1");
    expect(state.anomalies.some((a) => a.includes("duplicate run.started"))).toBe(true);
    expect(state.anomalies.some((a) => a.includes('unknown phase "shipping"'))).toBe(true);
  });

  it("tracks pause/resume and abandonment", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["run.paused", { actor: "user" }],
        ["run.resumed"],
        ["run.completed", { data: { outcome: "abandoned" } }],
      ]),
    );
    expect(state.paused).toBe(false);
    expect(state.outcome).toBe("abandoned");
  });
});

describe("reduceLedger — unit mini state machine", () => {
  it("walks the happy path: pending → running → verifying → accepted", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["unit.started", { unit_id: "wu-db", agent_id: "backend-builder" }],
        ["unit.verify_started", { unit_id: "wu-db" }],
        ["unit.accepted", { unit_id: "wu-db" }],
      ]),
    );
    const unit = state.units["wu-db"]!;
    expect(unit.status).toBe("accepted");
    expect(unit.agent).toBe("backend-builder");
    expect(state.anomalies).toEqual([]);
  });

  it("counts rework cycles through the loop", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["unit.started", { unit_id: "wu-db" }],
        ["unit.verify_started", { unit_id: "wu-db" }],
        ["unit.rework", { unit_id: "wu-db" }],
        ["unit.started", { unit_id: "wu-db" }],
        ["unit.verify_started", { unit_id: "wu-db" }],
        ["unit.rework", { unit_id: "wu-db" }],
        ["unit.started", { unit_id: "wu-db" }],
        ["unit.verify_started", { unit_id: "wu-db" }],
        ["unit.accepted", { unit_id: "wu-db" }],
      ]),
    );
    expect(state.units["wu-db"]!.reworkAttempts).toBe(2);
    expect(state.units["wu-db"]!.status).toBe("accepted");
    expect(state.anomalies).toEqual([]);
  });

  it("rejects illegal transitions without applying them", () => {
    const state = reduceLedger(
      eventStream([...openedRun(), ["unit.accepted", { unit_id: "wu-db" }]]),
    );
    expect(state.units["wu-db"]!.status).toBe("pending");
    expect(state.anomalies.some((a) => a.includes("unit.accepted") && a.includes("pending"))).toBe(true);
  });

  it("flags unit events for unknown units", () => {
    const state = reduceLedger(
      eventStream([...openedRun(), ["unit.started", { unit_id: "wu-ghost" }]]),
    );
    expect(state.anomalies.some((a) => a.includes("wu-ghost"))).toBe(true);
  });

  it("records the escalation ladder's highest step", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["escalation.step", { unit_id: "wu-db", data: { step: 2 } }],
        ["escalation.step", { unit_id: "wu-db", data: { step: 1 } }],
      ]),
    );
    expect(state.units["wu-db"]!.escalationStep).toBe(2);
  });
});

describe("reduceLedger — blocked derivation (deadlock)", () => {
  it("derives blocked for transitive dependents of a failed unit", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["unit.started", { unit_id: "wu-db" }],
        ["unit.failed", { unit_id: "wu-db", data: { reason: "escalation exhausted" } }],
      ]),
    );
    expect(state.units["wu-api"]!.status).toBe("blocked");
    expect(state.units["wu-api"]!.blockedBy).toEqual(["wu-db"]);
    expect(state.units["wu-front"]!.status).toBe("blocked");
    expect(state.units["wu-front"]!.blockedBy).toEqual(["wu-db"]);
    // The independent unit is untouched.
    expect(state.units["wu-docs"]!.status).toBe("pending");
  });

  it("does not block dependents of healthy units", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["unit.started", { unit_id: "wu-db" }],
        ["unit.verify_started", { unit_id: "wu-db" }],
        ["unit.accepted", { unit_id: "wu-db" }],
      ]),
    );
    expect(state.units["wu-api"]!.status).toBe("pending");
  });
});

describe("reduceLedger — amendment effects", () => {
  it("applies cancellations with sunk budgets and registers new units", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["unit.started", { unit_id: "wu-db" }],
        ["unit.verify_started", { unit_id: "wu-db" }],
        ["unit.accepted", { unit_id: "wu-db" }],
        ["unit.started", { unit_id: "wu-api" }],
        ["unit.verify_started", { unit_id: "wu-api" }],
        ["unit.accepted", { unit_id: "wu-api" }],
        ["unit.started", { unit_id: "wu-front" }],
        ["budget.spent", { unit_id: "wu-front", data: { tokens: 7000 } }],
        [
          "spec.amended",
          {
            data: {
              from_version: 1,
              to_version: 2,
              initiated_by: "user",
              reason: "drop frontend, add analytics",
              units: [
                { id: "wu-db" },
                { id: "wu-api", depends_on: ["wu-db"] },
                { id: "wu-docs" },
                { id: "wu-analytics", depends_on: ["wu-db"] },
              ],
              cancelled: [{ unit: "wu-front", reason: "explicit", sunk_budget: 7000 }],
            },
          },
        ],
      ]),
    );
    expect(state.specVersion).toBe(2);
    expect(state.units["wu-front"]!.status).toBe("cancelled");
    expect(state.units["wu-front"]!.sunkBudget).toBe(7000);
    expect(state.units["wu-analytics"]!.status).toBe("pending");
    expect(state.units["wu-analytics"]!.dependsOn).toEqual(["wu-db"]);
    expect(state.anomalies).toEqual([]);
  });
});

describe("reduceLedger — budget and interaction", () => {
  it("accumulates spend per unit and in total", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["budget.estimated", { unit_id: "wu-db", data: { tokens: 40000 } }],
        ["unit.started", { unit_id: "wu-db" }],
        ["budget.spent", { unit_id: "wu-db", data: { tokens: 12000 } }],
        ["budget.spent", { unit_id: "wu-db", data: { tokens: 5000 } }],
        ["budget.spent", { data: { tokens: 3000 } }],
      ]),
    );
    expect(state.units["wu-db"]!.estimated).toBe(40000);
    expect(state.units["wu-db"]!.spent).toBe(17000);
    expect(state.totalSpent).toBe(20000);
  });

  it("tracks open checkpoints and pending questions", () => {
    const state = reduceLedger(
      eventStream([
        ...openedRun(),
        ["interaction.questions_batched", { data: { questions: ["License?", "DB name?"] } }],
        ["interaction.checkpoint_raised", { data: { ref: "gate-deploy", kind: "gate", blocking: true } }],
        ["interaction.checkpoint_raised", { data: { ref: "ms-backend", kind: "milestone", blocking: false } }],
        ["interaction.checkpoint_resolved", { data: { ref: "gate-deploy" } }],
        ["interaction.answers_received"],
      ]),
    );
    expect(state.pendingQuestions).toEqual([]);
    expect(state.openCheckpoints).toEqual([{ ref: "ms-backend", kind: "milestone", blocking: false }]);
  });

  it("flags resolving an unknown checkpoint", () => {
    const state = reduceLedger(
      eventStream([...openedRun(), ["interaction.checkpoint_resolved", { data: { ref: "nope" } }]]),
    );
    expect(state.anomalies.some((a) => a.includes('"nope"'))).toBe(true);
  });
});

describe("reduceLedger — intervention scoping", () => {
  it("separates execute-phase interventions from run-wide protocol events", () => {
    const state = reduceLedger(
      eventStream([
        ["run.started", { data: { run_id: "run-1" } }],
        ["run.phase_entered", { data: { phase: "clarify" } }],
        ["interaction.answers_received", { actor: "user" }], // protocol, pre-execute
        [
          "spec.approved",
          { actor: "user", data: { version: 1, units: [{ id: "wu-a" }] } },
        ], // protocol, pre-execute
        ["run.phase_entered", { data: { phase: "execute" } }],
        ["interaction.checkpoint_raised", { data: { ref: "g1", kind: "gate" } }],
        ["interaction.checkpoint_resolved", { actor: "user", data: { ref: "g1" } }], // real intervention
      ]),
    );
    expect(state.userInterventions).toBe(3);
    expect(state.userInterventionsExecute).toBe(1);
  });
});

describe("reduceLedger — recomputability", () => {
  it("is deterministic: same events, same state", () => {
    const events = eventStream([
      ...openedRun(),
      ["unit.started", { unit_id: "wu-db" }],
      ["budget.spent", { unit_id: "wu-db", data: { tokens: 100 } }],
      ["unit.verify_started", { unit_id: "wu-db" }],
      ["unit.accepted", { unit_id: "wu-db" }],
    ]);
    expect(reduceLedger(events)).toEqual(reduceLedger(structuredClone(events)));
  });

  it("does not mutate its input", () => {
    const events = eventStream([...openedRun(), ["unit.started", { unit_id: "wu-db" }]]);
    const snapshot = structuredClone(events);
    reduceLedger(events);
    expect(events).toEqual(snapshot);
  });
});
