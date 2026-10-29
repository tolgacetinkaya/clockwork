/**
 * Secrets discipline (CONCEPT.md §12.2): secrets never reach the ledger,
 * spec, or reports in plaintext. The ledger writer runs every event through
 * this filter before persisting. Redaction is defense in depth — the primary
 * rule is that orchestrator code never puts secrets into event data at all.
 */

export const REDACTED = "[REDACTED]";

/** Conservative built-in patterns for well-known credential formats. */
const BUILTIN_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI/Anthropic-style API keys
  /ghp_[A-Za-z0-9]{20,}/g, // GitHub personal access tokens (classic)
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PATs
  /AKIA[0-9A-Z]{16}/g, // AWS access key ids
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

export class Redactor {
  private readonly literals = new Set<string>();

  /**
   * Registers a known secret value (e.g. a key the user provided during
   * CLARIFY) so it is scrubbed even when it matches no generic pattern.
   */
  registerSecret(value: string): void {
    if (value.length >= 4) this.literals.add(value);
  }

  redactText(text: string): string {
    let out = text;
    for (const pattern of BUILTIN_PATTERNS) {
      out = out.replace(pattern, REDACTED);
    }
    for (const literal of this.literals) {
      out = out.split(literal).join(REDACTED);
    }
    return out;
  }

  /** Deep-redacts every string in a JSON-serializable value. */
  redactValue<T>(value: T): T {
    if (typeof value === "string") {
      return this.redactText(value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.redactValue(v)) as T;
    }
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = this.redactValue(v);
      }
      return out as T;
    }
    return value;
  }
}
