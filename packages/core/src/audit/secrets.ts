/**
 * Secret scanning (CONCEPT.md §12.1): the automated layer of the security
 * gate. Reuses the ledger's `Redactor` instead of duplicating its patterns —
 * a file leaks a secret iff redaction changes it. The scanner never stores
 * the raw secret: every excerpt it keeps has already been through
 * `redactText`.
 */

import { extname, join, relative, sep } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { REDACTED, Redactor } from "../ledger/redact.js";

export interface ScannableFile {
  /** Forward-slash path (relative to the scan root when produced by `collectScannableFiles`). */
  path: string;
  content: string;
}

export interface SecretFinding {
  path: string;
  /** 1-based line number within the file. */
  line: number;
  /** Redacted excerpt of the offending line — the raw secret never appears here. */
  excerpt: string;
}

const MAX_EXCERPT_LENGTH = 160;
const EXCERPT_CONTEXT = 40;

/** Redacted-line excerpt, truncated around the marker so long lines stay readable. */
function buildExcerpt(redactedLine: string): string {
  const trimmed = redactedLine.trim();
  if (trimmed.length <= MAX_EXCERPT_LENGTH) return trimmed;

  const idx = trimmed.indexOf(REDACTED);
  if (idx === -1) return `${trimmed.slice(0, MAX_EXCERPT_LENGTH)}…`;

  const start = Math.max(0, idx - EXCERPT_CONTEXT);
  const end = Math.min(trimmed.length, idx + REDACTED.length + EXCERPT_CONTEXT);
  return `${start > 0 ? "…" : ""}${trimmed.slice(start, end)}${end < trimmed.length ? "…" : ""}`;
}

/**
 * Scans files for secrets by diffing each line against its redacted form —
 * a change means `Redactor`'s built-in patterns matched something. No
 * literals are registered, so only generic credential shapes are caught
 * (this is the automated layer; adversarial review is a separate concern,
 * CONCEPT.md §12.1). Findings are sorted by path then line for determinism.
 */
export function scanSecrets(files: ScannableFile[]): SecretFinding[] {
  const redactor = new Redactor();
  const findings: SecretFinding[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const redacted = redactor.redactText(line);
      if (redacted !== line) {
        findings.push({ path: file.path, line: i + 1, excerpt: buildExcerpt(redacted) });
      }
    }
  }

  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export interface CollectScannableFilesOptions {
  /** Files larger than this are skipped unread. Default ~1MB. */
  maxBytes?: number;
  /** Extra directory names to skip, merged with the built-in sane defaults. */
  skipDirs?: string[];
}

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".teamsmith",
  ".svn",
  ".hg",
  "dist",
  "build",
  "coverage",
]);

const DEFAULT_BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".node", ".wasm", ".class", ".jar",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".webm",
]);

const DEFAULT_MAX_BYTES = 1_000_000;

function toPosixPath(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Recursively walks `rootDir` and returns readable, size-capped, non-binary
 * files as `{path, content}` pairs. Paths are forward-slash and relative to
 * `rootDir` for deterministic, platform-independent output. Unreadable
 * directories/files are skipped rather than failing the whole walk.
 */
export async function collectScannableFiles(
  rootDir: string,
  opts: CollectScannableFilesOptions = {},
): Promise<ScannableFile[]> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(opts.skipDirs ?? [])]);
  const out: ScannableFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (DEFAULT_BINARY_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

      let size: number;
      try {
        size = (await stat(fullPath)).size;
      } catch {
        continue;
      }
      if (size > maxBytes) continue;

      try {
        const content = await readFile(fullPath, "utf8");
        out.push({ path: toPosixPath(relative(rootDir, fullPath)), content });
      } catch {
        continue;
      }
    }
  }

  await walk(rootDir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
