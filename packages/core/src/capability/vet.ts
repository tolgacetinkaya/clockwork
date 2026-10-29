/**
 * Vetting gate (CONCEPT.md §5, §12.3): static reading of a skill's files —
 * SKILL.md and any scripts — to extract shell commands, network
 * touchpoints, filesystem writes outside the project, credential access,
 * and self-update behavior, then apply the hard rejection rules.
 *
 * Pure and offline: this module reads the file contents handed to it. It
 * never fetches anything itself — discovery/download is an adapter concern.
 */

import type { SkillFile, SkillInput, VettingDecision, VettingFinding, VettingVerdict } from "./types.js";

const SCRIPT_EXTENSIONS = [".sh", ".ps1", ".js", ".mjs", ".cjs", ".py"];

function isScriptFile(path: string): boolean {
  const lower = path.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/* ---------- shell command extraction (fences + script files) ---------- */

const FENCE_RE = /```(\w+)?\r?\n([\s\S]*?)```/g;
const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh", "powershell", "ps1", "pwsh", "cmd", "console", ""]);

/** Fenced code blocks tagged as shell-ish (or untagged) from a markdown file. */
function extractFencedShellSnippets(content: string): string[] {
  const snippets: string[] = [];
  for (const m of content.matchAll(FENCE_RE)) {
    const lang = (m[1] ?? "").toLowerCase();
    if (SHELL_LANGS.has(lang)) snippets.push(m[2] ?? "");
  }
  return snippets;
}

/** First-token command names per line/segment — feeds the `shell:*` permission list. */
function extractCommandNames(snippet: string): string[] {
  const names: string[] = [];
  for (const rawLine of snippet.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    for (const segment of line.split(/&&|;|\|/)) {
      const token = segment.trim().split(/\s+/)[0];
      if (!token || token.includes("=")) continue;
      const name = token.replace(/^\.\//, "").replace(/^sudo$/, "");
      if (name && /^[A-Za-z0-9_.-]+$/.test(name)) names.push(name.toLowerCase());
    }
  }
  return names;
}

/* ---------- pattern-based extraction over whole file content ---------- */

const URL_RE = /\bhttps?:\/\/[^\s'"`)]+/g;
const NETWORK_CMD_RE = /\b(curl|wget|Invoke-WebRequest|iwr)\b|fetch\(|axios\.(get|post|put|delete)\(/gi;

const HOME_REF_RE = /(~[/\\]|\$HOME\b|%APPDATA%|%USERPROFILE%)/;
const ABS_PATH_RE = /(?:[A-Za-z]:\\[^\s'"`)]+|\/(?:etc|usr|root|home|Users|var|System32|Windows)\/[^\s'"`)]*)/;
const WRITE_VERB_RE =
  /\b(rm|mv|cp|touch|mkdir|Remove-Item|Set-Content|Out-File|New-Item)\b|>>?(?!=)|writeFile|createWriteStream/;

const ENV_CRED_RE =
  /(?:process\.env\.|os\.environ(?:\.get)?\(?\[?['"]?|\$env:|\$\{?)([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)/g;
const CRED_FILE_RE = /(\.env\b|credentials\.json|security find-generic-password|Get-StoredCredential|cmdkey\b|Keychain)/gi;

const SELF_UPDATE_RE = /\b(git\s+pull|npx\s+skills\s+add|npm\s+install\s+-g|self-update|auto-update)\b/gi;

const PIPE_TO_SHELL_RE =
  /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b|\b(iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(iex|Invoke-Expression)\b/gi;

interface Collected {
  findings: VettingFinding[];
  permissions: Set<string>;
  hasCredentialRead: boolean;
  hasNetworkEgress: boolean;
  hasPipeToShell: boolean;
  hasSelfUpdate: boolean;
}

function scanFile(file: SkillFile, out: Collected): void {
  const { path, content } = file;

  // Shell commands invoked — from markdown fences and any script file.
  const shellSnippets = isScriptFile(path) ? [content] : extractFencedShellSnippets(content);
  for (const snippet of shellSnippets) {
    for (const cmd of extractCommandNames(snippet)) out.permissions.add(`shell:${cmd}`);
  }

  // Hard rule: curl|bash-style piping to a shell.
  for (const m of content.matchAll(PIPE_TO_SHELL_RE)) {
    out.hasPipeToShell = true;
    out.findings.push({ rule: "curl-pipe-shell", evidence: m[0].trim(), path });
  }

  // Network touchpoints.
  for (const m of content.matchAll(URL_RE)) {
    out.hasNetworkEgress = true;
    out.permissions.add("network");
    out.findings.push({ rule: "network-egress", evidence: m[0], path });
  }
  for (const m of content.matchAll(NETWORK_CMD_RE)) {
    out.hasNetworkEgress = true;
    out.permissions.add("network");
    out.findings.push({ rule: "network-egress", evidence: m[0], path });
  }

  // Filesystem writes outside project scope: a home/absolute-path reference
  // co-occurring with a write-shaped verb on the same line.
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const hasOutsidePath = HOME_REF_RE.test(line) || ABS_PATH_RE.test(line);
    if (hasOutsidePath && WRITE_VERB_RE.test(line)) {
      out.permissions.add("fs-write:outside-scope");
      out.findings.push({ rule: "fs-write-outside-scope", evidence: line, path });
    }
  }

  // Credential access.
  for (const m of content.matchAll(ENV_CRED_RE)) {
    out.hasCredentialRead = true;
    out.permissions.add("credential-read");
    out.findings.push({ rule: "credential-read", evidence: m[0], path });
  }
  for (const m of content.matchAll(CRED_FILE_RE)) {
    out.hasCredentialRead = true;
    out.permissions.add("credential-read");
    out.findings.push({ rule: "credential-read", evidence: m[0], path });
  }

  // Self-update behavior.
  for (const m of content.matchAll(SELF_UPDATE_RE)) {
    out.hasSelfUpdate = true;
    out.permissions.add("self-update");
    out.findings.push({ rule: "self-update", evidence: m[0], path });
  }
}

function dedupe(findings: VettingFinding[]): VettingFinding[] {
  const seen = new Set<string>();
  const out: VettingFinding[] = [];
  for (const f of findings) {
    const key = `${f.rule}|${f.path}|${f.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function summarize(decision: VettingDecision, name: string, findings: VettingFinding[]): string {
  if (decision === "reject") {
    const rules = [...new Set(findings.map((f) => f.rule))].join(", ");
    return `"${name}" rejected — hard rule triggered (${rules}).`;
  }
  if (decision === "caution") {
    return `"${name}" needs review — ${findings.length} finding(s): ${[...new Set(findings.map((f) => f.rule))].join(", ")}.`;
  }
  return `"${name}" is clean — no network, credential, off-scope write, or self-update findings.`;
}

/**
 * Vets a skill's content and returns the one card shown to the user
 * (CONCEPT.md §5). Hard rules (curl|bash piping, credential-read combined
 * with network egress, self-update) force `reject` regardless of other
 * findings; otherwise `caution` when findings exist, `ok` when clean.
 */
export function vetSkill(input: SkillInput): VettingVerdict {
  const collected: Collected = {
    findings: [],
    permissions: new Set(),
    hasCredentialRead: false,
    hasNetworkEgress: false,
    hasPipeToShell: false,
    hasSelfUpdate: false,
  };

  for (const file of input.files) scanFile(file, collected);

  const findings = dedupe(collected.findings);
  const credentialNetworkCombo = collected.hasCredentialRead && collected.hasNetworkEgress;
  if (credentialNetworkCombo) {
    findings.push({
      rule: "credential-network-combo",
      evidence: "Skill reads credentials and also performs network egress",
      path: input.name,
    });
  }

  let decision: VettingDecision;
  if (collected.hasPipeToShell || collected.hasSelfUpdate || credentialNetworkCombo) {
    decision = "reject";
  } else if (findings.length > 0) {
    decision = "caution";
  } else {
    decision = "ok";
  }

  return {
    decision,
    permissions: [...collected.permissions].sort(),
    findings,
    summary: summarize(decision, input.name, findings),
  };
}
