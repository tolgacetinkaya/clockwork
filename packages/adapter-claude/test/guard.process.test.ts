import { spawn } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleHookInput } from "../src/guard/hook.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("installed hook process boundary", () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "clockwork-hook-process-"));
    await mkdir(join(project, ".teamsmith"));
    await writeFile(join(project, ".teamsmith", "guard.json"), JSON.stringify({
      version: 1, project_root: project, worktrees: {}, owns: {},
      allow_main_tree: true, main_tree_scopes: ["src/**"],
    }));
  });
  afterEach(async () => { await rm(project, { recursive: true, force: true }); });

  it.each(["CLOCKWORK_PROJECT_ROOT", "TEAMSMITH_PROJECT_ROOT"] as const)("executes the configured hook command with the %s launcher anchor", async (anchorName) => {
    const wiring = JSON.parse(await readFile(join(root, "plugin", "hooks", "hooks.json"), "utf8"));
    const registered = wiring.hooks.PreToolUse[0];
    expect(new RegExp(registered.matcher).test("FutureMutationTool")).toBe(true);
    const pluginRoot = join(root, "plugin");
    const command = registered.hooks[0].command as string;
    const args = [...command.matchAll(/"([^"]+)"/g)].map(match => match[1]!.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot));
    const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: tmpdir(), env: { ...process.env, CLOCKWORK_PROJECT_ROOT: undefined, TEAMSMITH_PROJECT_ROOT: undefined, [anchorName]: project },
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
      let out = "", err = "";
      child.stdout.on("data", chunk => { out += chunk; });
      child.stderr.on("data", chunk => { err += chunk; });
      child.on("error", reject);
      child.on("close", code => resolve({ code, out, err }));
      child.stdin.end(JSON.stringify({ tool_name: "Bash", tool_input: { command: "node script.js" }, cwd: tmpdir() }));
    });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("denies existing hard-linked files that alias data outside ownership", async () => {
    const source = join(project, "outside.txt");
    const target = join(project, "src", "alias.txt");
    await mkdir(dirname(target));
    await writeFile(source, "fixture");
    await link(source, target);
    const result = await handleHookInput(JSON.stringify({
      tool_name: "Edit", tool_input: { file_path: target }, cwd: project,
    }), project);
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(await readFile(source, "utf8")).toBe("fixture");
  });
});
