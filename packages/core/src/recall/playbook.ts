/**
 * Playbook provenance mechanics (CONCEPT.md §10). Pure string functions —
 * the orchestrator owns reading/writing the playbook file; this module only
 * knows how to read and rewrite its frontmatter + confirmation markers.
 */

import YAML from "yaml";

export type PlaybookProvenance = "builtin" | "user" | "community" | "auto-draft" | "confirmed";

export interface PlaybookMeta {
  id?: string;
  applies_to?: string[];
  version?: number;
  provenance?: PlaybookProvenance;
  /** Count of `<!-- confirmed by run:<id> -->` markers found in the body. */
  confirmations: number;
  /** run ids behind those markers, in document order. */
  confirmedRunIds: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// Canonical form is `confirmed by run:<id>`; the bare `confirmed by <id>` form
// is also accepted for markers written before this module existed.
const CONFIRMATION_RE = /<!--\s*confirmed by (?:run:)?(\S+?)\s*-->/g;

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1] ?? "", body: content.slice(match[0].length) };
}

/** Parses frontmatter (id/applies_to/version/provenance) and counts trailing confirmation markers. */
export function parsePlaybookMeta(content: string): PlaybookMeta {
  const { frontmatter, body } = splitFrontmatter(content);

  const confirmedRunIds: string[] = [];
  for (const m of body.matchAll(CONFIRMATION_RE)) {
    const id = m[1];
    if (id !== undefined) confirmedRunIds.push(id);
  }
  const base = { confirmations: confirmedRunIds.length, confirmedRunIds };

  if (frontmatter === null) return base;

  let parsed: unknown;
  try {
    parsed = YAML.parse(frontmatter);
  } catch {
    return base;
  }
  if (typeof parsed !== "object" || parsed === null) return base;
  const fm = parsed as Record<string, unknown>;

  return {
    ...(typeof fm.id === "string" ? { id: fm.id } : {}),
    ...(Array.isArray(fm.applies_to)
      ? { applies_to: fm.applies_to.filter((x): x is string => typeof x === "string") }
      : {}),
    ...(typeof fm.version === "number" ? { version: fm.version } : {}),
    ...(typeof fm.provenance === "string" ? { provenance: fm.provenance as PlaybookProvenance } : {}),
    ...base,
  };
}

/** Appends a confirmation marker for `runId`. Idempotent: a run already recorded is a no-op. */
export function appendConfirmation(content: string, runId: string): string {
  const meta = parsePlaybookMeta(content);
  if (meta.confirmedRunIds.includes(runId)) return content;

  const marker = `<!-- confirmed by run:${runId} -->`;
  const separator = content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${marker}\n`;
}

/**
 * Rewrites `provenance: auto-draft` to `provenance: confirmed` once two or
 * more confirmations are present — CONCEPT.md §10's rule: an auto-draft
 * playbook is promoted by human review OR a second successful run. No-op
 * when provenance isn't auto-draft, the threshold isn't met, or there is no
 * frontmatter to rewrite.
 */
export function promoteToConfirmed(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter === null) return content;

  const meta = parsePlaybookMeta(content);
  if (meta.provenance !== "auto-draft" || meta.confirmations < 2) return content;

  const rewritten = frontmatter.replace(/^provenance:\s*.*$/m, "provenance: confirmed");
  return `---\n${rewritten}\n---\n${body}`;
}
