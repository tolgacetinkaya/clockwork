import { t, useI18n, locales, localeNames } from "./i18n.js";
import {
  LayoutDashboard,
  Columns3,
  Users,
  Activity,
  Inbox,
  ChevronRight,
  Terminal,
  ExternalLink,
  WifiOff,
  LoaderCircle,
  Plus,
  Pause,
  Play,
  Square,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PanelSnapshot, ControlState } from "../src/protocol.js";
import { usePanelUI } from "./state.js";
import { Mark } from "./ui.js";
const navigation = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "mission", label: "Mission control", Icon: Play },
  { id: "workboard", label: "Workboard", Icon: Columns3 },
  { id: "team", label: "Team", Icon: Users },
  { id: "activity", label: "Activity", Icon: Activity },
  { id: "decisions", label: "Decisions", Icon: Inbox },
] as const;
export function Layout({
  snapshot,
  disabled,
  controlBusy,
  changeControl,
  children,
}: {
  snapshot?: PanelSnapshot;
  disabled: boolean;
  controlBusy: boolean;
  changeControl: (patch: Partial<ControlState>) => void;
  children: ReactNode;
}) {
  const { locale, setLocale } = useI18n();
  const view = usePanelUI((s) => s.view),
    setView = usePanelUI((s) => s.setView),
    connection = usePanelUI((s) => s.connection),
    setDrawer = usePanelUI((s) => s.setDrawer);
  const decisions = snapshot
    ? snapshot.state.pendingQuestions.length +
      snapshot.state.openCheckpoints.length
    : 0;
  const requested = snapshot?.control.kill
    ? t("Stop requested")
    : snapshot?.control.paused
      ? t("Pause requested")
      : snapshot?.state.paused
        ? t("Paused in ledger")
        : null;
  const canResume =
    snapshot?.control.paused ||
    snapshot?.control.kill ||
    snapshot?.state.paused;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            setView("overview");
          }}
          aria-label={t("Clockwork overview")}
        >
          <Mark />
          <span>
            clockwork<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-selector">
          <span className="workspace-icon">
            <Terminal size={17} />
          </span>
          <span>
            <strong>{t("Local workspace")}</strong>
            <small>
              {snapshot?.mode === "recorded-demo"
                ? t("Recorded demo")
                : t("Local project")}
            </small>
          </span>
          <ChevronRight size={14} />
        </div>
        <p className="sidebar-label">{t("WORKSPACE")}
            </p>
        <nav aria-label={t("Workspace navigation")}>
          {navigation.map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{t(label)}
            </span>
              {id === "decisions" && decisions ? (
                <span className="nav-count">{decisions}</span>
              ) : id === "activity" && connection === "live" ? (
                <span className="nav-live" />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <label className="language-selector">
            <span>{t("Language")}
            </span>
            <select
              value={locale}
              onChange={(event) => {
                const next = locales.find((item) => item === event.target.value);
                if (next) setLocale(next);
              }}
            >
              {locales.map((item) => (
                <option key={item} value={item} lang={item === "pt" ? "pt-BR" : item}>
                  {localeNames[item]}
                </option>
              ))}
            </select>
          </label>
          <div className="local-note">
            <span className="local-dot" />
            <div>
              <strong>{t("Yours, locally.")}</strong>
              <p>
                {t("Your workspace stays on this machine.")}
              </p>
            </div>
          </div>
          <a
            href="https://github.com/tolgacetinkaya/clockwork"
            target="_blank"
            rel="noreferrer"
            className="repository-link"
          >
            <Mark small />
            <span>{t("Open-source, open-ended.")}
            </span>
            <ExternalLink size={13} />
          </a>
          <div className="sidebar-version">
            <span>Clockwork</span>
            <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{t("Workspace")}
            </span>
            <ChevronRight size={13} />
            <strong>
              {t(navigation.find((item) => item.id === view)?.label ?? "Overview")}
            </strong>
          </div>
          <div className="topbar-actions">
            <span
              className={`connection connection-${connection}`}
              role="status"
            >
              {connection === "live" ? (
                <span className="live-dot" />
              ) : connection === "connecting" ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <WifiOff size={13} />
              )}
              <span>
                {connection === "live"
                  ? t("Live sync")
                  : connection === "connecting"
                    ? t("Connecting")
                    : connection === "reconnecting"
                      ? t("Reconnecting")
                      : t("Data is stale")}
              </span>
            </span>
            <span className="topbar-divider" />
            <span className="operator-avatar" title={t("Local operator")}>
              {t("YOU")}
            </span>
          </div>
        </header>
        <main id="main-content">
          <div className="context-bar">
            <span>
              <span className="context-dot" />
              {snapshot?.mode === "recorded-demo"
                ? t("RECORDED DEMO")
                : t("LOCAL ORCHESTRATION")}
              <span className="context-slash">/</span>
              <span className="context-run">
                {snapshot?.state.runId ?? t("Waiting for a run")}
              </span>
            </span>
            <div className="run-actions">
              {requested ? (
                <span className="requested-state">{requested}</span>
              ) : null}
              {canResume ? (
                <button
                  className="quiet-button"
                  disabled={disabled || controlBusy}
                  onClick={() => changeControl({ paused: false, kill: false })}
                >
                  <Play size={14} />
                  {t("Resume")}
                </button>
              ) : (
                <button
                  className="quiet-button"
                  disabled={disabled || controlBusy}
                  onClick={() => changeControl({ paused: true })}
                >
                  <Pause size={14} />
                  {t("Pause")}
                </button>
              )}
              <button
                className="icon-button stop-button"
                title={t("Request stop")}
                aria-label={t("Request stop")}
                disabled={
                  disabled || controlBusy || Boolean(snapshot?.control.kill)
                }
                onClick={() => setDrawer("stop")}
              >
                <Square size={13} />
              </button>
              <button
                className="secondary-button note-button"
                onClick={() => setDrawer("note")}
              >
                <Plus size={14} />
                {t("Add note")}
              </button>
            </div>
          </div>
          {children}
          <footer className="workspace-footer">
            <span>
              <Mark small />
              {t("Built for the work between the prompts.")}
            </span>
            <span>
              {snapshot
                ? t("{count} events · seq {seq}", { count: snapshot.eventCount, seq: snapshot.state.lastSeq })
                : t("Connecting to local event stream")}
              <span className="footer-dot" />
              {t("Local-first by design")}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
