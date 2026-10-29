import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { reduceLedger, buildBudgetReport } from "@clockwork/core";
import { IntegrationEvidence } from "../client/verification-evidence.js";
import { Team } from "../client/team.js";
import { Mission } from "../client/mission.js";
import type { PanelSnapshot } from "../src/protocol.js";
const state = reduceLedger([]);
const snapshot: PanelSnapshot = { schemaVersion: 1, mode: "recorded-demo", streamId: "test", revision: 1, updatedAt: "2026-10-29", state, budget: buildBudgetReport(state), events: [], eventCount: 0, agents: [], spec: null, control: { paused: false, kill: false }, queue: { queued: [], consumedSeq: 0 }, issues: [], launch: { enabled: false, disabledReason: "Recorded Docker demo cannot launch local agents.", status: "idle" } };
describe("mission control rendering", () => {
  it("explains disabled capability and renders explicit review, start and recovery controls", () => {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Mission, { snapshot, disabled: false })));
    expect(html).toContain("Recorded Docker demo cannot launch local agents.");
    expect(html).toContain("Approve reviewed plan"); expect(html).toContain("Start approved mission"); expect(html).toContain("Inspect recovery state");
    expect(html).toContain("No combined verification result recorded");
    expect(html).toContain("Estimated tokens");
    expect(html).toContain("read-only integration workspace");
    expect(html).toMatch(/disabled=""[^>]*>.*?Approve reviewed plan/s);
  });
});

describe("integration and recovery evidence rendering", () => {
  it("renders criterion, actual command, observed result, pass/fail and findings as text", () => {
    const html = renderToStaticMarkup(createElement(IntegrationEvidence, { value: { status: "failed", reason: "Missing evidence", report: { findings: ["Review failure"], evidence: [{ criterion: "API works", command: "check-api", result: "<script>observed text</script>", passed: false }] } } }));
    expect(html).toContain("API works"); expect(html).toContain("check-api"); expect(html).toContain("Failed"); expect(html).toContain("Review failure"); expect(html).toContain("Missing evidence"); expect(html).toContain("&lt;script&gt;observed text&lt;/script&gt;"); expect(html).not.toContain("<pre>");
  });
  it("shows preserved work locations and accepted/retry lists without claiming files were inspected", () => {
    const recovering = { ...snapshot, launch: { ...snapshot.launch!, recovery: { recoveryToken: "review", reasons: ["Review preserved work"], canResume: true, accepted: ["api"], retry: ["ui"], integrationWorkspace: "G:/integration", workspaces: { ui: "G:/ui" }, integrationVerification: { status: "failed" as const } } } };
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Mission, { snapshot: recovering, disabled: false })));
    expect(html).toContain("Accepted and integrated task IDs: api"); expect(html).toContain("Tasks to retry: ui"); expect(html).toContain("G:/integration"); expect(html).toContain("G:/ui"); expect(html).toContain("separately inspected the preserved work");
  });
});

describe("compact crew presentation", () => {
  const crew = { ...snapshot, mode: "workspace" as const, agents: [{ id: "integration-generated-long-execution-id", mode: "integration_verify", purpose: null, modelTier: null, status: "verifying" as const, units: [], lastEventAt: null }] };
  it("makes independent whole-project review visible without a unit assignment", () => {
    const html = renderToStaticMarkup(createElement(Team, { snapshot: crew }));
    expect(html).toContain("Final review"); expect(html).toContain("Whole-project review");
    expect(html).toContain("Execution identity"); expect(html).toContain("Agent details");
    expect(html).toMatch(/<details[^>]*><summary>Execution identity<\/summary><code>integration-generated-long-execution-id/);
    expect(html).not.toContain("<h2>Integration Generated");
  });
  it("moves paused and stopped crew into a recorded-only lane", () => {
    for (const control of [{ paused: true, kill: false }, { paused: false, kill: true }]) {
      const html = renderToStaticMarkup(createElement(Team, { snapshot: { ...crew, control } }));
      expect(html).toContain("Recorded crew"); expect(html).toContain("Crew cards show recorded work"); expect(html).not.toContain("<h3>Verification</h3>");
    }
  });
});

describe("crew mission descriptions and team completion", () => {
  it("promotes task descriptions while retaining task IDs", () => {
    const taskCrew = { ...snapshot, launch: { enabled: true, status: "completed" as const }, agents: [{ id: "builder-a", purpose: null, modelTier: null, status: "completed" as const, units: ["a"], lastEventAt: null }], spec: { goal: "Goal", units: [{ id: "a", type: "code" as const, description: "Deliver the account settings", owns: [], acceptance: [] }], version: 1, bias: "thorough" as const } };
    const html = renderToStaticMarkup(createElement(Team, { snapshot: taskCrew }));
    expect(html).toContain("Deliver the account settings"); expect(html).toContain("<small>a</small>"); expect(html).toContain("Team complete"); expect(html).toContain("crew-recorded"); expect(html).not.toContain("<h3>Production</h3>");
  });
});
