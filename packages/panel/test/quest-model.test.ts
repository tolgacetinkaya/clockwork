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
 it("assigns six distinct portraits independent of roster ordering, status or role", () => {
  const ids = ["builder-1", "builder-2", "builder-3", "verifier-1", "verifier-2", "integration-reviewer"];
  const agents = ids.map(id => ({id,purpose:null,modelTier:null,status:"idle" as const,units:[],lastEventAt:null}));
  const snapshot = {...base,agents};
  const before = Object.fromEntries(agents.map(agent => [agent.id,crewPortrait(snapshot,agent)]));
  expect(new Set(Object.values(before)).size).toBe(6);
  expect(new Set(Object.values(before))).toEqual(new Set(["fox","owl","turtle","puffin","rabbit","red-panda"].map(name => `/assets/arcade/${name}.png`)));
  const changed = {...snapshot,agents:[...agents].reverse().map(agent => ({...agent,status:"verifying" as const,mode:"verify"}))};
  for (const agent of changed.agents) expect(crewPortrait(changed,agent)).toBe(before[agent.id]);
 });
 it("provides a deterministic fallback for missing roster identities and repeats only beyond six", () => {
  const agent = (id:string) => ({id,purpose:null,modelTier:null,status:"idle" as const,units:[],lastEventAt:null});
  expect(crewPortrait(base,agent("missing"))).toBe("/assets/arcade/fox.png");
  const agents = ["builder-1","builder-2","builder-3"].map(agent);
  const snapshot = {...base,agents};
  const missing = crewPortrait(snapshot,agent("not-in-roster"));
  expect(agents.map(member => crewPortrait(snapshot,member))).not.toContain(missing);
  expect(crewPortrait({...snapshot,agents:[...agents].reverse()},agent("not-in-roster"))).toBe(missing);
  const larger = {...base,agents:Array.from({length:8},(_,index)=>agent(`agent-${index}`))};
  const portraits = larger.agents.map(member=>crewPortrait(larger,member));
  expect(new Set(portraits.slice(0,6)).size).toBe(6);
  expect(portraits[6]).toBe(portraits[0]);
  expect(portraits[7]).toBe(portraits[1]);
 });
 it("keeps mission headings to the first concise clause", () => {
  expect(questTitle("URL shortener: implement storage, endpoints and documentation")).toBe("URL shortener");
  expect(questTitle("Mission title\nDetailed requirements")).toBe("Mission title");
  expect(questTitle("A".repeat(120)).length).toBe(52);
 });
});
