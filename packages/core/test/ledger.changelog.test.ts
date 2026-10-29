import { describe, expect, it } from "vitest";
import { renderChangelog } from "../src/ledger/changelog.js";
import { eventStream, openedRun } from "./ledger.fixtures.js";

describe("renderChangelog", () => {
  it("renders a readable projection of the run", () => {
    const events = eventStream([
      ...openedRun(),
      ["unit.started", { unit_id: "wu-db", agent_id: "backend-builder" }],
      ["budget.spent", { unit_id: "wu-db", data: { tokens: 5000 } }],
      ["unit.verify_started", { unit_id: "wu-db" }],
      ["unit.rework", { unit_id: "wu-db" }],
      ["unit.started", { unit_id: "wu-db" }],
      ["unit.verify_started", { unit_id: "wu-db" }],
      ["unit.accepted", { unit_id: "wu-db" }],
      ["run.completed", { data: { outcome: "done" } }],
    ]);

    const md = renderChangelog(events);
    expect(md).toContain("# Changelog");
    expect(md).toContain("## 2026-01-01");
    expect(md).toContain("Run `run-1` started (clockwork 0.1.0).");
    expect(md).toContain("Entered phase **execute**.");
    expect(md).toContain("Spec v1 approved.");
    expect(md).toContain("`wu-db` started (agent `backend-builder`).");
    expect(md).toContain("`wu-db` sent back for rework.");
    expect(md).toContain("`wu-db` accepted.");
    expect(md).toContain("Run completed: **done**.");
    // Bookkeeping noise stays out of the human view.
    expect(md).not.toContain("budget.spent");
    expect(md).not.toContain("5000");
  });

  it("renders amendments with direction and reason", () => {
    const events = eventStream([
      ...openedRun(),
      [
        "spec.amended",
        {
          data: {
            from_version: 1,
            to_version: 2,
            initiated_by: "system",
            reason: "budget deviation on wu-api",
            units: [{ id: "wu-db" }],
            cancelled: [],
          },
        },
      ],
    ]);
    const md = renderChangelog(events);
    expect(md).toContain("Spec amended v1 → v2 (system): budget deviation on wu-api");
  });

  it("produces a valid empty document for no events", () => {
    expect(renderChangelog([])).toBe("# Changelog\n\n");
  });
});
