import type { PanelSnapshot } from "../src/protocol.js";
import { title, unitTitle } from "./format.js";
import { unitActivity } from "./team-summary.js";

export function UnitActivity({ snapshot, id }: { snapshot: PanelSnapshot; id: string }) {
  const activity = unitActivity(snapshot, id);
  if (!activity?.readiness) return null;
  return <div className="unit-activity">
    <strong>{activity.readiness}</strong>
    {activity.actors.length ? <span>{activity.stage === "Verification" ? "Verifier" : "Producer"}: {activity.actors.map((agent) => title(agent.id)).join(", ")}</span> : null}
    {activity.waitingOn.length && !activity.stage ? <span>{activity.waitingOn.map((dependency) => `${unitTitle(snapshot, dependency)} (${title(snapshot.state.units[dependency]?.status ?? "not recorded")})`).join(" · ")}</span> : null}
  </div>;
}
