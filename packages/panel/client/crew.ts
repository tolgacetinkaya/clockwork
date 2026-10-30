import { t } from "./i18n.js";
import type { PanelSnapshot } from "../src/protocol.js";

/** Conservative badges from visible evidence only, never lifetime totals. */
export function crewContributions(snapshot: Pick<PanelSnapshot, "events" | "state">) {
  const contributions = new Map<string, { deliveries: string[]; verifications: string[] }>();
  const credit = (agent: string, kind: "deliveries" | "verifications", unit: string) => {
    const value = contributions.get(agent) ?? { deliveries: [], verifications: [] };
    if (!value[kind].includes(unit)) value[kind].push(unit);
    contributions.set(agent, value);
  };
  const events = [...new Map(snapshot.events.map((event) => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
  for (const [id, unit] of Object.entries(snapshot.state.units)) {
    if (unit.status !== "accepted") continue;
    const history = events.filter((event) => event.unit_id === id);
    const accepted = [...history].reverse().find((event) => event.type === "unit.accepted");
    if (!accepted?.agent_id || accepted.data?.mode !== "verify") continue;
    const before = history.filter((event) => event.seq < accepted.seq);
    const reset = [...before].reverse().find((event) => ["unit.rework", "unit.failed", "unit.cancelled"].includes(event.type))?.seq ?? 0;
    const produced = [...before].reverse().find((event) => event.seq > reset && event.type === "agent.completed" && event.data?.mode === "produce");
    const verified = before.find((event) => event.seq > (produced?.seq ?? Infinity) && event.type === "agent.completed" && event.agent_id === accepted.agent_id && event.data?.mode === "verify" && event.data?.execution === accepted.data?.execution);
    if (!produced?.agent_id || produced.agent_id === accepted.agent_id || !verified) continue;
    credit(produced.agent_id, "deliveries", id);
    credit(accepted.agent_id, "verifications", id);
  }
  return contributions;
}

export function crewRole(snapshot: Pick<PanelSnapshot, "events">, agent: PanelSnapshot["agents"][number]) {
  const mode = (agent as { mode?: string }).mode ?? [...snapshot.events].reverse().find((event) => event.agent_id === agent.id && typeof event.data?.mode === "string")?.data?.mode;
  return mode === "integration_verify" ? "Final review" : mode === "verify" || agent.status === "verifying" ? "Verifier" : "Builder";
}
export function crewRunFlag(snapshot: Pick<PanelSnapshot, "state" | "control" | "launch">) {
  return snapshot.state.outcome === "done" ? t("Run complete") : snapshot.state.outcome === "abandoned" || snapshot.control.kill ? t("Run stopped") : snapshot.control.paused || snapshot.state.paused ? t("Run paused") : snapshot.launch?.status === "completed" ? t("Team complete") : snapshot.launch?.status === "stopped" || snapshot.launch?.status === "error" ? t("Team stopped") : null;
}

export function finalReviewOutcome(snapshot: Pick<PanelSnapshot, "events">, agentId: string): string | null {
  const report = [...snapshot.events].reverse().find((event) => event.agent_id === agentId && event.type === "agent.completed")?.data?.report;
  if (!report || typeof report !== "object") return null;
  const outcome = (report as Record<string, unknown>).outcome;
  return outcome === "accepted" ? t("Review report: accepted") : outcome === "rework" ? t("Review report: needs rework") : outcome === "blocked" ? t("Review report: blocked") : null;
}
