import { useState } from "react";
import { motion } from "motion/react";
import { AnimatedPortrait, useMotionEnabled } from "./animations.js";
import { ArrowUpRight, ArrowRight, Check, Circle, Code2, FileText, GitBranch, Layers, LockKeyhole, Search, ShieldCheck, Users } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { t, useI18n } from "./i18n.js";
import { usePanelUI } from "./state.js";
import { eventTitle, time, unitTitle } from "./format.js";
import { Status } from "./ui.js";
import { activeTeam, unitActivity } from "./team-summary.js";
import { crewRole, crewRunFlag } from "./crew.js";
import { concise, crewPortrait, questDeliveries, questTitle, questUnits } from "./quest-model.js";
import "./quest.css";

export function Overview({ snapshot }: { snapshot: PanelSnapshot }) {
  useI18n();
  const selectUnit = usePanelUI(s => s.selectUnit), setView = usePanelUI(s => s.setView);
  const motionEnabled = useMotionEnabled();
  const connection = usePanelUI(s => s.connection);
  const liveRun = motionEnabled && snapshot.mode === "workspace" && connection === "live" && !snapshot.state.outcome && !snapshot.state.paused && !snapshot.control.paused && !snapshot.control.kill;
  const [selected, setSelected] = useState<string | null>(null);
  const units = questUnits(snapshot);
  const selectedId = selected && snapshot.state.units[selected] ? selected : units.find(([, unit]) => ["running", "verifying", "rework"].includes(unit.status))?.[0] ?? units[0]?.[0];
  const unit = selectedId ? snapshot.state.units[selectedId] : undefined;
  const definition = snapshot.spec?.units.find(value => value.id === selectedId);
  const accepted = units.filter(([, value]) => value.status === "accepted").length;
  const deliveries = questDeliveries(snapshot);
  const crew = activeTeam(snapshot);
  const flag = crewRunFlag(snapshot);
  return <div className="quest-layout">
    <div className="quest-main">
      <header className="quest-heading">
        <p className="quest-breadcrumb">{t("Workspace")} <span>›</span> {snapshot.mode === "recorded-demo" ? t("Recorded demo") : t("Current run")}</p>
        <div className="quest-title-row"><h1 title={snapshot.spec?.goal}>{questTitle(snapshot.spec?.goal ?? snapshot.state.runId ?? t("Your next great piece of work"))}</h1><button className="quest-icon-button" onClick={() => setView("workboard")} aria-label={t("Explore the workboard")}><ArrowUpRight size={20}/></button></div>
        <div className="quest-progress-row"><div className="quest-progress" role="progressbar" aria-label={t("Work accepted")} aria-valuemin={0} aria-valuemax={units.length || 1} aria-valuenow={accepted}>{units.length ? units.map(([id, value]) => <motion.span key={id} initial={false} animate={{ backgroundColor: value.status === "accepted" ? "#d9ef78" : "#393940" }} transition={{ duration: motionEnabled ? .45 : 0 }} className={value.status === "accepted" ? "is-accepted" : ""}/>) : <span/>}</div><span>{t("{accepted} of {count} units accepted", { accepted, count: units.length })}</span></div>
        {flag ? <p className="quest-run-flag">{flag}</p> : null}
      </header>
      {deliveries.length ? <section className="quest-deliveries" aria-label={t("Verified deliveries")}><h2><ShieldCheck size={24}/>{t("Verified deliveries")}</h2><div>{deliveries.slice(0, 3).map(id => <button key={id} onClick={() => setSelected(id)}><ShieldCheck size={28}/><span><strong>{unitTitle(snapshot, id)}</strong><small>{t("Independent verification recorded")}</small></span></button>)}</div></section> : null}
      <section className="quest-route" aria-label={t("Task route")}>
        {units.length ? <div className="quest-route-track">{units.map(([id, value], index) => {
          const activity = unitActivity(snapshot, id);
          const waiting = activity?.waitingOn.length;
          const busy = liveRun && ["running", "verifying"].includes(value.status);
          const kind = snapshot.spec?.units.find(spec => spec.id === id)?.type;
          const Icon = waiting ? LockKeyhole : value.status === "verifying" ? Search : kind === "content" ? FileText : kind === "infra" ? Layers : Code2;
          return <div className="quest-stop" key={id}><motion.button whileHover={motionEnabled ? { y: -3 } : undefined} whileTap={motionEnabled ? { scale: .97 } : undefined} className={`quest-node is-${value.status} ${selectedId === id ? "is-selected" : ""} ${unit?.dependsOn.includes(id) ? "is-dependency" : ""}`} aria-pressed={selectedId === id} onClick={() => setSelected(id)}><motion.span className="quest-platform" initial={false} animate={{ y: selectedId === id && motionEnabled ? -5 : 0, scale: selectedId === id && motionEnabled ? 1.06 : 1 }} transition={{ type: "spring", stiffness: 330, damping: 24 }}><img src="/assets/arcade/platform.png" alt=""/><Icon size={35}/>{busy ? <motion.span className="quest-activity-ring" aria-hidden="true" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: value.status === "verifying" ? 3 : 5, ease: "linear" }}/> : null}</motion.span><strong>{index + 1}. {unitTitle(snapshot, id)}</strong><span className="quest-node-status">{value.status === "accepted" ? <Check size={12}/> : null}{t(value.status.charAt(0).toUpperCase() + value.status.slice(1))}</span></motion.button><p>{activity?.readiness ?? (value.status === "accepted" ? t("Acceptance recorded") : t("Inspect task details"))}</p>{units[index + 1]?.[1].dependsOn.includes(id) ? <ArrowRight className="quest-route-arrow" size={28} aria-hidden="true"/> : null}</div>;
        })}</div> : <div className="quest-empty"><Layers size={36}/><h2>{t("Your route starts here")}</h2><p>{t("Recorded tasks will appear as the team takes shape.")}</p><button onClick={() => setView("mission")}>{t("Mission")}</button></div>}
      </section>
      <section className="quest-crew"><div className="quest-section-heading"><h2><Users size={20}/>{t("Team")}</h2><button onClick={() => setView("team")}>{t("Meet the team")}<ArrowUpRight size={15}/></button></div>{crew.length ? <div className="quest-crew-grid">{crew.slice(0, 3).map((agent, index) => <motion.button initial={motionEnabled ? { opacity: 0, y: 14 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: motionEnabled ? .35 : 0, delay: motionEnabled ? index * .07 : 0 }} whileHover={motionEnabled ? { y: -4 } : undefined} whileTap={motionEnabled ? { scale: .98 } : undefined} className="quest-crew-card" key={agent.id} onClick={() => agent.units[0] ? setSelected(agent.units[0]) : setView("team")}><AnimatedPortrait className="quest-crew-portrait" src={crewPortrait(snapshot, agent)} active={liveRun && ["working", "verifying"].includes(agent.status)} alt=""/><span><span className="quest-crew-status">{flag ?? t(agent.status.charAt(0).toUpperCase() + agent.status.slice(1))}</span><strong>{agent.units[0] ? unitTitle(snapshot, agent.units[0]) : t("Whole-project review")}</strong><small>{t(crewRole(snapshot, agent))}</small><p>{concise(agent.purpose ?? t("Agent assignments and activity from the ledger. Process liveness is not measured."), 100)}</p></span></motion.button>)}</div> : <p className="small-muted">{t("Agents appear when assignments or agent events are recorded.")}</p>}</section>
      <section className="quest-events"><h2>{t("Latest activity")}</h2>{snapshot.events.length ? snapshot.events.slice(-3).reverse().map(event => <button key={event.seq} onClick={() => event.unit_id ? setSelected(event.unit_id) : setView("activity")}><span className="quest-event-icon"><FileText size={19}/></span><span><strong>{eventTitle(event)}</strong><small>{event.unit_id ? unitTitle(snapshot, event.unit_id) : event.actor}</small></span><time dateTime={event.ts}>{time(event.ts)}</time></button>) : <p>{t("The first recorded event will appear here.")}</p>}</section>
    </div>
    <aside className="quest-aside">
      <motion.section key={selectedId ?? "empty"} initial={motionEnabled ? { opacity: .5, x: 8 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: motionEnabled ? .2 : 0 }} className="quest-inspector" aria-label={t("Task inspector")}>
        {unit && selectedId ? <><header><span className="quest-inspector-icon"><Search size={34}/></span><div><h2>{unitTitle(snapshot, selectedId)}</h2><p>{t("Task {number}", { number: units.findIndex(([id]) => id === selectedId) + 1 })}</p><Status value={unit.status}/></div></header><div className="quest-inspector-body"><p className="quest-description">{definition?.description ? concise(definition.description, 160) : t("No specification recorded")}</p><section><h3>{t("Acceptance criteria")}</h3>{definition?.acceptance.length ? <ul className="quest-criteria">{definition.acceptance.slice(0, 3).map((criterion, index) => <li key={index}><Circle size={17}/><span>{concise(criterion, 100)}</span></li>)}</ul> : <p>{t("No acceptance criteria recorded")}</p>}</section><section><h3><GitBranch size={16}/>{t("Dependencies")}</h3>{unit.dependsOn.length ? unit.dependsOn.map(id => <button className="quest-dependency" key={id} onClick={() => setSelected(id)}><ArrowUpRight size={21}/><span><strong>{unitTitle(snapshot, id)}</strong><small>{snapshot.state.units[id] ? t(snapshot.state.units[id]!.status.charAt(0).toUpperCase() + snapshot.state.units[id]!.status.slice(1)) : t("Not recorded")}</small></span></button>) : <p>{t("No dependencies")}</p>}</section>{definition?.owns.length ? <section><h3><FileText size={16}/>{t("Owned scope")}</h3><div className="quest-owned">{definition.owns.map(path => <code key={path}>{path}</code>)}</div></section> : null}</div><button className="quest-inspect-button" onClick={() => selectUnit(selectedId)}>{t("Inspect evidence")}<ArrowUpRight size={18}/></button></> : <div className="quest-inspector-empty"><Search size={30}/><h2>{t("Task inspector")}</h2><p>{t("Choose a task to inspect its recorded evidence.")}</p></div>}
      </motion.section>
    </aside>
  </div>;
}
