/**
 * The security gate's audit card (CONCEPT.md §12.1, house style per
 * `capability/vet.ts`): one deterministic verdict combining the secret scan
 * and the (CLI-run) dependency audit. A leaked secret is never a "caution" —
 * it is always `reject`; dependency risk is a user decision, so critical/high
 * vulnerabilities only ever surface as `caution`.
 */

import type { DependencyAuditSummary, DependencySeverity } from "./dependencies.js";
import type { SecretFinding } from "./secrets.js";

export type AuditDecision = "ok" | "caution" | "reject";

export interface AuditFinding {
  rule: "leaked-secret" | "dependency-vulnerability";
  path: string;
  /** 1-based line number; only present for secret findings. */
  line?: number;
  evidence: string;
}

export interface AuditReport {
  decision: AuditDecision;
  findings: AuditFinding[];
  summary: string;
  secretCount: number;
  dependencyCounts?: Record<DependencySeverity, number>;
}

export interface BuildAuditReportInput {
  secrets: SecretFinding[];
  /** Pass the parsed summary only on a successful `parseNpmAuditJson` — the CLI handles the error case itself. */
  dependencies?: DependencyAuditSummary;
}

function dependencyEvidence(v: DependencyAuditSummary["vulnerabilities"][number]): string {
  const parts = [`${v.severity}: ${v.name}`];
  if (v.range) parts.push(`(${v.range})`);
  parts.push(v.fixAvailable ? "— fix available" : "— no fix available");
  return parts.join(" ");
}

function summarize(decision: AuditDecision, input: BuildAuditReportInput): string {
  if (decision === "reject") {
    return `Rejected — ${input.secrets.length} leaked secret(s) found. Rotate and remove before proceeding.`;
  }
  if (decision === "caution") {
    const c = input.dependencies!.counts;
    return `Needs review — ${c.critical} critical, ${c.high} high severity dependency vulnerabilit${c.critical + c.high === 1 ? "y" : "ies"}.`;
  }
  return "Clean — no leaked secrets, no critical/high dependency vulnerabilities.";
}

/** Builds the one card shown for the automated security gate layer (CONCEPT.md §12.1). */
export function buildAuditReport(input: BuildAuditReportInput): AuditReport {
  const findings: AuditFinding[] = [];

  for (const s of input.secrets) {
    findings.push({ rule: "leaked-secret", path: s.path, line: s.line, evidence: s.excerpt });
  }
  if (input.dependencies) {
    for (const v of input.dependencies.vulnerabilities) {
      findings.push({ rule: "dependency-vulnerability", path: v.name, evidence: dependencyEvidence(v) });
    }
  }

  findings.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));

  const hasSecret = input.secrets.length > 0;
  const criticalOrHigh = input.dependencies !== undefined
    && input.dependencies.counts.critical + input.dependencies.counts.high > 0;

  const decision: AuditDecision = hasSecret ? "reject" : criticalOrHigh ? "caution" : "ok";

  return {
    decision,
    findings,
    summary: summarize(decision, input),
    secretCount: input.secrets.length,
    dependencyCounts: input.dependencies?.counts,
  };
}

/** Markdown projection — style-matched to `renderBudgetReport`. */
export function renderAuditReport(report: AuditReport): string {
  const out: string[] = ["## Security Audit", ""];
  out.push(`Decision: **${report.decision.toUpperCase()}**`);
  out.push("");
  out.push(report.summary);
  out.push("");

  if (report.dependencyCounts) {
    const c = report.dependencyCounts;
    out.push(
      `Dependencies: critical **${c.critical}** · high **${c.high}** · moderate **${c.moderate}** · low **${c.low}** · info **${c.info}**`,
    );
    out.push("");
  }

  if (report.findings.length > 0) {
    out.push("| Rule | Path | Line | Evidence |");
    out.push("|---|---|---:|---|");
    for (const f of report.findings) {
      out.push(`| ${f.rule} | \`${f.path}\` | ${f.line ?? "—"} | ${f.evidence} |`);
    }
    out.push("");
  }

  return out.join("\n");
}
