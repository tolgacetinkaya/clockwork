import { Check, Layers, ArrowUpRight } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { title, time, unitTitle } from "./format.js";
import { usePanelUI } from "./state.js";
import { Avatar, Empty, Status } from "./ui.js";
import { PageHeading } from "./work.js";

export function Team({ snapshot }: { snapshot: PanelSnapshot }) {
  const select = usePanelUI((s) => s.selectUnit);
  return (
    <>
      <PageHeading
        eyebrow="THE ASSEMBLED TEAM"
        title="Specialists, with a shared purpose."
        subtitle="Agent assignments and activity from the ledger. Process liveness is not measured."
      />
      {snapshot.agents.length ? (
        <div className="agent-grid">
          {snapshot.agents.map((agent, index) => (
            <article className="agent-card" key={agent.id}>
              <div className="agent-card-top">
                <Avatar name={agent.id} index={index} />
                <span className="agent-number">
                  AGENT {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h2>{title(agent.id)}</h2>
              <code>{agent.id}</code>
              <p>
                {agent.purpose ??
                  "A specialist assigned to the work in this run."}
              </p>
              {snapshot.state.outcome ? (
                <span className="status status-completed">
                  <Check size={13} />
                  Run complete
                </span>
              ) : (
                <Status value={agent.status} />
              )}
              <div className="agent-facts">
                <div>
                  <span>Model tier</span>
                  <strong>
                    {agent.modelTier ? title(agent.modelTier) : "Not recorded"}
                  </strong>
                </div>
                <div>
                  <span>Assigned units</span>
                  <strong>{agent.units.length}</strong>
                </div>
              </div>
              <div className="agent-assignments">
                {agent.units.map((id) => (
                  <button onClick={() => select(id)} key={id}>
                    <Layers size={13} />
                    {unitTitle(snapshot, id)}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
              <footer>
                Last recorded activity{" "}
                <span>{agent.lastEventAt ? time(agent.lastEventAt) : "—"}</span>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="The team takes shape with the work">
          Agent events and assignments will fill this space when an orchestrator
          starts a run.
        </Empty>
      )}
    </>
  );
}
