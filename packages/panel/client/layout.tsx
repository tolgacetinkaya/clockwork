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
  const view = usePanelUI((s) => s.view),
    setView = usePanelUI((s) => s.setView),
    connection = usePanelUI((s) => s.connection),
    setDrawer = usePanelUI((s) => s.setDrawer);
  const decisions = snapshot
    ? snapshot.state.pendingQuestions.length +
      snapshot.state.openCheckpoints.length
    : 0;
  const requested = snapshot?.control.kill
    ? "Stop requested"
    : snapshot?.control.paused
      ? "Pause requested"
      : snapshot?.state.paused
        ? "Paused in ledger"
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
          aria-label="Clockwork overview"
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
            <strong>Local workspace</strong>
            <small>
              {snapshot?.mode === "recorded-demo"
                ? "Recorded demo"
                : "Local project"}
            </small>
          </span>
          <ChevronRight size={14} />
        </div>
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          {navigation.map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
              {id === "decisions" && decisions ? (
                <span className="nav-count">{decisions}</span>
              ) : id === "activity" && connection === "live" ? (
                <span className="nav-live" />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-dot" />
            <div>
              <strong>Yours, locally.</strong>
              <p>
                Your workspace stays
                <br />
                on this machine.
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
            <span>Open-source, open-ended.</span>
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
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {navigation.find((item) => item.id === view)?.label}
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
                  ? "Live sync"
                  : connection === "connecting"
                    ? "Connecting"
                    : connection === "reconnecting"
                      ? "Reconnecting"
                      : "Data is stale"}
              </span>
            </span>
            <span className="topbar-divider" />
            <span className="operator-avatar" title="Local operator">
              YOU
            </span>
          </div>
        </header>
        <main id="main-content">
          <div className="context-bar">
            <span>
              <span className="context-dot" />
              {snapshot?.mode === "recorded-demo"
                ? "RECORDED DEMO"
                : "LOCAL ORCHESTRATION"}
              <span className="context-slash">/</span>
              <span className="context-run">
                {snapshot?.state.runId ?? "Waiting for a run"}
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
                  Resume
                </button>
              ) : (
                <button
                  className="quiet-button"
                  disabled={disabled || controlBusy}
                  onClick={() => changeControl({ paused: true })}
                >
                  <Pause size={14} />
                  Pause
                </button>
              )}
              <button
                className="icon-button stop-button"
                title="Request stop"
                aria-label="Request stop"
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
                Add note
              </button>
            </div>
          </div>
          {children}
          <footer className="workspace-footer">
            <span>
              <Mark small />
              Built for the work between the prompts.
            </span>
            <span>
              {snapshot
                ? `${snapshot.eventCount} events · seq ${snapshot.state.lastSeq}`
                : "Connecting to local event stream"}
              <span className="footer-dot" />
              Local-first by design
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
