import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, posix } from "node:path";
const exec = promisify(execFile);
export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (
    await exec("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
  ).stdout.trimEnd();
}
export async function checkWorkspace(
  project: string,
  workspace: string,
): Promise<string> {
  const [root, worker] = await Promise.all([
    realpath(project),
    realpath(resolve(project, workspace)),
  ]);
  const rel = relative(worker, root);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw new Error(
      "Worker must use a separate linked Git worktree outside the control directory",
    );
  if (!(await lstat(join(worker, ".git"))).isFile())
    throw new Error(
      "Worker must be a linked Git worktree, not another repository",
    );
  const common = async (cwd: string) =>
    realpath(resolve(cwd, await git(cwd, "rev-parse", "--git-common-dir")));
  if ((await common(root)) !== (await common(worker)))
    throw new Error("Worker worktree belongs to a different Git repository");
  if (
    (await realpath(await git(worker, "rev-parse", "--show-toplevel"))) !==
    worker
  )
    throw new Error("Workspace must be the worktree root");
  return worker;
}
export async function fingerprint(
  workspace: string,
): Promise<{ head: string; hash: string; files: string[] }> {
  const head = await git(workspace, "rev-parse", "HEAD");
  const tracked = (await git(workspace, "diff", "--name-only", "-z", "HEAD"))
    .split("\0")
    .filter(Boolean);
  const untracked = (
    await git(workspace, "ls-files", "--others", "--exclude-standard", "-z")
  )
    .split("\0")
    .filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])].sort();
  const hash = createHash("sha256")
    .update(head)
    .update(await git(workspace, "diff", "--binary", "HEAD"));
  for (const name of files) {
    hash.update("\0" + name + "\0");
    try {
      const path = join(workspace, name),
        stat = await lstat(path);
      if (!stat.isFile() || stat.nlink > 1)
        throw new Error("Aliased or nonregular changed files are unsupported");
      hash.update(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("deleted");
    }
  }
  return { head, hash: hash.digest("hex"), files };
}
export function withinOwnership(file: string, scopes: string[]): boolean {
  if (
    file
      .split("/")
      .some((part) =>
        [".git", ".teamsmith", ".codex", ".claude"].includes(
          part.toLowerCase(),
        ),
      )
  )
    return false;
  return scopes.some((scope) => {
    if (
      isAbsolute(scope) ||
      scope.includes("\\") ||
      scope.includes(":") ||
      scope.split("/").includes("..")
    )
      return false;
    return posix.matchesGlob(file, scope);
  });
}
