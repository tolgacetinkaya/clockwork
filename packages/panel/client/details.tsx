import { t, useI18n } from "./i18n.js";
import { ChevronRight } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { title, number, unitTitle } from "./format.js";
import { Dialog, Status } from "./ui.js";
import { usePanelUI } from "./state.js";
import { UnitActivity } from "./unit-activity.js";
import { ActivityList } from "./activity.js";

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
