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
/** Decorative species follow sorted roster identities, never role or status.
 * The first six identities are distinct; larger rosters repeat the palette.
 * A caller absent from the roster gets the next slot without remapping the roster.
 */
export function crewPortrait(snapshot: PanelSnapshot, agent: PanelAgent) {
  const portraits = ["fox", "owl", "turtle", "puffin", "rabbit", "red-panda"];
  const identities = [...new Set(snapshot.agents.map(member => member.id))].sort();
  const rosterIndex = identities.indexOf(agent.id);
  const index = rosterIndex < 0 ? identities.length : rosterIndex;
  return `/assets/arcade/${portraits[index % portraits.length]}.png`;
}
export function concise(value: string, limit = 72) {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}
export function questTitle(value: string) {
  return concise(value.split(/[:：\r\n]/)[0]?.trim() || value, 52);
}
