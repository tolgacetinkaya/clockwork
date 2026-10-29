import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkWorkspace, git } from "../src/workspace.js";

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
});
