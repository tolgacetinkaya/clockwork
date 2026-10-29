import {
  ArrowUpRight,
  ArrowRight,
  Activity,
  Check,
  ChevronRight,
  GitBranch,
  Inbox,
  Layers,
  Plus,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { usePanelUI } from "./state.js";
import {
  compact,
  title,
  time,
  number,
  eventTitle,
  unitTitle,
} from "./format.js";
import { Avatar, SectionHeading, TextLink } from "./ui.js";
import { WorkList } from "./work.js";

export function Overview({ snapshot }: { snapshot: PanelSnapshot }) {
  const setView = usePanelUI((s) => s.setView),
    setFilter = usePanelUI((s) => s.setFilter),
    setDrawer = usePanelUI((s) => s.setDrawer);
  const units = Object.entries(snapshot.state.units);
  const accepted = units.filter(([, u]) => u.status === "accepted").length;
  const active = units.filter(([, u]) =>
    ["running", "verifying", "rework"].includes(u.status),
  ).length;
  const decisions =
    snapshot.state.pendingQuestions.length +
    snapshot.state.openCheckpoints.length;
  const spentPercent = snapshot.budget.target
    ? Math.round((snapshot.budget.totalSpent / snapshot.budget.target) * 100)
    : null;
  const lastEvent = snapshot.events.at(-1);
  return (
    <>
      <section className="overview-hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="tiny-square" /> YOUR WORKSPACE, IN SYNC
          </p>
          <h1>
            Your team,
            <br />
            <em>in motion.</em>
          </h1>
          <p className="hero-description">
            Every work unit, handoff, and decision.
            <br className="hidden sm:block" /> A clear view of the work as it
            unfolds.
          </p>
          <button
            className="primary-button"
            onClick={() => setView("workboard")}
          >
            Explore the workboard <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="run-brief">
          <div className="run-brief-top">
            <span className="eyebrow">CURRENT RUN</span>
            <span
              className={`run-pill ${snapshot.state.outcome === "done" ? "complete" : ""}`}
            >
              <span />
              {snapshot.state.outcome === "done"
                ? "Complete"
                : snapshot.state.phase
                  ? title(snapshot.state.phase)
                  : "Awaiting a run"}
            </span>
          </div>
          <div className="run-orbit" aria-hidden="true">
            <div className="orbit-line" />
            <div className="orbit-center">
              <Layers size={24} />
            </div>
            {units.slice(0, 6).map(([, unit], index) => (
              <span
                key={index}
                className={`orbit-node node-${index} ${unit.status === "accepted" ? "accepted" : ""}`}
              >
                {unit.status === "accepted" ? <Check size={12} /> : <span />}
              </span>
            ))}
          </div>
          <h2>
            {snapshot.spec?.goal ??
              (snapshot.state.runId
                ? title(snapshot.state.runId.replace(/^run-/, ""))
                : "Your next great piece of work")}
          </h2>
          <p className="run-id">{snapshot.state.runId ?? "No run started"}</p>
          <div
            className="run-progress"
            aria-label={`${accepted} of ${units.length} work units accepted`}
          >
            {units.length ? (
              units.map(([id, unit]) => (
                <span
                  key={id}
                  className={
                    unit.status === "accepted"
                      ? "filled"
                      : ["running", "verifying", "rework"].includes(unit.status)
                        ? "working"
                        : ""
                  }
                />
              ))
            ) : (
              <span />
            )}
          </div>
          <div className="run-brief-footer">
            <span>
              {accepted} of {units.length} units accepted
            </span>
            <span>
              Spec{" "}
              {snapshot.state.specVersion
                ? `v${snapshot.state.specVersion}`
                : "not recorded"}
            </span>
          </div>
        </div>
      </section>
      <section className="metrics-strip" aria-label="Run metrics">
        <button
          onClick={() => {
            setFilter("accepted");
            setView("workboard");
          }}
        >
          <span className="metric-label">
            <ShieldCheck size={15} /> Work accepted
          </span>
          <strong>
            {String(accepted).padStart(2, "0")}
            <small>/ {String(units.length).padStart(2, "0")}</small>
          </strong>
          <span className="metric-detail">
            {units.length
              ? `${Math.round((accepted / units.length) * 100)}% of this run`
              : "Ready when you are"}
          </span>
        </button>
        <button
          onClick={() => {
            setFilter("active");
            setView("workboard");
          }}
        >
          <span className="metric-label">
            <Activity size={15} /> Active work
          </span>
          <strong>
            {String(active).padStart(2, "0")}
            <span className="metric-dots">
              <i />
              <i />
              <i />
            </span>
          </strong>
          <span className="metric-detail">
            {active
              ? "Executing or in verification"
              : "No units currently executing"}
          </span>
        </button>
        <div>
          <span className="metric-label">
            <Layers size={15} /> Recorded usage
          </span>
          <strong>
            {compact(snapshot.budget.totalSpent)}
            <small> tokens</small>
          </strong>
          <span
            className={`metric-detail ${spentPercent !== null && spentPercent > 100 ? "warning-text" : ""}`}
          >
            {spentPercent === null
              ? "No budget target recorded"
              : `${spentPercent}% of ${compact(snapshot.budget.target!)} target`}
          </span>
        </div>
        <button onClick={() => setView("decisions")}>
          <span className="metric-label">
            <Inbox size={15} /> Needs your input
          </span>
          <strong>
            {String(decisions).padStart(2, "0")}
            <ArrowUpRight size={19} />
          </strong>
          <span className="metric-detail">
            {decisions ? "Keep the work moving" : "Nothing waiting on you"}
          </span>
        </button>
      </section>
      <div className="overview-columns">
        <div className="min-w-0">
          <section className="surface work-surface">
            <SectionHeading
              eyebrow="THE WORK"
              title="One team. Moving parts."
              action={
                <TextLink onClick={() => setView("workboard")}>
                  All work
                </TextLink>
              }
            />
            <WorkList snapshot={snapshot} />
            <div className="surface-footer">
              <span>
                <GitBranch size={13} /> Dependencies guide the order of work
              </span>
              <button onClick={() => setView("activity")}>
                View handoffs <ArrowRight size={13} />
              </button>
            </div>
          </section>
          <section className="activity-preview">
            <SectionHeading
              eyebrow="THE PAPER TRAIL"
              title="Latest from the run"
              action={
                <TextLink onClick={() => setView("activity")}>
                  All activity
                </TextLink>
              }
            />
            {lastEvent ? (
              <div className="latest-event">
                <span className="timeline-dot" />
                <div>
                  <strong>{eventTitle(lastEvent)}</strong>
                  <p>
                    {lastEvent.unit_id
                      ? unitTitle(snapshot, lastEvent.unit_id)
                      : `Recorded by ${lastEvent.actor}`}
                  </p>
                </div>
                <time dateTime={lastEvent.ts}>{time(lastEvent.ts)}</time>
              </div>
            ) : (
              <p className="muted">
                The first recorded event will appear here.
              </p>
            )}
          </section>
        </div>
        <aside className="overview-aside">
          <section className="surface team-preview">
            <SectionHeading
              eyebrow="THE SPECIALISTS"
              title="Your assembled team"
              action={
                <span className="count-pill">{snapshot.agents.length}</span>
              }
            />
            {snapshot.agents.length ? (
              <div className="team-compact">
                {snapshot.agents.slice(0, 4).map((agent, index) => (
                  <button key={agent.id} onClick={() => setView("team")}>
                    <Avatar name={agent.id} index={index} />
                    <span>
                      <strong>{title(agent.id)}</strong>
                      <small>
                        {snapshot.state.outcome
                          ? "Run complete"
                          : agent.status === "idle"
                            ? "No active work recorded"
                            : title(agent.status)}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="aside-copy">
                Agents appear when assignments or agent events are recorded.
              </p>
            )}
            <button className="full-link" onClick={() => setView("team")}>
              Meet the team <ArrowRight size={15} />
            </button>
          </section>
          <section className="operator-card">
            <span className="operator-symbol">
              <Terminal size={19} />
            </span>
            <p className="eyebrow">YOU'RE PART OF THE LOOP</p>
            <h3>
              A nudge in the
              <br />
              <em>right direction.</em>
            </h3>
            <p>
              Leave context for the orchestrator without interrupting your view
              of the work.
            </p>
            <button
              className="secondary-button"
              onClick={() => setDrawer("note")}
            >
              <Plus size={15} /> Add a note
            </button>
          </section>
        </aside>
      </div>
      <section className="usage-section">
        <SectionHeading
          eyebrow="RESOURCE AWARE"
          title="Where the effort goes"
          action={
            <span className="small-muted">Tokens, not a billing estimate</span>
          }
        />
        <div className="usage-allocation">
          {snapshot.budget.units.length ? (
            snapshot.budget.units.map((line, index) => (
              <div key={line.unit}>
                <div>
                  <span className={`allocation-dot dot-${index % 5}`} />
                  <span>{title(line.unit)}</span>
                  <strong>{compact(line.spent)}</strong>
                </div>
                <div className="allocation-track">
                  <span
                    className={`allocation-fill dot-${index % 5}`}
                    style={{
                      width: `${Math.max(1, snapshot.budget.totalSpent ? (line.spent / snapshot.budget.totalSpent) * 100 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="muted">
              Usage appears when budget events are recorded.
            </p>
          )}
        </div>
        {snapshot.budget.unattributed > 0 ? (
          <p className="small-muted mt-4">
            {number(snapshot.budget.unattributed)} tokens are not attributed to
            a work unit.
          </p>
        ) : null}
      </section>
    </>
  );
}
