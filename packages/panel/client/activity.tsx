import { t, useI18n } from "./i18n.js";
import { useState } from "react";
import { Search, ChevronRight } from "lucide-react";
import type { LedgerEvent } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import { title, time, unitTitle, eventTitle } from "./format.js";
import { Empty } from "./ui.js";
import { PageHeading } from "./work.js";

export function ActivityList({
  events,
  snapshot,
}: {
  events: LedgerEvent[];
  snapshot: PanelSnapshot;
}) {
  useI18n();
  return (
    <div className="event-list">
      {[...events].reverse().map((event) => (
        <details key={event.seq} className="event-row">
          <summary>
            <span
              className={`event-marker ${event.type.includes("accepted") || event.type === "run.completed" ? "green" : event.type.includes("failed") || event.type.includes("error") ? "red" : ""}`}
            >
              <span />
            </span>
            <div>
              <strong>{eventTitle(event)}</strong>
              <p>
                {event.unit_id
                  ? unitTitle(snapshot, event.unit_id)
                  : event.agent_id
                    ? title(event.agent_id)
                    : event.actor}
                <span> · #{event.seq}</span>
              </p>
            </div>
            <time dateTime={event.ts}>{time(event.ts)}</time>
            <ChevronRight size={14} />
          </summary>
          <pre>{JSON.stringify(event, null, 2)}</pre>
        </details>
      ))}
    </div>
  );
}
export function ActivityView({ snapshot }: { snapshot: PanelSnapshot }) {
  useI18n();
  const [search, setSearch] = useState("");
  const events = snapshot.events.filter((event) =>
    `${event.type} ${event.unit_id ?? ""} ${event.agent_id ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow={t("THE EVENT LEDGER")}
        title={t("Nothing lost between the handoffs.")}
        subtitle={t("An inspectable record of what happened. New events arrive over the shared live stream.")}
      />
      <div className="activity-toolbar">
        <span>
          {t("{count} events recorded", { count: snapshot.eventCount })}{snapshot.eventCount > snapshot.events.length
            ? t(" · showing the latest {count}", { count: snapshot.events.length })
            : ""}
        </span>
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label={t("Search activity")}
            placeholder={t("Filter events or agents…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <section className="surface">
        {events.length ? (
          <ActivityList events={events} snapshot={snapshot} />
        ) : (
          <Empty title={t("A quiet moment")}>{t("No events match this view.")}</Empty>
        )}
      </section>
    </>
  );
}
