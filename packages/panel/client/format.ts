import { getLocale, intlLocale, t } from "./i18n.js";
import type { LedgerEvent, UnitState } from "@clockwork/core";
import type { PanelSnapshot } from "../src/protocol.js";
import type { Filter } from "./state.js";

export const compact = (value: number) =>
  new Intl.NumberFormat(intlLocale[getLocale()], {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const number = (value: number) =>
  new Intl.NumberFormat(intlLocale[getLocale()]).format(value);
export const title = (value: string) =>
  value
    .replace(/^wu-/, "")
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
export const time = (value: string) =>
  new Date(value).toLocaleTimeString(intlLocale[getLocale()], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export function unitTitle(_snapshot: PanelSnapshot, id: string): string {
  // IDs are concise labels; the full specification lives in the details drawer.
  return title(id);
}

export function matchesFilter(unit: UnitState, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "active")
    return ["running", "rework", "verifying"].includes(unit.status);
  if (filter === "waiting") return ["pending", "blocked"].includes(unit.status);
  if (filter === "attention")
    return ["failed", "rework", "blocked"].includes(unit.status);
  return unit.status === "accepted";
}
export function eventTitle(event: LedgerEvent): string {
  const names: Partial<Record<LedgerEvent["type"], string>> = {
    "run.started": "Run created",
    "run.phase_entered": t("Entered {phase}", { phase: String(event.data?.phase ?? t("next phase")) }),
    "run.paused": "Run paused",
    "run.resumed": "Run resumed",
    "run.completed": "Run completed",
    "spec.drafted": "Team specification drafted",
    "spec.approved": "Team specification approved",
    "spec.amended": "Specification amended",
    "unit.started": "Work started",
    "unit.verify_started": "Verification started",
    "unit.accepted": "Acceptance recorded",
    "unit.rework": "Rework requested",
    "unit.failed": "Work unit failed",
    "unit.cancelled": "Work unit cancelled",
    "agent.spawned": "Agent assigned",
    "agent.activity": "Agent activity",
    "agent.completed": "Agent completed",
    "agent.error": "Agent error recorded",
    "interaction.questions_batched": "Questions need an answer",
    "interaction.answers_received": "Answers recorded",
    "interaction.checkpoint_raised": "Checkpoint opened",
    "interaction.checkpoint_resolved": "Checkpoint resolved",
    "budget.spent": "Usage recorded",
    "budget.estimated": "Budget estimated",
    "budget.exhausted": "Budget limit reached",
    "escalation.step": "Escalation recorded",
  };
  return names[event.type] ? t(names[event.type]!) : title(event.type);
}
