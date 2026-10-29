/**
 * Capability strategy shared types (CONCEPT.md §5, §12.3): find → vet →
 * produce → accumulate. This file has no fs/network dependency — it only
 * describes the shapes the vetting gate and the library operate on.
 */

export interface SkillFile {
  /** Relative path within the skill package, e.g. "SKILL.md" or "scripts/setup.sh". */
  path: string;
  content: string;
}

export interface SkillInput {
  name: string;
  files: SkillFile[];
}

export type VettingDecision = "ok" | "caution" | "reject";

export interface VettingFinding {
  /** Machine-readable rule id, e.g. "curl-pipe-shell", "network-egress". */
  rule: string;
  /** The offending text (a line or matched snippet) that triggered the finding. */
  evidence: string;
  /** File path the evidence came from. */
  path: string;
}

/** The "one card to the user" (CONCEPT.md §5). */
export interface VettingVerdict {
  decision: VettingDecision;
  /** Coarse-grained capability tags extracted from the skill, e.g. "shell:curl", "network". */
  permissions: string[];
  findings: VettingFinding[];
  summary: string;
}
