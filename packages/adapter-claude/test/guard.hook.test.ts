import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerWriter } from "@clockwork/core";
import type { GuardConfig } from "../src/guard/config.js";
import { handleHookInput } from "../src/guard/hook.js";

describe("handleHookInput — end-to-end over real files", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "clockwork-hook-"));
    await mkdir(join(projectDir, ".teamsmith"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeGuard(overrides: Partial<GuardConfig> = {}): Promise<void> {
    const config: GuardConfig = {
      version: 1,
      project_root: projectDir,
      worktrees: { "wu-api": join(projectDir, "wt", "wu-api") },
      owns: { "wu-api": ["src/api/**"] },
      allow_main_tree: false,
      ...overrides,
    };
    await writeFile(join(projectDir, ".teamsmith", "guard.json"), JSON.stringify(config), "utf8");
  }

  function payload(toolName: string, toolInput: Record<string, unknown>): string {
    return JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd: projectDir });
  }

  it("denies an out-of-scope write through the full stdin→decision path", async () => {
    await writeGuard();
    const result = await handleHookInput(
      payload("Write", { file_path: join(projectDir, "wt", "wu-api", "src", "web", "x.ts") }),
      projectDir,
    );
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain("out of scope");
  });

  it("allows an in-scope write", async () => {
    await writeGuard();
    const result = await handleHookInput(
      payload("Write", { file_path: join(projectDir, "wt", "wu-api", "src", "api", "x.ts") }),
      projectDir,
    );
    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("computes spend from the real ledger and enforces the ceiling", async () => {
    await writeGuard({ budget: { ceiling: 10_000 } });
    const writer = await LedgerWriter.open(join(projectDir, ".teamsmith", "ledger.jsonl"));
    await writer.append("run.started", { data: { run_id: "run-1" } });
    await writer.append("budget.spent", { data: { tokens: 15_000 } });

    const result = await handleHookInput(
      payload("Write", { file_path: join(projectDir, "wt", "wu-api", "src", "api", "x.ts") }),
      projectDir,
    );
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain("budget target reached");
  });

  it("honors the control file pause flag", async () => {
    await writeGuard();
    await writeFile(
      join(projectDir, ".teamsmith", "control.json"),
      JSON.stringify({ paused: true }),
      "utf8",
    );
    const result = await handleHookInput(payload("Bash", { command: "npm test" }), projectDir);
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain("paused");
  });

  it("allows everything when no guard file exists (inactive project)", async () => {
    const result = await handleHookInput(
      payload("Write", { file_path: join(projectDir, "anything.ts") }),
      projectDir,
    );
    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("fails closed on a corrupted guard file", async () => {
    await writeFile(join(projectDir, ".teamsmith", "guard.json"), "{broken", "utf8");
    const result = await handleHookInput(
      payload("Write", { file_path: join(projectDir, "x.ts") }),
      projectDir,
    );
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("keeps trusted guard active when payload cwd changes", async () => {
    await writeGuard();
    const result = await handleHookInput(JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo harmless" }, cwd: tmpdir() }), projectDir);
    expect(result.hookSpecificOutput.permissionDecision).toBe("ask");
  });
  it("finds guards from descendants and ignores nested replacement under trusted root", async () => {
    await writeGuard();
    const child = join(projectDir, "child");
    await mkdir(join(child, ".teamsmith"), { recursive: true });
    await writeFile(join(child, ".teamsmith", "guard.json"), "{}");
    const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo x" }, cwd: child });
    expect((await handleHookInput(input, projectDir)).hookSpecificOutput.permissionDecision).toBe("ask");
    await rm(join(child, ".teamsmith"), { recursive: true });
    expect((await handleHookInput(input, child)).hookSpecificOutput.permissionDecision).toBe("ask");
  });
  it("authentic outer policy overrides forged nested configs from either cwd", async () => {
    await writeGuard();
    const child = join(projectDir, "wt", "wu-api", "src", "api");
    await mkdir(join(child, ".teamsmith"), { recursive: true });
    await writeFile(join(child, ".teamsmith", "guard.json"), JSON.stringify({ version: 1, project_root: child, worktrees: {}, owns: {}, allow_main_tree: true }));
    const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(child, "secret.ts") }, cwd: child });
    // The real policy owns this subtree; a nested config cannot claim it as main tree.
    for (const fallback of [projectDir, child]) {
      const result = await handleHookInput(input, fallback);
      expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
      expect(result.hookSpecificOutput.permissionDecisionReason).toContain("wu-api");
    }
    expect((await handleHookInput(JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(child, ".teamsmith", "guard.json") }, cwd: child }), projectDir)).hookSpecificOutput.permissionDecision).toBe("deny");
  });
  it("validates discovery root and keeps explicit anchors authoritative", async () => {
    await writeGuard({ project_root: tmpdir() });
    expect((await handleHookInput(payload("Bash", { command: "echo x" }), projectDir)).hookSpecificOutput.permissionDecision).toBe("deny");
    await writeGuard();
    const externalInput = JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo x" }, cwd: tmpdir() });
    expect((await handleHookInput(externalInput, projectDir, true)).hookSpecificOutput.permissionDecision).toBe("ask");
  });
  it("fails closed for malformed payloads, configs, regexes and control", async () => {
    for (const raw of ["null", "[]", '{"tool_name":"Write","tool_input":[]}']) expect((await handleHookInput(raw, projectDir)).hookSpecificOutput.permissionDecision).toBe("deny");
    for (const bad of [null, [], { version: 1, project_root: projectDir }]) {
      await writeFile(join(projectDir, ".teamsmith", "guard.json"), JSON.stringify(bad));
      expect((await handleHookInput(payload("Bash", { command: "echo x" }), projectDir)).hookSpecificOutput.permissionDecision).toBe("deny");
    }
    await writeGuard({ class3_patterns: ["["] });
    expect((await handleHookInput(payload("Bash", { command: "x" }), projectDir)).hookSpecificOutput.permissionDecision).toBe("deny");
    await writeGuard();
    for (const raw of ["{", "null", "[]", '{"paused":"false"}']) {
      await writeFile(join(projectDir, ".teamsmith", "control.json"), raw);
      expect((await handleHookInput(payload("Bash", { command: "clockwork resume" }), projectDir)).hookSpecificOutput.permissionDecision).toBe("deny");
    }
  });
  it("denies symlink ancestor escapes for newly created files", async (context) => {
    await writeGuard();
    const api = join(projectDir, "wt", "wu-api", "src", "api");
    await mkdir(api, { recursive: true });
    try { await symlink(tmpdir(), join(api, "escape"), process.platform === "win32" ? "junction" : "dir"); }
    catch (err) { if (["EPERM", "EACCES", "ENOTSUP"].includes((err as NodeJS.ErrnoException).code ?? "")) { context.skip(); return; } throw err; }
    expect((await handleHookInput(payload("Write", { file_path: join(api, "escape", "new-file.ts") }), projectDir)).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("fails closed on unparseable hook input", async () => {
    const result = await handleHookInput("not json at all", projectDir);
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
