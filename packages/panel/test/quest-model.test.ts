import { describe, expect, it } from "vitest";
import { buildBudgetReport, reduceLedger } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import { questDeliveries, questUnits, crewPortrait, questTitle } from "../client/quest-model.js";
const state = reduceLedger([]);
const base: PanelSnapshot = { schemaVersion: 1, mode: "workspace", streamId: "test", revision: 1, updatedAt: "2026-10-29", state, budget: buildBudgetReport(state), events: [], eventCount: 0, agents: [], spec: null, control: { paused: false, kill: false }, queue: { queued: [], consumedSeq: 0 }, issues: [] };
const unit = (dependsOn: string[] = []) => ({ status: "pending" as const, dependsOn, reworkAttempts: 0, estimated: 0, spent: 0 });
describe("quest route projection", () => {
 it("orders dependencies first without dropping wide DAGs or unknown dependencies", () => {
  const units = Object.fromEntries(Array.from({length:12}, (_, i) => [`task-${11-i}`, unit(i === 11 ? ["external"] : [`task-${10-i}`])]));
  const route = questUnits({...base, state: {...state, units}}).map(([id]) => id);
  expect(route).toEqual(Array.from({length:12}, (_, i) => `task-${i}`));
 });
 it("handles empty and cyclic input without inventing tasks", () => {
  expect(questUnits(base)).toEqual([]);
  expect(questUnits({...base, state: {...state, units: {a:unit(["b"]), b:unit(["a"])}}}).map(([id])=>id)).toEqual(["a","b"]);
 });
 it("does not show delivery badges for accepted state lacking independent evidence", () => {
  expect(questDeliveries({...base,state:{...state,units:{a:{...unit(),status:"accepted"}}}})).toEqual([]);
 });
 it("uses stable identity-based raster portraits without implying a different role", () => {
  const agent = {id:"agent-a",purpose:null,modelTier:null,status:"idle" as const,units:[],lastEventAt:null};
  expect(crewPortrait(base,agent)).toBe(crewPortrait(base,{...agent,mode:"verify"}));
  const portraits = ["agent-a","agent-b","agent-c"].map(id => crewPortrait(base,{...agent,id}));
  expect(new Set(portraits).size).toBe(3);
  expect(portraits.every(path => /\/(fox|owl|turtle)\.png$/.test(path))).toBe(true);
 });
 it("keeps mission headings to the first concise clause", () => {
  expect(questTitle("URL shortener: implement storage, endpoints and documentation")).toBe("URL shortener");
  expect(questTitle("Mission title\nDetailed requirements")).toBe("Mission title");
  expect(questTitle("A".repeat(120)).length).toBe(52);
 });
});
