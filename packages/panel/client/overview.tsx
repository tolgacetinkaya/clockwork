import { t, useI18n } from "./i18n.js";
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
  useI18n();
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
            <span className="tiny-square" />{t("YOUR WORKSPACE, IN SYNC")}</p>
          <h1>{t("Your team,")}<br />
            <em>{t("in motion.")}</em>
          </h1>
          <p className="hero-description">{t("Every work unit, handoff, and decision.")}<br className="hidden sm:block" />{t("A clear view of the work as it unfolds.")}</p>
          <button
            className="primary-button"
            onClick={() => setView("workboard")}
          >{t("Explore the workboard")}<ArrowUpRight size={16} />
          </button>
        </div>
        <div className="run-brief">
          <div className="run-brief-top">
            <span className="eyebrow">{t("CURRENT RUN")}</span>
            <span
              className={`run-pill ${snapshot.state.outcome === "done" ? "complete" : ""}`}
            >
              <span />
              {snapshot.state.outcome === "done"
                ? t("Complete")
                : snapshot.state.phase
                  ? t(title(snapshot.state.phase))
                  : t("Awaiting a run")}
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
                : t("Your next great piece of work"))}
          </h2>
          <p className="run-id">{snapshot.state.runId ?? t("No run started")}</p>
          <div
            className="run-progress"
            aria-label={t("{accepted} of {count} work units accepted", { accepted, count: units.length })}
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
              {t("{accepted} of {count} units accepted", { accepted, count: units.length })}</span>
            <span>{t("Spec")}{" "}
              {snapshot.state.specVersion
                ? `v${snapshot.state.specVersion}`
                : t("not recorded")}
            </span>
          </div>
        </div>
      </section>
      <section className="metrics-strip" aria-label={t("Run metrics")}>
        <button
          onClick={() => {
            setFilter("accepted");
            setView("workboard");
          }}
        >
          <span className="metric-label">
            <ShieldCheck size={15} />{t("Work accepted")}</span>
          <strong>
            {String(accepted).padStart(2, "0")}
            <small>/ {String(units.length).padStart(2, "0")}</small>
          </strong>
          <span className="metric-detail">
            {units.length
              ? t("{percent}% of this run", { percent: Math.round((accepted / units.length) * 100) })
              : t("Ready when you are")}
          </span>
        </button>
        <button
          onClick={() => {
            setFilter("active");
            setView("workboard");
          }}
        >
          <span className="metric-label">
            <Activity size={15} />{t("Active work")}</span>
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
              ? t("Executing or in verification")
              : t("No units currently executing")}
          </span>
        </button>
        <div>
          <span className="metric-label">
            <Layers size={15} />{t("Recorded usage")}</span>
          <strong>
            {compact(snapshot.budget.totalSpent)}
            <small>{" "}{t("tokens")}</small>
          </strong>
          <span
            className={`metric-detail ${spentPercent !== null && spentPercent > 100 ? "warning-text" : ""}`}
          >
            {spentPercent === null
              ? t("No budget target recorded")
              : t("{percent}% of {target} target", { percent: spentPercent, target: compact(snapshot.budget.target!) })}
          </span>
        </div>
        <button onClick={() => setView("decisions")}>
          <span className="metric-label">
            <Inbox size={15} />{t("Needs your input")}</span>
          <strong>
            {String(decisions).padStart(2, "0")}
            <ArrowUpRight size={19} />
          </strong>
          <span className="metric-detail">
            {decisions ? t("Keep the work moving") : t("Nothing waiting on you")}
          </span>
        </button>
      </section>
      <div className="overview-columns">
        <div className="min-w-0">
          <section className="surface work-surface">
            <SectionHeading
              eyebrow={t("THE WORK")}
              title={t("One team. Moving parts.")}
              action={
                <TextLink onClick={() => setView("workboard")}>{t("All work")}</TextLink>
              }
            />
            <WorkList snapshot={snapshot} />
            <div className="surface-footer">
              <span>
                <GitBranch size={13} />{t("Dependencies guide the order of work")}</span>
              <button onClick={() => setView("activity")}>{t("View handoffs")}<ArrowRight size={13} />
              </button>
            </div>
          </section>
          <section className="activity-preview">
            <SectionHeading
              eyebrow={t("THE PAPER TRAIL")}
              title={t("Latest from the run")}
              action={
                <TextLink onClick={() => setView("activity")}>{t("All activity")}</TextLink>
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
                      : t("Recorded by {actor}", { actor: lastEvent.actor })}
                  </p>
                </div>
                <time dateTime={lastEvent.ts}>{time(lastEvent.ts)}</time>
              </div>
            ) : (
              <p className="muted">{t("The first recorded event will appear here.")}</p>
            )}
          </section>
        </div>
        <aside className="overview-aside">
          <section className="surface team-preview">
            <SectionHeading
              eyebrow={t("THE SPECIALISTS")}
              title={t("Your assembled team")}
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
                          ? t("Run complete")
                          : agent.status === "idle"
                            ? t("No active work recorded")
                            : t(title(agent.status))}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="aside-copy">{t("Agents appear when assignments or agent events are recorded.")}</p>
            )}
            <button className="full-link" onClick={() => setView("team")}>{t("Meet the team")}<ArrowRight size={15} />
            </button>
          </section>
          <section className="operator-card">
            <span className="operator-symbol">
              <Terminal size={19} />
            </span>
            <p className="eyebrow">{t("YOU'RE PART OF THE LOOP")}</p>
            <h3>{t("A nudge in the")}<br />
              <em>{t("right direction.")}</em>
            </h3>
            <p>{t("Leave context for the orchestrator without interrupting your view of the work.")}</p>
            <button
              className="secondary-button"
              onClick={() => setDrawer("note")}
            >
              <Plus size={15} />{t("Add a note")}</button>
          </section>
        </aside>
      </div>
      <section className="usage-section">
        <SectionHeading
          eyebrow={t("RESOURCE AWARE")}
          title={t("Where the effort goes")}
          action={
            <span className="small-muted">{t("Tokens, not a billing estimate")}</span>
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
            <p className="muted">{t("Usage appears when budget events are recorded.")}</p>
          )}
        </div>
        {snapshot.budget.unattributed > 0 ? (
          <p className="small-muted mt-4">
            {t("{count} tokens are not attributed to a work unit.", { count: number(snapshot.budget.unattributed) })}</p>
        ) : null}
      </section>
    </>
  );
}
