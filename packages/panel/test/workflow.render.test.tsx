import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBudgetReport, reduceLedger } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import { Onboarding, workspacePanelCommand } from "../client/onboarding.js";
import { Mission } from "../client/mission.js";
import { setLocale, translate } from "../client/i18n.js";
import { workflowMessages } from "../client/locales/workflow.js";

function snapshot(mode: PanelSnapshot["mode"], enabled: boolean): PanelSnapshot {
  const state = reduceLedger([]);
  return { schemaVersion:1, mode, streamId:"workflow", revision:1, updatedAt:"2026-10-29", state,
    budget:buildBudgetReport(state), events:[], eventCount:0, agents:[], spec:null,
    control:{paused:false,kill:false},queue:{queued:[],consumedSeq:0},issues:[],
    launch:{enabled,status:"idle",disabledReason:enabled?undefined:"Recorded demo cannot launch agents"} };
}
function missionHTML(value: PanelSnapshot) {
  return renderToStaticMarkup(createElement(QueryClientProvider,{client:new QueryClient()},createElement(Mission,{snapshot:value,disabled:false})));
}
beforeEach(()=>setLocale("en"));
afterEach(()=>setLocale("en"));

describe("getting started guides the actual supported workflow",()=>{
  it("explains recorded-demo limits, real workspace binding and useful places to inspect recorded work",()=>{
    const html=renderToStaticMarkup(createElement(Onboarding,{snapshot:snapshot("recorded-demo",false)}));
    expect(html).toContain("This Docker demo shows recorded work and cannot start agents.");
    expect(html).toContain("Planning is manual:");
    expect(html).toContain("Choose it in your terminal.");
    expect(html).toContain("Connect a workspace first");
    expect(html).toContain("Explore recorded run");
    expect(html).toContain("See the team");
    expect(html).toContain("Open task board");
    expect(html).toContain("No project folder is uploaded or selected in this browser.");
    expect(html).toContain("Inspect combined verification evidence");
    expect(html).not.toContain("Open mission planning");
    expect(html).not.toContain('type="file"');
    expect(workspacePanelCommand).toContain("packages/cli/src/bin.ts");
    expect(workspacePanelCommand).toContain("ui --enable-execution --port 47833");
    expect(workspacePanelCommand).not.toContain("team-panel");
  });
  it("offers planning only for a workspace whose local runner is enabled",()=>{
    const html=renderToStaticMarkup(createElement(Onboarding,{snapshot:snapshot("workspace",true)}));
    expect(html).toContain("Local execution available");
    expect(html).toMatch(/<button[^>]*>Open mission planning/);
    expect(html).toContain("Saving does not run agents.");
    for (const value of [undefined,snapshot("workspace",false)]) {
      const unavailable=renderToStaticMarkup(createElement(Onboarding,{snapshot:value}));
      expect(unavailable).toContain("Connect a workspace first");
      expect(unavailable).not.toContain("Open mission planning");
    }
  });
  it("keeps the demo editor disabled and preserves explicit review/start safeguards",()=>{
    const demo=missionHTML(snapshot("recorded-demo",false));
    expect(demo).toContain("You are viewing a recorded demo. No agents will start here.");
    expect(demo).toMatch(/<fieldset class="mission-editor" disabled=""/);
    expect(demo).toContain("Connect a workspace first");
    const workspace=missionHTML(snapshot("workspace",true));
    expect(workspace).not.toMatch(/<fieldset class="mission-editor" disabled/);
    expect(workspace).toContain("Planning is manual:");
    expect(workspace).toContain("Task setup");
    expect(workspace).toContain("I reviewed ownership, dependencies, acceptance and combined verification commands.");
    for (const html of [demo,workspace]) {
      const buttons=html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)??[];
      for (const label of ["Approve reviewed plan","Start approved mission"]) {
        const button=buttons.find(value=>value.includes(label));
        expect(button).toBeTruthy();
        expect(button).toContain('disabled=""');
      }
    }
  });
  it("translates every guide message and renders each supported non-English locale",()=>{
    const keys=Object.keys(workflowMessages.tr);
    for (const locale of ["tr","es","de","fr","pt"] as const) {
      expect(Object.keys(workflowMessages[locale]).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(workflowMessages[locale][key]).toBeTruthy();
        expect(translate(locale,key)).toBe(workflowMessages[locale][key]);
      }
      setLocale(locale);
      const html=renderToStaticMarkup(createElement(Onboarding,{snapshot:snapshot("recorded-demo",false)}));
      expect(html).toContain(workflowMessages[locale]["One project. One reviewed mission."]);
      expect(html).toContain(workflowMessages[locale]["Connect a workspace first"]);
      expect(html).toContain(workflowMessages[locale]["Explore recorded run"]);
    }
  });
});
