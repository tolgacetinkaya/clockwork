/**
 * Dependency audit parsing (CONCEPT.md §12.1): a tolerant parser for
 * `npm audit --json` output. This module only parses — running `npm audit`
 * itself is a `child_process` concern that belongs to the CLI, not core.
 * Unparseable input never throws; it returns a typed error result.
 */

export type DependencySeverity = "info" | "low" | "moderate" | "high" | "critical";

const SEVERITIES: readonly DependencySeverity[] = ["info", "low", "moderate", "high", "critical"];

export interface DependencyVulnerability {
  name: string;
  severity: DependencySeverity;
  /** Advisory titles / intermediate package names, flattened to strings. */
  via: string[];
  range: string;
  fixAvailable: boolean;
}

export interface DependencyAuditSummary {
  counts: Record<DependencySeverity, number>;
  total: number;
  vulnerabilities: DependencyVulnerability[];
}

export type ParseNpmAuditResult =
  | { ok: true; summary: DependencyAuditSummary }
  | { ok: false; error: string };

function normalizeSeverity(value: unknown): DependencySeverity | null {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value)
    ? (value as DependencySeverity)
    : null;
}

function flattenVia(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
    } else if (typeof item === "object" && item !== null) {
      const o = item as Record<string, unknown>;
      const label = typeof o.title === "string" ? o.title : typeof o.name === "string" ? o.name : undefined;
      if (label) out.push(label);
    }
  }
  return out;
}

/** npm's `fixAvailable` is `false`, `true`, or an object describing the fix target. */
function normalizeFixAvailable(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return typeof value === "object" && value !== null;
}

function emptySummary(): DependencyAuditSummary {
  return {
    counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    total: 0,
    vulnerabilities: [],
  };
}

/**
 * Parses `npm audit --json` output (npm 8+ `vulnerabilities` map shape).
 * A missing or empty `vulnerabilities` field is treated as a clean report,
 * not an error. Individual malformed entries are skipped rather than
 * failing the whole parse; only structurally invalid JSON/shape is an error.
 */
export function parseNpmAuditJson(raw: string): ParseNpmAuditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `npm audit output is not valid JSON: ${(err as Error).message}` };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "npm audit output is not a JSON object" };
  }

  const vulnsRaw = (parsed as Record<string, unknown>).vulnerabilities;
  if (vulnsRaw === undefined || vulnsRaw === null) {
    return { ok: true, summary: emptySummary() };
  }
  if (typeof vulnsRaw !== "object" || Array.isArray(vulnsRaw)) {
    return { ok: false, error: 'npm audit "vulnerabilities" field is not an object' };
  }

  const summary = emptySummary();
  for (const [pkgName, entryRaw] of Object.entries(vulnsRaw as Record<string, unknown>)) {
    if (typeof entryRaw !== "object" || entryRaw === null) continue;
    const entry = entryRaw as Record<string, unknown>;

    const severity = normalizeSeverity(entry.severity);
    if (severity === null) continue;

    const vuln: DependencyVulnerability = {
      name: typeof entry.name === "string" ? entry.name : pkgName,
      severity,
      via: flattenVia(entry.via),
      range: typeof entry.range === "string" ? entry.range : "",
      fixAvailable: normalizeFixAvailable(entry.fixAvailable),
    };
    summary.vulnerabilities.push(vuln);
    summary.counts[severity]++;
  }

  summary.vulnerabilities.sort((a, b) => a.name.localeCompare(b.name));
  summary.total = summary.vulnerabilities.length;
  return { ok: true, summary };
}
