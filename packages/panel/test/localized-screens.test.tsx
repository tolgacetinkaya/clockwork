import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { reduceLedger, buildBudgetReport } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import { setLocale, locales } from "../client/i18n.js";
import { Overview } from "../client/overview.js";
import { Workboard } from "../client/work.js";
import { Mission } from "../client/mission.js";
import { Team } from "../client/team.js";
import { ActivityView } from "../client/activity.js";
import { Decisions } from "../client/decisions.js";
import { IntegrationEvidence } from "../client/verification-evidence.js";

const state = reduceLedger([]);
state.units["raw-unit-id"] = {status:"accepted", dependsOn:[], reworkAttempts:0, estimated:100, spent:100};
const snapshot: PanelSnapshot = { schemaVersion:1, mode:"workspace", streamId:"locale", revision:1, updatedAt:"2026-10-29", state, budget:buildBudgetReport(state), events:[], eventCount:0, agents:[{id:"raw-agent-id",purpose:null,modelTier:null,status:"completed",units:["raw-unit-id"],lastEventAt:null}], spec:{goal:"Mission goal",units:[{id:"raw-unit-id",type:"code",description:"Task plan",owns:["src/**"],acceptance:["Language"]}],version:1,bias:"thorough"},control:{paused:false,kill:false},queue:{queued:[],consumedSeq:0},issues:[],launch:{enabled:false,status:"idle"}};
afterEach(()=>setLocale("en"));
describe("localized screen boundaries",()=>{
 for(const locale of locales) it(`renders every screen in ${locale} without translating user evidence`,()=>{
  setLocale(locale);
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client:new QueryClient()},createElement(Fragment,null,
   createElement(Overview,{snapshot}), createElement(Workboard,{snapshot}), createElement(Mission,{snapshot,disabled:false}),
   createElement(Team,{snapshot}),createElement(ActivityView,{snapshot}),createElement(Decisions,{snapshot,submit:async()=>{},busy:false,disabled:false}),
   createElement(IntegrationEvidence,{value:{status:"passed",report:{findings:[],evidence:[{criterion:"Language",command:"echo raw-command",result:"raw-result",passed:true}]}}})
  )));
  // These deliberately collide with interface keys; user-owned text must stay intact.
  expect(html).toContain("Mission goal"); expect(html).toContain("Task plan"); expect(html).toContain("Language");
  expect(html).toContain("raw-unit-id");expect(html).toContain("echo raw-command");expect(html).toContain("raw-result");
  expect(html).not.toContain("{count}");expect(html).not.toContain("{accepted}");
 });
});
