import { getLocale, intlLocale, t, useI18n } from "./i18n.js";
import type { PanelExecution, PanelSnapshot } from "../src/protocol.js";
import type { Connection } from "./state.js";
import "./execution-health.css";

function RecordedTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString(intlLocale[getLocale()])}</time>;
}

function statusLabel(execution: PanelExecution) {
  if (execution.status === "error") return t("Execution failed");
  if (execution.status === "completed") return t("Execution completed");
  return t("Execution running");
}

function alertLabel(alert: PanelExecution["alert"]) {
  switch (alert) {
    case "idle": return t("Idle warning recorded");
    case "overdue": return t("Expected duration exceeded");
    case "hard_timeout": return t("Execution timeout recorded");
    case "delivery_timeout": return t("Delivery reconciliation timeout recorded");
    default: return null;
  }
}

/** Only ledger facts determine execution status; the browser never declares failure. */
export function ExecutionHealth({ snapshot, connection }: { snapshot: PanelSnapshot; connection: Connection }) {
  useI18n();
  const executions = Object.values(snapshot.state.executions ?? {}).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.execution.localeCompare(b.execution));
  if (!executions.length) return <p className="small-muted execution-health-unavailable">{t("Execution monitoring is unavailable for this run.")}</p>;
  const recorded = snapshot.mode === "recorded-demo" || Boolean(snapshot.state.outcome);
  const connectionLabel = recorded ? t("Recorded execution history") : connection === "live" ? t("Live ledger updates") : t("Updates unavailable · showing last snapshot");
  return <section className="surface execution-health" aria-label={t("Execution monitoring")}>
    <header><h2>{t("Execution monitoring")}</h2><p role="status" className="small-muted">{connectionLabel}</p></header>
    <p className="small-muted">{t("Execution records show agent activity. Panel connectivity does not measure process liveness.")}</p>
    <ul className="execution-health-list">
      {executions.map((execution) => {
        const warning = alertLabel(execution.alert);
        const delivery = execution.delivery;
        return <li className="execution-health-row" key={execution.execution}>
          <div className="execution-health-identity"><strong>{execution.agentId}</strong><code>{execution.execution}</code>{execution.unitId ? <span className="small-muted">{execution.unitId}</span> : null}</div>
          <div className="execution-health-facts">
            <span className={`execution-health-status is-${execution.executionUnreconciled ? "unresolved" : execution.status}`}>{statusLabel(execution)}</span>
            {execution.executionUnreconciled ? <span className="execution-health-warning">{t("Termination unconfirmed")}</span> : null}
            {warning ? <span className="execution-health-warning" role="status">{warning}</span> : null}
            <span>{t("Last agent activity")}{" "}<RecordedTime value={execution.lastActivityAt} /></span>
            {execution.lastHeartbeatAt ? <span className="small-muted">{t("Last execution heartbeat")}{" "}<RecordedTime value={execution.lastHeartbeatAt} /></span> : null}
            {delivery ? <div className="execution-health-delivery"><strong>{delivery.acknowledgedAt ? t("Delivery acknowledged") : t("Delivery received · awaiting acknowledgement")}</strong><span>{t("Received")}{" "}<RecordedTime value={delivery.receivedAt} /></span>{delivery.acknowledgedAt ? <><span>{t("Acknowledged")}{" "}<RecordedTime value={delivery.acknowledgedAt} /></span><small>{t("Acknowledgement records processing, not task acceptance.")}</small></> : null}</div> : <span className="small-muted">{t("No delivery recorded")}</span>}
            <details><summary>{t("Monitoring details")}</summary><dl><dt>{t("Started")}</dt><dd><RecordedTime value={execution.startedAt} /></dd><dt>{t("Idle warning after")}</dt><dd>{t("{seconds} seconds", { seconds: execution.watchdog.idle_ms / 1000 })}</dd>{execution.watchdog.expected_ms !== undefined ? <><dt>{t("Expected duration")}</dt><dd>{t("{seconds} seconds", { seconds: execution.watchdog.expected_ms / 1000 })}</dd></> : null}<dt>{t("Execution limit")}</dt><dd>{t("{seconds} seconds", { seconds: execution.watchdog.hard_ms / 1000 })}</dd><dt>{t("Reconciliation limit")}</dt><dd>{t("{seconds} seconds", { seconds: execution.watchdog.delivery_ms / 1000 })}</dd>{delivery ? <><dt>{t("Delivery ID")}</dt><dd><code>{delivery.id}</code></dd><dt>{t("Recorded delivery outcome")}</dt><dd><code>{delivery.outcome ?? "—"}</code></dd></> : null}</dl></details>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
