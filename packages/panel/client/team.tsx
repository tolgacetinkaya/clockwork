import { ArrowUpRight } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { title, time, unitTitle } from "./format.js";
import { usePanelUI } from "./state.js";
import { Avatar, Empty, Status } from "./ui.js";
import { activeTeam, teamSummary, unitActivity } from "./team-summary.js";
import { crewContributions, crewRole, crewRunFlag, finalReviewOutcome } from "./crew.js";
import { PageHeading } from "./work.js";

export function Team({ snapshot }: { snapshot: PanelSnapshot }) {
  const select = usePanelUI((s) => s.selectUnit);
  const summary = teamSummary(snapshot);
  const agents = activeTeam(snapshot);
  const contributions = crewContributions(snapshot);
  const flag = crewRunFlag(snapshot);
  const laneOf = (agent: typeof agents[number]) => flag ? "Recorded crew" : agent.status === "working" ? "Production" : agent.status === "verifying" ? "Verification" : "Standby & completed";
  const lanes = flag ? ["Recorded crew"] : ["Production", "Verification", "Standby & completed"];
  return <>
    <PageHeading eyebrow="THE ASSEMBLED TEAM" title="Specialists, with a shared purpose." subtitle="Agent assignments and activity from the ledger. Process liveness is not measured." />
    {flag ? <p className="crew-run-flag" role="status">{flag} · Crew cards show recorded work.</p> : null}
    <div className="team-summary" aria-label="Recorded team activity">
      <span><strong>{summary.producers}</strong> Active producers</span>
      <span><strong>{summary.verifiers}</strong> Active verifiers</span>
      <span><strong>{summary.waiting}</strong> Units waiting on dependencies</span>
    </div>
    <section className="crew-section" aria-label="Crew roles and contributions">
      <h2>The crew, at a glance</h2>
      <p className="small-muted">Badges count unique accepted tasks with producer and independent verifier evidence in the latest {snapshot.events.length} recorded events. They do not imply integration or combined verification passed.</p>
      {agents.length ? <div className={`crew-lanes ${flag ? "crew-recorded" : ""}`}>
        {lanes.map((lane) => <section className="crew-lane" key={lane}><h3>{lane}</h3>
          {agents.filter((agent) => laneOf(agent) === lane).map((agent, index) => {
            const evidence = contributions.get(agent.id);
            const role = crewRole(snapshot, agent);
            const missions = agent.units.filter((id) => unitActivity(snapshot, id)?.actors.some((actor) => actor.id === agent.id));
            const shownUnits = missions.length ? missions : agent.units;
            const reviewOutcome = role === "Final review" ? finalReviewOutcome(snapshot, agent.id) : null;
            return <article className="crew-member" key={agent.id}>
              <header className="crew-member-header"><Avatar name={role} index={index} small /><span className="crew-role">{role}</span>{flag ? <span className="small-muted">{flag}</span> : <Status value={agent.status} />}</header>
              {role === "Final review" ? <h4>Whole-project review</h4> : shownUnits.length ? shownUnits.map((id) => <button className="crew-mission" key={id} onClick={() => select(id)}>{snapshot.spec?.units.find((unit) => unit.id === id)?.description ?? unitTitle(snapshot, id)} <small>{id}</small><ArrowUpRight size={12} /></button>) : <p>{agent.purpose ?? "Awaiting a recorded task"}</p>}
              {reviewOutcome ? <p className="crew-review-outcome">{reviewOutcome}</p> : null}
              {missions.map((id) => <p className="small-muted" key={id}>{unitActivity(snapshot, id)?.readiness}</p>)}
              {role === "Final review" ? <p className="small-muted">Independent acceptance checks over the combined integration workspace.</p> : null}
              <p className="crew-provider">{[agent.provider, agent.model].filter(Boolean).join(" / ") || "Provider / model not recorded"}</p>
              <p className="small-muted">Last recorded activity {agent.lastEventAt ? time(agent.lastEventAt) : "not recorded"}</p>
              {evidence?.deliveries.length ? <div className="contribution-badge">Accepted delivery · {evidence.deliveries.length}{evidence.deliveries.map((id) => <button key={id} onClick={() => select(id)}>Evidence: {unitTitle(snapshot, id)}</button>)}</div> : null}
              {evidence?.verifications.length ? <div className="contribution-badge">Independent verification · {evidence.verifications.length}{evidence.verifications.map((id) => <button key={id} onClick={() => select(id)}>Evidence: {unitTitle(snapshot, id)}</button>)}</div> : null}
              <details className="crew-identity"><summary>Execution identity</summary><code>{agent.id}</code></details>
            </article>;
          })}
          {!agents.some((agent) => laneOf(agent) === lane) ? <p className="small-muted">No recorded crew in this stage.</p> : null}
        </section>)}
      </div> : <Empty title="The team takes shape with the work">Agent events and assignments will appear when an orchestrator starts a run.</Empty>}
    </section>
    {agents.length ? <details className="surface crew-technical"><summary>Agent details</summary><div className="agent-grid">
      {agents.map((agent) => <article className="agent-card" key={agent.id}><h2>{crewRole(snapshot, agent)}</h2><code>{agent.id}</code><p>{agent.purpose ?? "Assigned specialist"}</p><div className="agent-facts"><div><span>Model tier</span><strong>{agent.modelTier ? title(agent.modelTier) : "Not recorded"}</strong></div><div><span>Assigned units</span><strong>{agent.units.length}</strong></div></div><p>{[agent.provider, agent.model].filter(Boolean).join(" / ") || "Provider / model not recorded"}</p><footer>Last recorded activity <span>{agent.lastEventAt ? time(agent.lastEventAt) : "—"}</span></footer></article>)}
    </div></details> : null}
  </>;
}
