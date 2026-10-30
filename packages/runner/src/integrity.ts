import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { git } from "./workspace.js";

const exec = promisify(execFile);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SOURCE_FILES = 2000;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_MARKERS = 10000;

export interface IntegrityFinding {
  code: "protected_test_modified" | "protected_test_deleted" | "protected_config_added" | "incomplete_work";
  severity: "blocking" | "warning";
  file: string;
  line?: number;
  marker?: "todo" | "fixme" | "unimplemented" | "stub";
}
interface Marker {
  key: string;
  line: number;
  marker: NonNullable<IntegrityFinding["marker"]>;
  severity: IntegrityFinding["severity"];
}
export interface IntegrityBaseline {
  workspace: string;
  head: string;
  protectedFiles: { file: string; hash: string }[];
  sourceMarkers: Record<string, string[]>;
  authorizedTestChanges: string[];
}
export interface IntegrityOptions {
  /** Exact, approved repository-relative existing test or existing/new config paths. */
  authorizedTestChanges?: string[];
}

function hash(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}
function canonicalPath(file: string): void {
  if (
    !file || isAbsolute(file) || /[\\:\x00-\x1f\x7f*?\[\]{}]/.test(file) ||
    file.split("/").some((part) => !part || part === "." || part === ".." ||
      part.toLowerCase() === ".git" || /[. ]$/.test(part))
  ) throw new Error("Integrity requires canonical repository-relative file paths");
}
function isValidationConfig(file: string): boolean {
  const name = file.toLowerCase().split("/").at(-1)!;
  return /^(?:vite|vitest|jest|playwright|cypress|karma|ava|nyc|mocha|wdio|babel|eslint)\.config\./.test(name) ||
    /^(?:vitest\.workspace|jest\.preset)\./.test(name) ||
    /^tsconfig.*\.jsonc?$/.test(name) ||
    /^(?:\.mocharc|\.nycrc|\.babelrc|\.eslintrc)(?:\.|$)/.test(name) ||
    ["jsconfig.json", ".eslintignore", "package.json", "pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg", "phpunit.xml", "phpunit.xml.dist", "testng.xml", "conftest.py", "pest.php"].includes(name);
}
function isProtected(file: string): boolean {
  const parts = file.toLowerCase().split("/");
  const name = parts.at(-1)!;
  return isValidationConfig(file) ||
    parts.some((part) => ["test", "tests", "__tests__", "__snapshots__", "e2e", "cypress"].includes(part)) ||
    /(?:^|[._-])(?:test|spec)(?:[._-]|$)/.test(name);
}
function isSource(file: string): boolean {
  return !isProtected(file) && /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|ps1|sql|vue|svelte)$/i.test(file);
}
async function gitBytes(workspace: string, ...args: string[]): Promise<Buffer> {
  try {
    return (await exec("git", ["-C", workspace, ...args], {
      encoding: "buffer", maxBuffer: MAX_SOURCE_BYTES * 2, windowsHide: true,
    })).stdout;
  } catch {
    throw new Error("Integrity could not read the committed repository snapshot");
  }
}
async function workspaceRoot(workspace: string): Promise<string> {
  const root = await realpath(workspace);
  if (root !== await realpath(await git(root, "rev-parse", "--show-toplevel")))
    throw new Error("Integrity workspace must be the repository root");
  return root;
}
async function safeFile(workspace: string, file: string): Promise<Buffer | undefined> {
  canonicalPath(file);
  const full = join(workspace, file);
  const rel = relative(workspace, full);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("Integrity file escaped the repository");
  let path = workspace;
  const parts = file.split("/");
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]!);
    let stat;
    try { stat = await lstat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Integrity could not inspect a repository file");
    }
    const last = index === parts.length - 1;
    if (stat.isSymbolicLink() || (last ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
      throw new Error("Integrity rejects aliased or nonregular repository files");
    if (last && stat.size > MAX_FILE_BYTES)
      throw new Error("Integrity inventory exceeds the per-file size limit");
  }
  return readFile(full);
}
function markers(content: Buffer): Marker[] {
  if (content.length > MAX_FILE_BYTES || content.includes(0))
    throw new Error("Integrity cannot inventory oversized or binary source files");
  const result: Marker[] = [];
  const lines = content.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    let marker: Marker["marker"] | undefined;
    let severity: Marker["severity"] = "blocking";
    const executable = /\b(?:throw|raise)\b/.test(line) ? lines.slice(index, index + 4).join("\n") : line;
    if (/\b(?:raise\s+NotImplemented(?:Error)?|throw\s+new\s+(?:NotImplemented(?:Error|Exception)|Error\s*\(\s*["'`]\s*(?:not[ -]implemented|unimplemented)\b))/i.test(executable) ||
      /\b(?:todo!|unimplemented!)\s*\(/.test(line)) marker = "unimplemented";
    else if (/(?:\/\/|#|\/\*|^\s*\*|--)\s*(?:(?:implementation\s+)?stub\b|placeholder\s+implementation\b)/i.test(line)) marker = "stub";
    else {
      const pending = /(?:\/\/|#|\/\*|^\s*\*|--)[ \t]*(TODO|FIXME)\b/.exec(line);
      if (pending) {
        marker = pending[1]!.toLowerCase() as "todo" | "fixme";
        severity = "warning";
      }
    }
    if (marker) result.push({ key: hash(`${marker}\0${line.trim()}`), line: index + 1, marker, severity });
    if (result.length > MAX_MARKERS) throw new Error("Integrity marker inventory exceeds the limit");
  }
  return result;
}

/** Capture before production. Test/config baselines must already match HEAD. */
export async function captureIntegrityBaseline(
  workspace: string,
  options: IntegrityOptions = {},
): Promise<IntegrityBaseline> {
  const root = await workspaceRoot(workspace);
  const head = await git(root, "rev-parse", "HEAD");
  const entries = (await gitBytes(root, "ls-tree", "-rz", "--full-tree", head)).toString("utf8").split("\0").filter(Boolean).map((entry) => {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error("Integrity could not parse the committed repository snapshot");
    const [, mode, type, object, file] = match;
    canonicalPath(file!);
    return { mode: mode!, type: type!, object: object!, file: file! };
  });
  const authorized = new Set(options.authorizedTestChanges ?? []);
  for (const file of authorized) {
    canonicalPath(file);
    if (!isValidationConfig(file) && !entries.some((entry) => entry.file === file && isProtected(file)))
      throw new Error("Integrity test exceptions must name an existing protected file or validation config exactly");
  }
  const baseline: IntegrityBaseline = { workspace: root, head, protectedFiles: [], sourceMarkers: Object.create(null) as Record<string, string[]>, authorizedTestChanges: [...authorized] };
  let sourceCount = 0, sourceBytes = 0;
  for (const entry of entries) {
    if (!isProtected(entry.file) && !isSource(entry.file)) continue;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      throw new Error("Integrity rejects aliased or nonregular committed files");
    if (isProtected(entry.file)) {
      // Approved changes are exempt from content protection, never path checks.
      const content = await safeFile(root, entry.file);
      if (authorized.has(entry.file)) continue;
      if (!content) throw new Error("Integrity baseline contains a missing protected test/config file");
      const committed = await gitBytes(root, "cat-file", "blob", entry.object);
      const normalizeText = (bytes: Buffer) => bytes.includes(0) ? bytes : Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
      if (!normalizeText(content).equals(normalizeText(committed)))
        throw new Error("Integrity baseline contains a modified protected test/config file");
      baseline.protectedFiles.push({ file: entry.file, hash: hash(content) });
    } else {
      if (++sourceCount > MAX_SOURCE_FILES) throw new Error("Integrity source inventory exceeds the file limit");
      const content = await gitBytes(root, "cat-file", "blob", entry.object);
      sourceBytes += content.length;
      if (sourceBytes > MAX_SOURCE_BYTES) throw new Error("Integrity source inventory exceeds the byte limit");
      baseline.sourceMarkers[entry.file] = markers(content).map((marker) => marker.key);
    }
  }
  return baseline;
}

/** Inspect against the captured commit, including staged, committed and new files. */
export async function inspectIntegrity(
  workspace: string,
  baseline: IntegrityBaseline,
): Promise<IntegrityFinding[]> {
  const root = await workspaceRoot(workspace);
  if (root !== baseline.workspace) throw new Error("Integrity baseline belongs to another workspace");
  const findings: IntegrityFinding[] = [];
  const authorized = new Set(baseline.authorizedTestChanges);
  const existingProtected = new Set(baseline.protectedFiles.map((entry) => entry.file));
  for (const entry of baseline.protectedFiles) {
    const content = await safeFile(root, entry.file);
    if (!content || hash(content) !== entry.hash) findings.push({
      code: content ? "protected_test_modified" : "protected_test_deleted",
      severity: "blocking", file: entry.file,
    });
  }
  const changed = (await gitBytes(root, "diff", "--name-only", "--no-renames", "-z", baseline.head)).toString("utf8").split("\0");
  const added = (await gitBytes(root, "ls-files", "--others", "--exclude-standard", "-z")).toString("utf8").split("\0");
  const sources = [...new Set([...Object.keys(baseline.sourceMarkers), ...changed, ...added].filter(Boolean))];
  let sourceCount = 0, sourceBytes = 0, markerCount = 0;
  for (const file of sources) {
    canonicalPath(file);
    // Validate new tests as well; test additions must not conceal filesystem aliases.
    if (isProtected(file)) {
      const content = await safeFile(root, file);
      if (content && isValidationConfig(file) && !existingProtected.has(file) && !authorized.has(file))
        findings.push({ code: "protected_config_added", severity: "blocking", file });
      continue;
    }
    if (!isSource(file)) continue;
    if (++sourceCount > MAX_SOURCE_FILES) throw new Error("Integrity source inventory exceeds the file limit");
    const content = await safeFile(root, file);
    if (!content) continue;
    sourceBytes += content.length;
    if (sourceBytes > MAX_SOURCE_BYTES) throw new Error("Integrity source inventory exceeds the byte limit");
    const remaining = new Map<string, number>();
    for (const key of baseline.sourceMarkers[file] ?? []) remaining.set(key, (remaining.get(key) ?? 0) + 1);
    for (const marker of markers(content)) {
      if (++markerCount > MAX_MARKERS) throw new Error("Integrity marker inventory exceeds the limit");
      const count = remaining.get(marker.key) ?? 0;
      if (count) { remaining.set(marker.key, count - 1); continue; }
      findings.push({ code: "incomplete_work", severity: marker.severity, file, line: marker.line, marker: marker.marker });
    }
  }
  return findings;
}
