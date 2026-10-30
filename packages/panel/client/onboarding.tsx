import { ArrowRight, CheckCircle2, FileCheck2, FolderGit2, ListTodo, Terminal, Users } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { t, useI18n } from "./i18n.js";
import { usePanelUI } from "./state.js";
import "./onboarding.css";

export const workspacePanelCommand = 'node "/path/to/clockwork/node_modules/tsx/dist/cli.mjs" "/path/to/clockwork/packages/cli/src/bin.ts" ui --enable-execution --port 47833';

export function Onboarding({ snapshot }: { snapshot?: PanelSnapshot }) {
  useI18n();
  const setView = usePanelUI(state => state.setView);
  const demo = snapshot?.mode === "recorded-demo";
  const enabled = snapshot?.mode === "workspace" && snapshot.launch?.enabled;
  const steps = [
    { icon: FolderGit2, title: "1. Connect your project", body: "The project is the Git workspace used to start this panel. Choose it in your terminal." },
    { icon: ListTodo, title: "2. Describe the work", body: "Planning is manual: write a goal, then add tasks, owned files, dependencies and acceptance evidence." },
    { icon: CheckCircle2, title: "3. Save, review and start", body: "Saving does not run agents. Review the plan, approve it, then start explicitly." },
    { icon: Users, title: "4. Follow the crew", body: "Tasks show delivery progress. The team shows who produced and independently checked the work." },
    { icon: FileCheck2, title: "5. Check the whole result", body: "Inspect combined verification evidence before treating the project as ready." },
  ];
  return <div className="workflow-start">
    <header className="workflow-hero"><p className="eyebrow">{t("Start here")}</p><h1>{t("One project. One reviewed mission.")}</h1><p>{t("Clockwork runs your task plan with local AI agents and checks the combined result.")}</p><p>{t("Follow these five steps to turn a project goal into checked work.")}</p><span className={`workflow-mode ${enabled ? "is-enabled" : ""}`} role="status">{demo ? t("Read-only demo") : enabled ? t("Local execution available") : t("Local execution is not enabled")}</span>
      {demo ? <p className="workflow-mode-note">{t("This Docker demo shows recorded work and cannot start agents.")}</p> : null}
      {enabled ? <button className="primary-button" onClick={() => setView("mission")}>{t("Open mission planning")}<ArrowRight size={16}/></button> : <a className="primary-button" href="#workspace-setup">{t("Connect a workspace first")}<ArrowRight size={16}/></a>}
      {demo ? <nav className="workflow-demo-nav" aria-label={t("Recorded demo")}><button onClick={() => setView("overview")}>{t("Explore recorded run")}<ArrowRight size={14}/></button><button onClick={() => setView("team")}>{t("See the team")}<Users size={14}/></button><button onClick={() => setView("workboard")}>{t("Open task board")}<ListTodo size={14}/></button></nav> : null}
    </header>
    <ol className="workflow-steps" aria-label={t("Getting started")}>{steps.map(({icon: Icon,title,body}) => <li key={title}><span className="workflow-step-icon"><Icon size={23}/></span><div><h2>{t(title)}</h2><p>{t(body)}</p></div></li>)}</ol>
    <div className="workflow-reference"><section className="workflow-setup" id="workspace-setup"><div><Terminal size={21}/><h2>{t("Project setup")}</h2></div><p>{t("Run from your clean project directory")}</p><pre><code>{workspacePanelCommand}</code></pre><p>{t("Replace the Clockwork path with your checkout path. Keep the terminal running while using the panel.")}</p><p className="workflow-browser-note">{t("No project folder is uploaded or selected in this browser.")}</p><details><summary>{t("Requirements and setup details")}</summary><p>{t("Use an existing clean Git repository, a configured local Codex CLI and Node.js 24+. Clockwork dependencies and the panel build must already be installed.")}</p></details></section>
    <section className="workflow-glossary"><h2>{t("Words you will see")}</h2><dl><div><dt>{t("Task")}</dt><dd>{t("A bounded piece of work with owned files and checks.")}</dd></div><div><dt>{t("Agent")}</dt><dd>{t("A local provider session assigned to produce work.")}</dd></div><div><dt>{t("Verifier")}</dt><dd>{t("A separate session that checks evidence without editing files.")}</dd></div></dl></section></div>
  </div>;
}
