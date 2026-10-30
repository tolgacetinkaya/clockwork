import type { PanelSnapshot } from "../src/protocol.js";

/** Counts recorded activity; no process or provider health is inferred. */
export function teamSummary(snapshot: PanelSnapshot) {
  const active = !snapshot.state.outcome && !snapshot.control.kill && !snapshot.control.paused && !snapshot.state.paused;
  return {
    producers: active ? snapshot.agents.filter((agent) => agent.status === "working").length : 0,
    verifiers: active ? snapshot.agents.filter((agent) => agent.status === "verifying").length : 0,
    waiting: active ? Object.values(snapshot.state.units).filter((unit) =>
      (unit.status === "pending" || unit.status === "blocked") &&
      unit.dependsOn.some((id) => snapshot.state.units[id]?.status !== "accepted"),
    ).length : 0,
  };
}

export function activeTeam(snapshot: PanelSnapshot) {
  const priority = { working: 0, verifying: 1, attention: 2, idle: 3, completed: 4 };
  return [...snapshot.agents].sort((a, b) => priority[a.status] - priority[b.status] || a.id.localeCompare(b.id));
}

/** Unit readiness and actors from the current ledger projection. */
export function unitActivity(snapshot: PanelSnapshot, id: string) {
  const unit = snapshot.state.units[id];
  if (!unit) return null;
  const waitingOn = unit.dependsOn.filter((dependency) => snapshot.state.units[dependency]?.status !== "accepted");
  const stopped = snapshot.state.outcome || snapshot.control.kill;
  const paused = snapshot.control.paused || snapshot.state.paused;
  const stage = stopped || paused ? null : unit.status === "verifying" ? "Verification" :
    unit.status === "running" ? "Production" : null;
  const actors = !stage ? [] : snapshot.agents.filter((agent) =>
    agent.units.includes(id) && agent.status === (stage === "Verification" ? "verifying" : "working"),
  );
  const terminal = ["accepted", "failed", "cancelled"].includes(unit.status);
  const readiness = terminal ? null : snapshot.state.outcome === "done" ? "Run complete" : stopped ? "Run stopped" : paused ? "Run paused" :
    unit.status === "rework" ? "Needs rework" :
    unit.status === "pending" || unit.status === "blocked"
      ? waitingOn.length ? "Waiting on dependencies" : "Dependencies satisfied"
      : stage === "Production" && !actors.length ? "Awaiting verification" :
        stage ? `${stage} recorded` : null;
  return { waitingOn, stage, actors, readiness };
}
