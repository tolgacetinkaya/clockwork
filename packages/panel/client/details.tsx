import { getLocale, intlLocale, t, useI18n } from "./i18n.js";
import { ChevronRight } from "lucide-react";
import type { PanelExecution, PanelSnapshot } from "../src/protocol.js";
import { title, number, unitTitle } from "./format.js";
import { Dialog, Status } from "./ui.js";
import { usePanelUI } from "./state.js";
import { UnitActivity } from "./unit-activity.js";
import { ActivityList } from "./activity.js";

function executionMode(mode: PanelExecution["mode"]) {
  switch (mode) {
    case "produce": return t("Production");
    case "verify": return t("Independent verification");
    case "integration_verify": return t("Integration verification");
  }
}

export function UnitDetails({
  id,
  snapshot,
  close,
}: {
  id: string;
  snapshot: PanelSnapshot;
  close: () => void;
}) {
  useI18n();
  const unit = snapshot.state.units[id];
  const definition = snapshot.spec?.units.find((value) => value.id === id);
  const selectUnit = usePanelUI((s) => s.selectUnit);
  if (!unit)
    return (
      <Dialog eyebrow={t("WORK UNIT")} title={t("Unit unavailable")} onClose={close}>
        <p>{t("This work unit is not present in the current snapshot.")}</p>
      </Dialog>
    );
  const receipts = Object.values(snapshot.state.executions ?? {})
    .filter((execution) => execution.unitId === id && execution.appliedProfile)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const events = snapshot.events.filter((event) => event.unit_id === id);
  return (
    <Dialog eyebrow={id} title={unitTitle(snapshot, id)} onClose={close} wide>
      <div className="detail-status">
        <Status value={unit.status} />
        <span>{unit.agent ? title(unit.agent) : t("Unassigned")}</span>
      </div>
      <UnitActivity snapshot={snapshot} id={id} />
      {definition ? (
        <p className="drawer-intro">{definition.description}</p>
      ) : null}
      <div className="detail-metrics">
        <div>
          <span>{t("Recorded tokens")}</span>
          <strong>{number(unit.spent)}</strong>
        </div>
        <div>
          <span>{t("Estimated tokens")}</span>
          <strong>{unit.estimated ? number(unit.estimated) : t("Not set")}</strong>
        </div>
        <div>
          <span>{t("Rework attempts")}</span>
          <strong>{unit.reworkAttempts}</strong>
        </div>
      </div>
      <section className="detail-section">
        <h3>{t("Depends on")}</h3>
        {unit.dependsOn.length ? (
          unit.dependsOn.map((dependency) => (
            <button
              className="dependency-button"
              key={dependency}
              onClick={() => selectUnit(dependency)}
            >
              {unitTitle(snapshot, dependency)}
              <Status value={snapshot.state.units[dependency]?.status ?? "unknown"} />
              <ChevronRight size={14} />
            </button>
          ))
        ) : (
          <p className="small-muted">{t("An independent unit — no upstream dependencies.")}</p>
        )}
      </section>
      <section className="detail-section">
        <h3>{t("Acceptance criteria")}</h3>
        {definition?.acceptance.length ? (
          <ul className="acceptance-list">
            {definition.acceptance.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
        ) : (
          <p className="small-muted">{t("Criteria were not included in this recording. The ledger still records verification and acceptance transitions.")}</p>
        )}
      </section>
      {definition?.owns.length ? (
        <section className="detail-section">
          <h3>{t("Owned scope")}</h3>
          <div className="scope-tags">
            {definition.owns.map((scope) => (
              <code key={scope}>{scope}</code>
            ))}
          </div>
        </section>
      ) : null}
      {receipts.length ? (
        <details className="detail-section">
          <summary>{t("Applied project rules")}</summary>
          <ul className="acceptance-list">
            {receipts.map(({ execution, mode, startedAt, appliedProfile }) => appliedProfile && (
              <li key={execution}>
                <strong>{executionMode(mode)}</strong>{" · "}
                <time dateTime={startedAt}>{new Date(startedAt).toLocaleString(intlLocale[getLocale()])}</time>
                <p>{t("Profile version {version}", { version: appliedProfile.version })}</p>
                {appliedProfile.ruleIds.length ? (
                  <div className="scope-tags">
                    {appliedProfile.ruleIds.map((ruleId) => <code key={ruleId}>{ruleId}</code>)}
                  </div>
                ) : <p className="small-muted">{t("No project rules")}</p>}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <section className="detail-section">
        <h3>{t("Recorded activity")}</h3>
        {events.length ? (
          <ActivityList events={events} snapshot={snapshot} />
        ) : (
          <p className="small-muted">{t("No events for this unit in the latest event window.")}</p>
        )}
      </section>
    </Dialog>
  );
}
