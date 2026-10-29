/**
 * CHANGELOG projection: a human-readable view derived from the ledger.
 * The ledger is the single source of truth; this file is never hand-edited
 * and never read back — regenerate it instead (CONCEPT.md §9).
 */

import type { LedgerEvent } from "./events.js";

function day(ts: string): string {
  return ts.slice(0, 10);
}

function line(event: LedgerEvent): string | null {
  const data = event.data ?? {};
  const unit = event.unit_id ? `\`${event.unit_id}\`` : "";
  switch (event.type) {
    case "run.started":
      return `Run \`${String(data.run_id ?? "?")}\` started (clockwork ${String(data.teamsmith_version ?? "?")}).`;
    case "run.phase_entered":
      return `Entered phase **${String(data.phase ?? "?")}**.`;
    case "run.paused":
      return `Run paused${event.actor === "user" ? " by user" : ""}.`;
    case "run.resumed":
      return "Run resumed.";
    case "run.completed":
      return `Run completed: **${String(data.outcome ?? "done")}**.`;
    case "spec.drafted":
      return `Spec v${String(data.version ?? "?")} drafted.`;
    case "spec.approved":
      return `Spec v${String(data.version ?? "?")} approved.`;
    case "spec.amended":
      return `Spec amended v${String(data.from_version ?? "?")} → v${String(data.to_version ?? "?")} (${String(
        data.initiated_by ?? "?",
      )}): ${String(data.reason ?? "")}`;
    case "unit.started":
      return `${unit} started${event.agent_id ? ` (agent \`${event.agent_id}\`)` : ""}.`;
    case "unit.verify_started":
      return `${unit} entered verification.`;
    case "unit.rework":
      return `${unit} sent back for rework.`;
    case "unit.accepted":
      return `${unit} accepted.`;
    case "unit.failed":
      return `${unit} failed${data.reason ? `: ${String(data.reason)}` : ""}.`;
    case "unit.cancelled":
      return `${unit} cancelled${data.reason ? ` (${String(data.reason)})` : ""}.`;
    case "interaction.questions_batched": {
      const n = Array.isArray(data.questions) ? data.questions.length : 0;
      return `${n} question(s) batched for the user.`;
    }
    case "interaction.answers_received":
      return "User answers received.";
    case "interaction.checkpoint_raised":
      return `Checkpoint raised: ${String(data.ref ?? "?")} (${String(data.kind ?? "gate")}).`;
    case "interaction.checkpoint_resolved":
      return `Checkpoint resolved: ${String(data.ref ?? "?")}.`;
    case "budget.exhausted":
      return "Budget target reached — graceful stop at unit boundary.";
    case "escalation.step":
      return `${unit} escalated to step ${String(data.step ?? "?")}.`;
    // High-frequency bookkeeping events stay out of the human view.
    case "agent.spawned":
    case "agent.completed":
    case "agent.error":
    case "budget.estimated":
    case "budget.spent":
      return null;
  }
}

export function renderChangelog(events: LedgerEvent[]): string {
  const out: string[] = ["# Changelog", ""];
  let currentDay = "";

  for (const event of events) {
    const text = line(event);
    if (!text) continue;
    const d = day(event.ts);
    if (d !== currentDay) {
      currentDay = d;
      out.push(`## ${d}`, "");
    }
    out.push(`- ${text}`);
  }

  out.push("");
  return out.join("\n");
}
