import type { PanelSnapshot, PanelAgent } from "../src/protocol.js";
import { crewContributions } from "./crew.js";

/** Dependency-first ordering; retain every recorded unit, even malformed/cyclic input. */
export function questUnits(snapshot: PanelSnapshot) {
  const entries = Object.entries(snapshot.state.units);
  const remaining = new Map(entries), ordered: typeof entries = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, unit]) => unit.dependsOn.every(id => !remaining.has(id)));
    const batch = ready.length ? ready : [remaining.entries().next().value!];
    for (const entry of batch) { ordered.push(entry); remaining.delete(entry[0]); }
  }
  return ordered;
}
export function questDeliveries(snapshot: PanelSnapshot) {
  return [...new Set([...crewContributions(snapshot).values()].flatMap(value => value.deliveries))];
}
/** Portrait identity is decorative; true role labels are independent of species. */
export function crewPortrait(_snapshot: PanelSnapshot, agent: PanelAgent) {
  const hash = [...agent.id].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  return `/assets/arcade/${["fox", "owl", "turtle"][hash % 3]}.png`;
}
export function concise(value: string, limit = 72) {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}
export function questTitle(value: string) {
  return concise(value.split(/[:：\r\n]/)[0]?.trim() || value, 52);
}
