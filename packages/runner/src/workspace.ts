import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, posix, sep } from "node:path";
const exec = promisify(execFile);
const controls = new Set([".git", ".teamsmith", ".codex", ".claude", ".agents", ".aws", ".ssh"]);
const folded = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
const isInside = (root: string, path: string) => {
  const rel = relative(folded(root), folded(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = (await exec("git", ["-C", cwd, ...args], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  })).stdout;
  // NUL-delimited paths may contain trailing whitespace or newlines.
  return args.includes("-z") ? result : result.replace(/\r?\n$/, "");
}
export async function checkWorkspace(project: string, workspace: string): Promise<string> {
  const [root, worker] = await Promise.all([realpath(project), realpath(resolve(project, workspace))]);
  if (isInside(worker, root) || isInside(root, worker))
    throw new Error("Worker must use a separate linked Git worktree outside the control directory");
  if (!(await lstat(join(worker, ".git"))).isFile())
    throw new Error("Worker must be a linked Git worktree, not another repository");
  const common = async (cwd: string) => realpath(resolve(cwd, await git(cwd, "rev-parse", "--git-common-dir")));
  if (folded(await common(root)) !== folded(await common(worker)))
    throw new Error("Worker worktree belongs to a different Git repository");
  if (folded(await realpath(await git(worker, "rev-parse", "--show-toplevel"))) !== folded(worker))
    throw new Error("Workspace must be the worktree root");
  return worker;
}
function canonicalRelative(path: string): boolean {
  return Boolean(path) && !isAbsolute(path) && !/[\\:\x00-\x1f\x7f]/.test(path) &&
    path.split("/").every(part => part !== "" && part !== "." && part !== ".." &&
      // Windows strips trailing dots/spaces and interprets device names specially.
      !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function validScope(scope: string): boolean {
  return canonicalRelative(scope) && !/[\[\]{}()!+@]/.test(scope) &&
    scope.split("/").every(part => !part.includes("**") || part === "**") &&
    !scope.split("/").some(part => controls.has(part.toLowerCase()));
}
export function withinOwnership(file: string, scopes: string[]): boolean {
  if (!canonicalRelative(file) || file.split("/").some(part => controls.has(part.toLowerCase()))) return false;
  return scopes.some(scope => validScope(scope) && posix.matchesGlob(folded(file), folded(scope)));
}
/** Validate every extant component before touching contents, including deleted leaves.
 * This is a delivery check, not isolation against concurrent filesystem changes.
 */
async function assertSafePath(workspace: string, file: string): Promise<void> {
  // Git permits newline filenames; fingerprint them correctly but deny them as deliveries.
  if (!file || isAbsolute(file) || file.includes("\\") || file.includes(":") || file.includes("\0") ||
      file.split("/").some(part => part === "" || part === "." || part === ".."))
    throw new Error("Unsafe workspace path");
  const root = await realpath(workspace);
  const parts = file.split("/");
  let path = root;
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]!);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !isInside(root, await realpath(path)))
        throw new Error("Aliased workspace path is unsupported");
      if (index < parts.length - 1 ? !stat.isDirectory() : (!stat.isFile() || stat.nlink > 1))
        throw new Error("Aliased or nonregular changed files are unsupported");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A missing ancestor safely implies a deleted leaf; no path is dereferenced after it.
      break;
    }
  }
}
export async function assertOwnedPath(workspace: string, file: string, scopes: string[]): Promise<void> {
  if (!withinOwnership(file, scopes)) throw new Error("Worker changed a file outside unit ownership");
  await assertSafePath(workspace, file);
}
export interface WorkspaceFingerprint {
  head: string; hash: string; files: string[]; ignoredHash: string;
  /** Contents under dependency/build caches are outside the metadata inventory. */
  ignoredOpaquePaths: string[];
}
const opaqueIgnored = new Set(["node_modules", ".venv", "venv", ".cache", ".next", "dist", "build", "coverage"]);
/** Fingerprints Git changes and ignored metadata without reading ignored secrets.
 * Ignored dependency/build directories have root metadata coverage only. Neither this
 * snapshot nor delivery path checks replace an operating-system read-only boundary.
 */
export async function fingerprint(workspace: string): Promise<WorkspaceFingerprint> {
  const head = await git(workspace, "rev-parse", "HEAD");
  const names = (value: string) => value.split("\0").filter(Boolean);
  const tracked = names(await git(workspace, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", "HEAD"));
  const untracked = names(await git(workspace, "ls-files", "--others", "--exclude-standard", "-z"));
  const files = [...new Set([...tracked, ...untracked])].sort();
  const hash = createHash("sha256").update(head);
  for (const name of files) {
    await assertSafePath(workspace, name);
    hash.update("\0" + name + "\0");
    try {
      hash.update("file\0" + String((await lstat(join(workspace, name))).mode) + "\0");
      hash.update(await readFile(join(workspace, name)));
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("deleted");
    }
  }
  // Include index-only edits and mode changes, without invoking configured diff tools.
  hash.update(await git(workspace, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary", "HEAD"));
  const ignored = createHash("sha256"), ignoredOpaquePaths: string[] = [];
  let count = 0;
  const inventory = async (name: string): Promise<void> => {
    if (++count > 20_000) throw new Error("Ignored metadata inventory limit exceeded; review the worktree manually");
    const stat = await lstat(join(workspace, name), { bigint: true });
    ignored.update(JSON.stringify([name, String(stat.mode), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs), String(stat.ino), String(stat.nlink)]));
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    if (name.split("/").some(part => opaqueIgnored.has(part.toLowerCase()))) {
      ignoredOpaquePaths.push(name); return;
    }
    for (const entry of (await readdir(join(workspace, name))).sort()) await inventory(`${name}/${entry}`);
  };
  const roots = names(await git(workspace, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"));
  for (const name of roots.sort()) {
    const clean = name.replace(/\/$/, "");
    // Never dereference an aliased ignored ancestor. Directory roots themselves are
    // inventoried with lstat and their targets are never traversed.
    const parent = clean.split("/").slice(0, -1);
    let path = workspace;
    for (const part of parent) {
      path = join(path, part);
      if ((await lstat(path)).isSymbolicLink()) throw new Error("Aliased ignored ancestor is unsupported");
    }
    await inventory(clean);
  }
  const ignoredHash = ignored.digest("hex");
  hash.update("\0ignored\0" + ignoredHash);
  return { head, hash: hash.digest("hex"), files, ignoredHash, ignoredOpaquePaths };
}
