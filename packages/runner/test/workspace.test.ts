import { link, mkdtemp, mkdir, realpath, rm, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertOwnedPath, checkWorkspace, fingerprint, git, withinOwnership } from "../src/workspace.js";

describe("linked worktree control directory isolation", () => {
  let temp: string;
  let repository: string;

  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), "clockwork-workspace-"));
    repository = join(temp, "repository");
    await mkdir(repository);
    await git(repository, "init", "-b", "main");
    await writeFile(join(repository, "README.md"), "baseline\n");
    await git(repository, "add", ".");
    await git(
      repository,
      "-c", "user.name=Test",
      "-c", "user.email=test@example.invalid",
      "commit", "-m", "baseline",
    );
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it.each(["..control", "control"])(
    "rejects an ancestor worker when the control worktree is named %s",
    async (name) => {
      const worker = join(temp, "worker");
      const control = join(worker, name);
      await git(repository, "worktree", "add", "--detach", worker, "HEAD");
      await git(repository, "worktree", "add", "--detach", control, "HEAD");

      // Both paths are actual linked worktree roots of the same repository.
      // The ancestor could modify the control files through its own filesystem.
      await expect(checkWorkspace(control, worker)).rejects.toThrow(
        "outside the control directory",
      );
    },
  );

  it("rejects using the control worktree itself", async () => {
    const control = join(temp, "control");
    await git(repository, "worktree", "add", "--detach", control, "HEAD");
    await expect(checkWorkspace(control, control)).rejects.toThrow(
      "outside the control directory",
    );
  });

  it.each(["worker", "..worker"])(
    "accepts a separate sibling worktree named %s",
    async (name) => {
      const control = join(temp, "control");
      const worker = join(temp, name);
      await git(repository, "worktree", "add", "--detach", control, "HEAD");
      await git(repository, "worktree", "add", "--detach", worker, "HEAD");
      await expect(checkWorkspace(control, worker)).resolves.toBe(
        await realpath(worker),
      );
    },
  );
  async function worker(): Promise<string> {
    const path = join(temp, "worker");
    await git(repository, "worktree", "add", "--detach", path, "HEAD");
    return path;
  }

  it("rejects a worker nested inside the control worktree", async () => {
    const control = join(temp, "control");
    await git(repository, "worktree", "add", "--detach", control, "HEAD");
    const nested = join(control, "nested");
    await git(repository, "worktree", "add", "--detach", nested, "HEAD");
    await expect(checkWorkspace(control, nested)).rejects.toThrow("outside the control directory");
  });

  it("fingerprints Unicode and space-containing untracked paths and detects edits", async () => {
    const path = await worker();
    const name = "résumé space.txt";
    await writeFile(join(path, name), "first");
    const before = await fingerprint(path);
    expect(before.files).toEqual([name]);
    await writeFile(join(path, name), "other");
    expect((await fingerprint(path)).hash).not.toBe(before.hash);
    await expect(assertOwnedPath(path, name, ["*.txt"])).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("preserves newline filenames from Git NUL output but denies unsafe deliveries", async () => {
    const path = await worker();
    const name = "odd\nname\n";
    await writeFile(join(path, name), "contents");
    expect((await fingerprint(path)).files).toEqual([name]);
    await expect(assertOwnedPath(path, name, ["**"])).rejects.toThrow("outside unit ownership");
  });

  it("includes deleted tracked files in ownership checks", async () => {
    const path = await worker();
    await rm(join(path, "README.md"));
    expect((await fingerprint(path)).files).toContain("README.md");
    await expect(assertOwnedPath(path, "README.md", ["src/**"])).rejects.toThrow("outside unit ownership");
    await expect(assertOwnedPath(path, "README.md", ["README.md"])).resolves.toBeUndefined();
  });

  it("rejects hardlinked changed files", async () => {
    const path = await worker();
    await link(join(path, "README.md"), join(path, "aliased.md"));
    await expect(fingerprint(path)).rejects.toThrow("Aliased");
    await expect(assertOwnedPath(path, "aliased.md", ["*.md"])).rejects.toThrow("Aliased");
  });

  it("rejects symlink or junction ancestors escaping the linked worktree", async (context) => {
    const path = await worker();
    const outside = join(temp, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "escaped.txt"), "must not be read as a delivery");
    try { await symlink(outside, join(path, "src"), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { context.skip(); return; }
      throw error;
    }
    await expect(assertOwnedPath(path, "src/escaped.txt", ["src/**"])).rejects.toThrow("Aliased");
    await expect(assertOwnedPath(path, "src/deleted.txt", ["src/**"])).rejects.toThrow("Aliased");
    await expect(fingerprint(path)).rejects.toThrow("Aliased");
  });

  it("inventories ignored secret metadata without consuming ignored contents", async () => {
    const path = await worker();
    await writeFile(join(path, ".gitignore"), ".env\nsecret.bin\n");
    await writeFile(join(path, ".env"), "secret=one");
    await writeFile(join(path, "secret.bin"), "");
    await truncate(join(path, "secret.bin"), 64 * 1024 * 1024);
    const before = await fingerprint(path);
    expect(before.files).not.toContain(".env");
    await writeFile(join(path, ".env"), "secret=two");
    await utimes(join(path, ".env"), new Date(100_000), new Date(100_000));
    const after = await fingerprint(path);
    expect(after.ignoredHash).not.toBe(before.ignoredHash);
    expect(after.hash).not.toBe(before.hash);
  });

  it("states opaque installed-dependency coverage without traversing dependency contents", async () => {
    const path = await worker();
    await writeFile(join(path, ".gitignore"), "node_modules/\n");
    await mkdir(join(path, "node_modules", "package"), { recursive: true });
    await writeFile(join(path, "node_modules", "package", "file.js"), "one");
    const before = await fingerprint(path);
    expect(before.ignoredOpaquePaths).toEqual(["node_modules"]);
    await writeFile(join(path, "node_modules", "package", "file.js"), "two");
    expect((await fingerprint(path)).ignoredHash).toBe(before.ignoredHash);
  });

});


describe("ownership path grammar", () => {
  it.each(["../escape", "/absolute", "C:/escape", "src\\escape", "src//file", "src/./file", "src/file.", "src/file ", "src/NUL.txt", "src/file:stream"])("denies alias spelling %s", file => {
    expect(withinOwnership(file, ["**"])).toBe(false);
  });
  it.each([".git", ".teamsmith", ".codex", ".claude", ".agents", ".aws", ".ssh"])("denies hidden control component %s", part => {
    expect(withinOwnership(`src/${part.toUpperCase()}/file`, ["**"])).toBe(false);
  });
  it.each(["src/[ab].ts", "src/{a,b}.ts", "src/**x", "src/!(x)", "../**", "src/**/../*"])("fails closed on unsupported scope %s", scope => {
    expect(withinOwnership("src/a.ts", [scope])).toBe(false);
  });
  it("matches path case according to the host filesystem policy", () => {
    expect(withinOwnership("SRC/file.ts", ["src/**"])).toBe(process.platform === "win32");
  });
});
