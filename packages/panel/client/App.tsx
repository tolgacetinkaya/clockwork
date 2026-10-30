import { t, useI18n } from "./i18n.js";
import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Square,
  Radio,
  WifiOff,
  AlertTriangle,
  X,
} from "lucide-react";
import type { Command } from "@clockwork/core";
import type { ControlState, PanelCommand } from "../src/protocol.js";
import { useLivePanel, useSnapshot, postJSON } from "./live.js";
import { usePanelUI } from "./state.js";
import { Mark, Dialog } from "./ui.js";
import { Layout } from "./layout.js";
import { Onboarding } from "./onboarding.js";
import { Overview } from "./overview.js";
import { Workboard } from "./work.js";
import { Mission } from "./mission.js";
import { Team } from "./team.js";
import { ActivityView } from "./activity.js";
import { Decisions } from "./decisions.js";
import { UnitDetails } from "./details.js";

export function App() {
  useI18n();
  useLivePanel();
  const { data: snapshot } = useSnapshot();
  const view = usePanelUI((s) => s.view),
    connection = usePanelUI((s) => s.connection);
  const notice = usePanelUI((s) => s.notice),
    notify = usePanelUI((s) => s.notify);
  const selectedUnit = usePanelUI((s) => s.selectedUnit),
    selectUnit = usePanelUI((s) => s.selectUnit);
  const drawer = usePanelUI((s) => s.drawer),
    setDrawer = usePanelUI((s) => s.setDrawer);
  const noteDraft = usePanelUI((s) => s.noteDraft),
    setNoteDraft = usePanelUI((s) => s.setNoteDraft);
  const disabled =
    connection !== "live" || !snapshot || snapshot.issues.length > 0;
  const command = useMutation({
    mutationFn: (payload: PanelCommand) =>
      postJSON<Command>("/api/commands", payload),
    onSuccess: (receipt) =>
      notify(t("Request #{seq} queued for the orchestrator.", { seq: receipt.seq })),
    onError: (error) => notify(error.message),
  });
  const control = useMutation({
    mutationFn: (payload: Partial<ControlState>) =>
      postJSON<ControlState>("/api/control", payload),
    onSuccess: (result) =>
      notify(
        result.kill
          ? t("Stop requested. Running processes are not terminated by this control.")
          : result.paused
            ? t("Pause requested. Waiting for the orchestrator to record the change.")
            : t("Resume requested."),
      ),
    onError: (error) => notify(error.message),
  });
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => notify(null), 7000);
    return () => clearTimeout(timer);
  }, [notice, notify]);
  const submit = async (payload: PanelCommand) => {
    await command.mutateAsync(payload);
  };
  return (
    <>
      <Layout
        snapshot={snapshot}
        disabled={disabled}
        controlBusy={control.isPending}
        changeControl={(patch) => control.mutate(patch)}
      >
        {connection === "reconnecting" || connection === "stale" ? (
          <div className="notice-banner" role="alert">
            <WifiOff size={16} />
            <span>
              {t("Connection interrupted. Your last snapshot stays visible; updates resume automatically. Actions are temporarily unavailable.")}
            </span>
          </div>
        ) : null}
        {snapshot?.mode === "recorded-demo" ? (
          <div className="demo-caption">
            <Radio size={14} />
            <span>
              {t("Exploring a recorded run. File changes stream live; no AI agents are running in this demo.")}
            </span>
          </div>
        ) : null}
        {snapshot?.issues.length ? (
          <div className="notice-banner integrity-banner" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>{t("Project data needs attention")}</strong>
              {snapshot.issues.map((issue, index) => (
                <p key={index}>{issue}</p>
              ))}
            </div>
          </div>
        ) : null}
        {!snapshot ? (
          <div className="loading-state">
            <Mark />
            <h1>
              {connection === "connecting"
                ? t("Finding the rhythm…")
                : t("Waiting to reconnect.")}
            </h1>
            <p>
              {t("Connecting to your local workspace. No project data is sent elsewhere.")}
            </p>
            <span className="loading-line" />
          </div>
        ) : (
          <>
            {view === "start" ? (
              <Onboarding snapshot={snapshot} />
            ) : view === "overview" ? (
              <Overview snapshot={snapshot} />
            ) : view === "mission" ? (
              <Mission snapshot={snapshot} disabled={disabled} />
            ) : view === "workboard" ? (
              <Workboard snapshot={snapshot} />
            ) : view === "team" ? (
              <Team snapshot={snapshot} />
            ) : view === "activity" ? (
              <ActivityView snapshot={snapshot} />
            ) : (
              <Decisions
                snapshot={snapshot}
                submit={submit}
                busy={command.isPending}
                disabled={disabled}
              />
            )}
          </>
        )}
      </Layout>

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label={t("Dismiss notification")}
            onClick={() => notify(null)}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
      {selectedUnit && snapshot ? (
        <UnitDetails
          id={selectedUnit}
          snapshot={snapshot}
          close={() => selectUnit(null)}
        />
      ) : null}
      {drawer === "note" ? (
        <Dialog
          eyebrow={t("A NOTE TO THE ORCHESTRATOR")}
          title={t("Leave a little context.")}
          onClose={() => setDrawer(null)}
        >
          <p className="drawer-intro">
            {t("A question, a constraint, a useful detail. Your note joins the durable command queue for the orchestrator to read.")}
            </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit({ type: "note", data: { text: noteDraft } })
                .then(() => {
                  setNoteDraft("");
                  setDrawer(null);
                })
                .catch(() => {});
            }}
          >
            <label htmlFor="operator-note">{t("Your note")}</label>
            <textarea
              id="operator-note"
              rows={8}
              maxLength={6000}
              placeholder={t("What should the team keep in mind?")}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
            />
            <div className="form-footer">
              <span>{noteDraft.length}/6000</span>
              <button
                className="primary-button"
                disabled={disabled || command.isPending || !noteDraft.trim()}
              >
                {command.isPending ? t("Queuing…") : t("Queue note")}
                <ArrowUpRight size={15} />
              </button>
            </div>
            {command.error ? (
              <p className="form-error" role="alert">
                {command.error.message}
              </p>
            ) : null}
          </form>
          <p className="small-muted">
            {t("This sends a request; it does not directly change the run.")}
            </p>
        </Dialog>
      ) : null}
      {drawer === "stop" ? (
        <Dialog
          eyebrow={t("RUN CONTROL")}
          title={t("Request a stop?")}
          onClose={() => setDrawer(null)}
        >
          <p className="drawer-intro">
            {t("Future agent mutations will be blocked by the active guard. Already running processes are not terminated. Resume can clear this request.")}
            </p>
          <button
            className="danger-button"
            disabled={disabled || control.isPending}
            onClick={() => {
              void control
                .mutateAsync({ kill: true })
                .then(() => setDrawer(null))
                .catch(() => {});
            }}
          >
            {t("Request stop")} <Square size={14} />
          </button>
          {control.error ? (
            <p className="form-error" role="alert">
              {control.error.message}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
