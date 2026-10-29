import type { EventType, LedgerEvent } from "../src/ledger/events.js";

let counter = 0;

/** Builds an event list with auto seq/ts; each call starts a fresh sequence. */
export function eventStream(
  entries: Array<[EventType, Partial<Omit<LedgerEvent, "seq" | "type">>?]>,
): LedgerEvent[] {
  counter = 0;
  return entries.map(([type, fields]) => nextEvent(type, fields));
}

export function nextEvent(
  type: EventType,
  fields: Partial<Omit<LedgerEvent, "seq" | "type">> = {},
): LedgerEvent {
  counter += 1;
  return {
    seq: counter,
    ts: new Date(Date.UTC(2026, 0, 1, 12, 0, counter)).toISOString(),
    type,
    actor: "orchestrator",
    ...fields,
  };
}

/** Standard opening: run.started + approved spec with a small unit graph. */
export function openedRun(): Array<[EventType, Partial<Omit<LedgerEvent, "seq" | "type">>?]> {
  return [
    ["run.started", { data: { run_id: "run-1", teamsmith_version: "0.1.0", ledger_schema_version: 1 } }],
    ["run.phase_entered", { data: { phase: "execute" } }],
    [
      "spec.approved",
      {
        data: {
          version: 1,
          units: [
            { id: "wu-db" },
            { id: "wu-api", depends_on: ["wu-db"] },
            { id: "wu-front", depends_on: ["wu-api"] },
            { id: "wu-docs" },
          ],
        },
      },
    ],
  ];
}
