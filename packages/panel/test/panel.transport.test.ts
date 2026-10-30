import { describe, expect, it } from "vitest";
import { reduceLedger, buildBudgetReport } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import { newerSnapshot, parseSnapshot } from "../client/transport.js";
const state = reduceLedger([]);
const initial: PanelSnapshot = {
  schemaVersion: 1,
  mode: "workspace",
  streamId: "server-a",
  revision: 8,
  updatedAt: new Date(0).toISOString(),
  state,
  budget: buildBudgetReport(state),
  events: [],
  eventCount: 0,
  agents: [],
  spec: null,
  control: { paused: false, kill: false },
  queue: { queued: [], consumedSeq: 0 },
  issues: [],
};
describe("browser snapshot admission", () => {
  it("ignores repeated and out-of-order snapshots within one server epoch", () => {
    expect(newerSnapshot(initial, { ...initial })).toBe(initial);
    expect(newerSnapshot(initial, { ...initial, revision: 7 })).toBe(initial);
    expect(newerSnapshot(initial, { ...initial, revision: 9 }).revision).toBe(
      9,
    );
  });
  it("accepts a new server epoch even when its revision starts over", () => {
    expect(
      newerSnapshot(initial, { ...initial, streamId: "server-b", revision: 1 }),
    ).toMatchObject({ streamId: "server-b", revision: 1 });
  });
  it("validates the transport schema before replacing the cache", () => {
    expect(parseSnapshot(JSON.stringify(initial))).toEqual(initial);
    expect(() =>
      parseSnapshot(JSON.stringify({ ...initial, schemaVersion: 2 })),
    ).toThrow();
    expect(() =>
      parseSnapshot(JSON.stringify({ ...initial, revision: 0 })),
    ).toThrow();
    expect(() => parseSnapshot("null")).toThrow();
  });
});
