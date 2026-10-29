import { Search, ArrowUpRight, GitBranch, Check, Layers } from "lucide-react";
import type { PanelSnapshot } from "../src/protocol.js";
import { usePanelUI } from "./state.js";
import type { Filter } from "./state.js";
import { compact, title, unitTitle, matchesFilter } from "./format.js";
import { UnitActivity } from "./unit-activity.js";
import { Avatar, Status, Empty } from "./ui.js";

export function WorkList({ snapshot }: { snapshot: PanelSnapshot }) {
  const select = usePanelUI((s) => s.selectUnit);
  const units = Object.entries(snapshot.state.units);
  if (!units.length)
    return (
      <Empty title="A clear workbench">
        Work units will appear after a team specification is recorded.
      </Empty>
    );
  return (
    <div className="table-scroll">
      <table className="work-table">
        <thead>
          <tr>
            <th>Work unit</th>
            <th>Agent</th>
            <th>Status</th>
            <th className="text-right">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {units.map(([id, unit], index) => (
            <tr key={id}>
              <td>
                <button className="work-title" onClick={() => select(id)}>
                  <span
                    className={`task-symbol ${unit.status === "accepted" ? "done" : ""}`}
                  >
                    {unit.status === "accepted" ? (
                      <Check size={15} />
                    ) : (
                      <Layers size={14} />
                    )}
                  </span>
                  <span>
                    <strong>{unitTitle(snapshot, id)}</strong>
                    <small>{id}</small>
                  </span>
                </button>
              </td>
              <td>
                {unit.agent ? (
                  <span className="inline-agent">
                    <Avatar name={unit.agent} index={index} small />
                    <span>{title(unit.agent)}</span>
                  </span>
                ) : (
                  <span className="muted">Unassigned</span>
                )}
              </td>
              <td>
                <Status value={unit.status} />
                <UnitActivity snapshot={snapshot} id={id} />
              </td>
              <td className="text-right token-cell">
                {unit.spent ? compact(unit.spent) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title: heading,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{heading}</h1>
      <p>{subtitle}</p>
    </header>
  );
}
const columns = [
  {
    label: "Up next",
    hint: "Waiting for its moment",
    statuses: ["pending", "blocked", "rework"],
    tone: "neutral",
  },
  {
    label: "In motion",
    hint: "Execution and iteration",
    statuses: ["running", "failed"],
    tone: "orange",
  },
  {
    label: "In review",
    hint: "Checking the outcome",
    statuses: ["verifying"],
    tone: "blue",
  },
  {
    label: "Settled",
    hint: "Accepted or cancelled",
    statuses: ["accepted", "cancelled"],
    tone: "green",
  },
];
export function Workboard({ snapshot }: { snapshot: PanelSnapshot }) {
  const filter = usePanelUI((s) => s.filter),
    search = usePanelUI((s) => s.search),
    select = usePanelUI((s) => s.selectUnit);
  const setFilter = usePanelUI((s) => s.setFilter),
    setSearch = usePanelUI((s) => s.setSearch);
  const all = Object.entries(snapshot.state.units);
  const visible = all.filter(
    ([id, unit]) =>
      matchesFilter(unit, filter) &&
      `${id} ${unitTitle(snapshot, id)} ${unit.agent ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const filters: [Filter, string][] = [
    ["all", "All work"],
    ["active", "Active"],
    ["waiting", "Waiting"],
    ["accepted", "Accepted"],
    ["attention", "Needs attention"],
  ];
  return (
    <>
      <PageHeading
        eyebrow="THE WORKBOARD"
        title="A place for every moving part."
        subtitle="Follow dependencies, execution, and verification without losing the thread."
      />
      <div className="filter-bar">
        <div className="filter-tabs" aria-label="Filter work units">
          {filters.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={filter === value ? "selected" : ""}
            >
              {label}
              {value === "all" ? <span>{all.length}</span> : null}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label="Search work units"
            placeholder="Find a work unit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="workboard">
        {columns.map((column) => {
          const units = visible.filter(([, unit]) =>
            column.statuses.includes(unit.status),
          );
          return (
            <section
              className={`board-column ${column.tone}`}
              key={column.label}
            >
              <header>
                <span className="column-dot" />
                <h2>{column.label}</h2>
                <span>{units.length}</span>
              </header>
              <p className="column-hint">{column.hint}</p>
              <div className="board-stack">
                {units.map(([id, unit], index) => (
                  <button
                    className="task-card"
                    key={id}
                    onClick={() => select(id)}
                  >
                    <div className="task-card-top">
                      <span>{id}</span>
                      <ArrowUpRight size={15} />
                    </div>
                    <h3>{unitTitle(snapshot, id)}</h3>
                    <Status value={unit.status} />
                    <UnitActivity snapshot={snapshot} id={id} />
                    <div className="task-card-footer">
                      {unit.agent ? (
                        <span className="inline-agent">
                          <Avatar name={unit.agent} index={index} small />
                          <span>{title(unit.agent)}</span>
                        </span>
                      ) : (
                        <span className="small-muted">Awaiting assignment</span>
                      )}
                      <span>{unit.spent ? compact(unit.spent) : "—"}</span>
                    </div>
                    {unit.dependsOn.length ? (
                      <p className="task-dependency">
                        <GitBranch size={12} />
                        {unit.dependsOn.length} dependencies
                      </p>
                    ) : null}
                  </button>
                ))}
                {!units.length ? (
                  <div className="board-empty">
                    Nothing here right now
                    <span>New activity will update this column.</span>
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
