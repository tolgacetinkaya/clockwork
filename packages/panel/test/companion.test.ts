import { describe, it, expect } from "vitest";
import { reduceLedger, buildBudgetReport } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import { companionState, companionAnnouncement, companionPresentation, readPetPreferences } from "../client/companion-state.js";
function fixture(): PanelSnapshot {
    const state = reduceLedger([]);
    return {
        schemaVersion: 1,
        mode: "workspace",
        streamId: "a",
        revision: 1,
        updatedAt: "",
        state,
        budget: buildBudgetReport(state),
        events: [],
        eventCount: 0,
        agents: [],
        spec: null,
        control: {
            paused: false,
            kill: false
        },
        queue: {
            queued: [],
            consumedSeq: 0
        },
        issues: []
    };
}
describe("companion evidence", () => {
    it("puts disconnection before historical success and never calls a demo live", () => {
        const s = fixture();
        s.launch = {
            enabled: true,
            status: "completed",
            result: {
                status: "completed",
                accepted: [],
                failures: {},
                integrationVerification: {
                    status: "passed"
                }
            }
        };
        expect(companionState(s, "stale").kind).toBe("offline");
        s.mode = "recorded-demo";
        expect(companionState(s, "live").kind).toBe("demo");
    });
    it("keeps completion separate from final verification", () => {
        const s = fixture();
        s.state.outcome = "done";
        expect(companionState(s, "live").kind).toBe("complete");
        s.launch = {
            enabled: true,
            status: "completed",
            result: {
                status: "completed",
                accepted: [],
                failures: {},
                integrationVerification: {
                    status: "not_configured"
                }
            }
        };
        expect(companionState(s, "live").kind).toBe("ungated");
        s.launch.result!.integrationVerification!.status = "failed";
        expect(companionState(s, "live").kind).toBe("failed");
        s.launch.result!.integrationVerification!.status = "passed";
        expect(companionState(s, "live").kind).toBe("passed");
    });
    it("prioritizes operator input and rework above activity", () => {
        const s = fixture();
        s.state.units.a = {
            status: "rework",
            dependsOn: [],
            reworkAttempts: 1,
            estimated: 0,
            spent: 0
        };
        s.agents = [
            {
                id: "w",
                purpose: null,
                modelTier: null,
                status: "working",
                units: [
                    "a"
                ],
                lastEventAt: null
            }
        ];
        expect(companionState(s, "live").kind).toBe("rework");
        s.state.pendingQuestions = [
            "answer"
        ];
        expect(companionState(s, "live").kind).toBe("input");
        s.issues = [
            "bad data"
        ];
        expect(companionState(s, "live").kind).toBe("issues");
    });
    it("counts accepted units exactly and distinguishes requested from recorded pauses", () => {
        const s = fixture();
        for (const [id, status] of [
            [
                "a", "accepted"
            ], [
                "b", "running"
            ], [
                "c", "cancelled"
            ]
        ] as const)
            s.state.units[id] = {
                status,
                dependsOn: [],
                reworkAttempts: 0,
                estimated: 0,
                spent: 0
            };
        s.agents = [
            {
                id: "w",
                purpose: null,
                modelTier: null,
                status: "working",
                units: [
                    "b"
                ],
                lastEventAt: null
            }
        ];
        expect(companionState(s, "live")).toMatchObject({
            accepted: 1,
            total: 3,
            workers: 1,
            tasks: [
                "b"
            ]
        });
        s.control.paused = true;
        expect(companionState(s, "live")).toMatchObject({ kind: "pause_requested", workers: 1, tasks: ["b"] });
        s.control.kill = true;
        expect(companionState(s, "live")).toMatchObject({ kind: "stop_requested", workers: 1, tasks: ["b"] });
        s.control.kill = false;
        s.state.paused = true;
        expect(companionState(s, "live")).toMatchObject({
            kind: "paused",
            workers: 0,
            tasks: []
        });
    });
    it("recovers safely from invalid or denied saved settings", () => {
        expect(readPetPreferences({
            getItem: () => {
                throw Error();
            }
        }).muted).toBe(true);
        expect(readPetPreferences({
            getItem: () => '{"version":1,"variant":"<script>","muted":false}'
        })).toMatchObject({
            variant: "brass",
            muted: false,
            hidden: false
        });
    });
});

describe("companion transition announcements", () => {
    const current = {
        stream: "a",
        revision: 2,
        kind: "passed" as const
    };
    it("does not announce initial state, stream replacement, or muted updates", () => {
        expect(companionAnnouncement(undefined, current, true)).toBeUndefined();
        expect(companionAnnouncement({
            ...current,
            stream: "old",
            kind: "working"
        }, current, true)).toBeUndefined();
        expect(companionAnnouncement({
            ...current,
            revision: 1,
            kind: "working"
        }, current, false)).toBeUndefined();
    });
    it("announces new meaningful revisions only once, including after locale or preference changes", () => {
        expect(companionAnnouncement({
            ...current,
            revision: 1,
            kind: "working"
        }, current, true)).toBe("Combined verification passed");
        expect(companionAnnouncement(current, current, true)).toBeUndefined();
        expect(companionAnnouncement({
            ...current,
            kind: "working"
        }, current, true)).toBeUndefined();
        expect(companionAnnouncement({
            ...current,
            revision: 3,
            kind: "working"
        }, current, true)).toBeUndefined();
    });
    it("announces interruption but never replays the previous outcome on reconnect", () => {
        const offline = {
            ...current,
            kind: "offline" as const
        };
        expect(companionAnnouncement(current, offline, true)).toBe("Connection interrupted · showing last snapshot");
        expect(companionAnnouncement(offline, {
            ...current,
            revision: 3
        }, true)).toBeUndefined();
        expect(companionAnnouncement({
            ...current,
            kind: "loading"
        }, current, true)).toBeUndefined();
    });
    it("does not celebrate an old passing result during a new launch", () => {
        const s = fixture();
        s.state.outcome = "done";
        s.launch = {
            enabled: true,
            status: "running",
            result: {
                status: "completed",
                accepted: [],
                failures: {},
                integrationVerification: {
                    status: "passed"
                }
            }
        };
        expect(companionState(s, "live").kind).toBe("idle");
        s.launch.status = "completed";
        expect(companionState(s, "live").kind).toBe("passed");
    });
});



describe("companion bubble presentation", () => {
  const previous = { stream: "a", revision: 1, kind: "input" as const };
  it("preserves an existing bubble on same-state heartbeats", () => {
    expect(companionPresentation(previous, { ...previous, revision: 2 }, true)).toEqual({ action: "keep" });
  });
  it("clears old guidance on quiet transitions, new streams, locale changes and reconnect", () => {
    expect(companionPresentation(previous, { ...previous, kind: "working", revision: 2 }, true)).toEqual({ action: "clear" });
    expect(companionPresentation(previous, { ...previous, stream: "b" }, true)).toEqual({ action: "clear" });
    expect(companionPresentation(previous, previous, true, true)).toEqual({ action: "clear" });
    expect(companionPresentation({ ...previous, kind: "offline" }, previous, true)).toEqual({ action: "clear" });
  });
  it("replaces old guidance only with a new meaningful transition", () => {
    expect(companionPresentation(previous, { ...previous, kind: "passed", revision: 2 }, true)).toEqual({ action: "announce", message: "Combined verification passed" });
    expect(companionPresentation(previous, previous, false)).toEqual({ action: "clear" });
  });
});
