import { t, useI18n } from "./i18n.js";
import { ArrowUpRight } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { title, time, unitTitle } from "./format.js";
import { usePanelUI } from "./state.js";
import { Empty, Status } from "./ui.js";
import { activeTeam, teamSummary, unitActivity } from "./team-summary.js";
import { crewContributions, crewRole, crewRunFlag, finalReviewOutcome } from "./crew.js";
import { concise, crewPortrait } from "./quest-model.js";
import "./quest.css";
import { PageHeading } from "./work.js";

export function Team({ snapshot }: { snapshot: PanelSnapshot }) {
  useI18n();
  const select = usePanelUI((s) => s.selectUnit);
  const summary = teamSummary(snapshot);
  const agents = activeTeam(snapshot);
  const contributions = crewContributions(snapshot);
  const flag = crewRunFlag(snapshot);
  const laneOf = (agent: typeof agents[number]) => flag ? "Recorded crew" : agent.status === "working" ? "Production" : agent.status === "verifying" ? "Verification" : "Standby & completed";
  const lanes = flag ? ["Recorded crew"] : ["Production", "Verification", "Standby & completed"];
  return <>
    <PageHeading eyebrow={t("THE ASSEMBLED TEAM")} title={t("Specialists, with a shared purpose.")} subtitle={t("Agent assignments and activity from the ledger. Process liveness is not measured.")} />
    {flag ? <p className="crew-run-flag" role="status">{flag}{" "}{t("· Crew cards show recorded work.")}</p> : null}
    <div className="team-summary" aria-label={t("Recorded team activity")}>
      <span><strong>{summary.producers}</strong>{" "}{t("Active producers")}</span>
      <span><strong>{summary.verifiers}</strong>{" "}{t("Active verifiers")}</span>
      <span><strong>{summary.waiting}</strong>{" "}{t("Units waiting on dependencies")}</span>
    </div>
    <section className="crew-section" aria-label={t("Crew roles and contributions")}>
      <h2>{t("The crew, at a glance")}</h2>
      <p className="small-muted">{t("Badges count unique accepted tasks with producer and independent verifier evidence in the latest {count} recorded events. They do not imply integration or combined verification passed.", { count: snapshot.events.length })}</p>
      {agents.length ? <div className={`crew-lanes ${flag ? "crew-recorded" : ""}`}>
        {lanes.map((lane) => <section className="crew-lane" key={lane}><h3>{t(lane)}</h3><div className="crew-cards">
          {agents.filter((agent) => laneOf(agent) === lane).map((agent) => {
            const evidence = contributions.get(agent.id);
            const role = crewRole(snapshot, agent);
            const missions = agent.units.filter((id) => unitActivity(snapshot, id)?.actors.some((actor) => actor.id === agent.id));
            const shownUnits = missions.length ? missions : agent.units;
            const reviewOutcome = role === "Final review" ? finalReviewOutcome(snapshot, agent.id) : null;
            return <article className="crew-member" key={agent.id}>
              <header className="crew-member-header"><img className="crew-portrait" src={crewPortrait(snapshot, agent)} alt="" /><span className="crew-role">{t(role)}</span>{flag ? <span className="small-muted">{flag}</span> : <Status value={agent.status} />}</header>
              {role === "Final review" ? <h4>{t("Whole-project review")}</h4> : shownUnits.length ? shownUnits.map((id) => <button className="crew-mission" key={id} onClick={() => select(id)}><span className="crew-mission-description"><strong>{unitTitle(snapshot, id)}</strong><span>{concise(snapshot.spec?.units.find((unit) => unit.id === id)?.description ?? unitTitle(snapshot, id), 140)}</span></span><small>{id}</small><ArrowUpRight size={12} /></button>) : <p>{agent.purpose ?? t("Awaiting a recorded task")}</p>}
              {reviewOutcome ? <p className="crew-review-outcome">{reviewOutcome}</p> : null}
              {missions.map((id) => <p className="small-muted" key={id}>{unitActivity(snapshot, id)?.readiness}</p>)}
              {role === "Final review" ? <p className="small-muted">{t("Independent acceptance checks over the combined integration workspace.")}</p> : null}
              <p className="crew-provider">{[agent.provider, agent.model].filter(Boolean).join(" / ") || t("Provider / model not recorded")}</p>
              <p className="small-muted">{t("Last recorded activity {time}", { time: agent.lastEventAt ? time(agent.lastEventAt) : t("not recorded") })}</p>
              {evidence?.deliveries.length ? <div className="contribution-badge">{t("Accepted delivery · {count}", { count: evidence.deliveries.length })}{evidence.deliveries.map((id) => <button key={id} onClick={() => select(id)}>{t("Evidence: {title}", { title: unitTitle(snapshot, id) })}</button>)}</div> : null}
              {evidence?.verifications.length ? <div className="contribution-badge">{t("Independent verification · {count}", { count: evidence.verifications.length })}{evidence.verifications.map((id) => <button key={id} onClick={() => select(id)}>{t("Evidence:")}{" "}{unitTitle(snapshot, id)}</button>)}</div> : null}
              <details className="crew-identity"><summary>{t("Execution identity")}</summary><code>{agent.id}</code></details>
            </article>;
          })}
          {!agents.some((agent) => laneOf(agent) === lane) ? <p className="small-muted">{t("No recorded crew in this stage.")}</p> : null}
        </div></section>)}
      </div> : <Empty title={t("The team takes shape with the work")}>{t("Agent events and assignments will appear when an orchestrator starts a run.")}</Empty>}
    </section>
    {agents.length ? <details className="surface crew-technical"><summary>{t("Agent details")}</summary><div className="agent-grid">
      {agents.map((agent) => <article className="agent-card" key={agent.id}><h2>{t(crewRole(snapshot, agent))}</h2><code>{agent.id}</code><p>{agent.purpose ?? t("Assigned specialist")}</p><div className="agent-facts"><div><span>{t("Model tier")}</span><strong>{agent.modelTier ? t(title(agent.modelTier)) : t("Not recorded")}</strong></div><div><span>{t("Assigned units")}</span><strong>{agent.units.length}</strong></div></div><p>{[agent.provider, agent.model].filter(Boolean).join(" / ") || t("Provider / model not recorded")}</p><footer>{t("Last recorded activity")}{" "}<span>{agent.lastEventAt ? time(agent.lastEventAt) : "—"}</span></footer></article>)}
    </div></details> : null}
  </>;
}
