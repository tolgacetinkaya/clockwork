import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBudgetReport, reduceLedger } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import { Overview } from "../client/overview.js";
import { setLocale } from "../client/i18n.js";

function emptySnapshot(): PanelSnapshot {
  const state = reduceLedger([]);
  return {
    schemaVersion: 1, mode: "recorded-demo", streamId: "overview-regression",
    revision: 1, updatedAt: "2026-10-29T00:00:00.000Z", state,
    budget: buildBudgetReport(state), events: [], eventCount: 0, agents: [], spec: null,
    control: { paused: false, kill: false }, queue: { queued: [], consumedSeq: 0 }, issues: [],
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("overview evidence and task access", () => {
  it("keeps every historical accepted task accessible without inventing independent delivery evidence", () => {
    const snapshot = emptySnapshot();
    const ids = ["storage", "api", "docs", "frontend", "infra", "integration", "audit", "release", "support"];
    snapshot.state.outcome = "done";
    snapshot.state.units = Object.fromEntries(ids.map((id, index) => [id, {
      status: "accepted" as const, dependsOn: index ? [ids[index - 1]!] : [],
      reworkAttempts: 0, estimated: 0, spent: 0,
    }]));
    snapshot.spec = {
      goal: "Historical project", version: 1, bias: "thorough",
      units: ids.map(id => ({ id, type: "code", description: `Recorded ${id} task`, owns: [], acceptance: [] })),
    };
    const html = renderToStaticMarkup(createElement(Overview, { snapshot }));
    expect(html).toContain("9 of 9 units accepted");
    expect(html).not.toContain("Verified deliveries");
    expect(html).not.toContain("Independent verification recorded");
    for (const [index, id] of ids.entries()) {
      const label = `${index + 1}. ${id[0]!.toUpperCase()}${id.slice(1)}`;
      expect(html).toContain(`<strong>${label}</strong>`);
    }
    // The selected task has a named, enabled path to the full evidence drawer.
    expect(html).toContain('aria-label="Task inspector"');
    const inspectButton = html.match(/<button[^>]*>Inspect evidence[\s\S]*?<\/button>/)?.[0];
    expect(inspectButton).toBeTruthy();
    expect(inspectButton).not.toContain("disabled");
  });

  it("explains an empty run without presenting fictional tasks or an unusable evidence action", () => {
    const html = renderToStaticMarkup(createElement(Overview, { snapshot: emptySnapshot() }));
    expect(html).toContain("Your route starts here");
    expect(html).toContain("Recorded tasks will appear as the team takes shape.");
    expect(html).toContain("Choose a task to inspect its recorded evidence.");
    expect(html).not.toContain("Verified deliveries");
    expect(html).not.toContain(">Inspect evidence");
  });
});
