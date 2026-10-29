import { readFile } from "node:fs/promises";
import type { GpThresholds } from "./types.js";

/** Typed, tolerant error: carries every issue found, not just the first. */
export class ThresholdsError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(issues.length ? `${message}: ${issues.join("; ")}` : message);
    this.name = "ThresholdsError";
    this.issues = issues;
  }
}

/** Reads and validates a `gp-*.json` thresholds file. */
export async function loadThresholds(filePath: string): Promise<GpThresholds> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new ThresholdsError(
      `Cannot read thresholds file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    throw new ThresholdsError(
      `Cannot parse thresholds JSON "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const issues = validateShape(doc);
  if (issues.length) {
    throw new ThresholdsError(`Invalid thresholds file "${filePath}"`, issues);
  }
  return doc as GpThresholds;
}

function validateShape(doc: unknown): string[] {
  const issues: string[] = [];
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return ["document must be an object"];
  }
  const d = doc as Record<string, unknown>;

  if (d.schema_version !== 1) {
    issues.push(`schema_version must be 1, got ${JSON.stringify(d.schema_version)}`);
  }
  if (typeof d.golden_path !== "string" || d.golden_path.length === 0) {
    issues.push("golden_path must be a non-empty string");
  }
  if (typeof d.source !== "string" || d.source.length === 0) {
    issues.push("source must be a non-empty string");
  }

  if (typeof d.mechanical !== "object" || d.mechanical === null || Array.isArray(d.mechanical)) {
    issues.push("mechanical must be an object");
  } else {
    issues.push(...validateMechanical(d.mechanical as Record<string, unknown>));
  }

  if (!Array.isArray(d.manual) || d.manual.some((m) => typeof m !== "string")) {
    issues.push("manual must be an array of strings");
  }

  return issues;
}

function validateMechanical(m: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (m.required_outcome !== "done" && m.required_outcome !== "abandoned") {
    issues.push('mechanical.required_outcome must be "done" or "abandoned"');
  }
  for (const key of [
    "max_interventions_execute",
    "max_budget_deviation_pct",
    "max_anomalies",
    "max_ledger_errors",
  ] as const) {
    if (typeof m[key] !== "number") {
      issues.push(`mechanical.${key} must be a number`);
    }
  }
  if (m.max_rework_total !== undefined && typeof m.max_rework_total !== "number") {
    issues.push("mechanical.max_rework_total must be a number when present");
  }
  if (m.team !== undefined) {
    if (typeof m.team !== "object" || m.team === null || Array.isArray(m.team)) {
      issues.push("mechanical.team must be an object when present");
    } else {
      const t = m.team as Record<string, unknown>;
      if (t.max_units !== undefined && typeof t.max_units !== "number") {
        issues.push("mechanical.team.max_units must be a number when present");
      }
      if (t.max_agents !== undefined && typeof t.max_agents !== "number") {
        issues.push("mechanical.team.max_agents must be a number when present");
      }
    }
  }
  return issues;
}
