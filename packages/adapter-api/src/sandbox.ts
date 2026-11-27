import { UnreconciledExecutionError } from "@clockwork/core";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { lstat } from "node:fs/promises";

export interface CommandResult { output: string; exitCode: number }
export interface ToolSandbox {
  check(signal: AbortSignal): Promise<void>;
  run(workspace: string, readOnly: boolean, command: string, signal: AbortSignal): Promise<CommandResult>;
}
function dockerProcess(executable: string, args: string[], signal?: AbortSignal, timeout = 60000): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    execFile(executable, args, { windowsHide: true, signal, timeout, maxBuffer: 1_048_576, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== "number" || error.killed)) {
        reject(new Error("Docker command interrupted or failed to start"));
        return;
      }
      resolveResult({ exitCode: error ? Number(error.code) : 0, output: (stdout + stderr).slice(0, 64000) });
    });
  });
}
export function sandboxArgs(image: string, name: string, workspace: string, readOnly: boolean): string[] {
  if (!isAbsolute(workspace) || /[\r\n,]/.test(workspace)) throw new Error("Invalid sandbox workspace");
  return [
    "create", "--name", name, "--pull", "never", "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "128",
    "--memory", "1g", "--cpus", "2", "--user", String(process.getuid?.() ?? 1000),
    "--tmpfs", "/tmp:rw,nosuid,noexec,size=67108864", "--workdir", "/workspace",
    "--mount", `type=bind,src=${resolve(workspace)},dst=/workspace${readOnly ? ",readonly" : ""}`,
    "--entrypoint", "/bin/sh", image, "-c", "sleep 86400",
  ];
}
/** A fresh container per command prevents detached commands surviving a tool result. */
export class DockerSandbox implements ToolSandbox {
  private readonly executable: string;
  constructor(private readonly image: string, executable?: string) {
    this.executable = executable ?? (process.platform === "win32"
      ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe")
      : process.platform === "darwin" ? "/usr/local/bin/docker" : "/usr/bin/docker");
    if (!isAbsolute(this.executable)) throw new Error("Docker executable must be an absolute host path");
  }
  private docker(args: string[], signal?: AbortSignal, timeout?: number): Promise<CommandResult> {
    return dockerProcess(this.executable, args, signal, timeout);
  }
  async check(signal: AbortSignal): Promise<void> {
    const result = await this.docker(["image", "inspect", this.image, "--format", "{{.Os}}"], signal, 15000);
    if (result.exitCode || result.output.trim() !== "linux") throw new Error("API execution requires the configured trusted Linux sandbox image locally; prepare it before launch");
  }
  async run(workspace: string, readOnly: boolean, command: string, signal: AbortSignal): Promise<CommandResult> {
    signal.throwIfAborted();
    if (typeof command !== "string" || !command.trim() || command.length > 32000 || command.includes("\0")) throw new Error("Invalid sandbox command");
    const stat = await lstat(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Sandbox workspace must be a real directory");
    const name = `clockwork-tool-${randomUUID()}`;
    let createReturned = false;
    try {
      // Let creation settle before reconciling its name, even after cancellation.
      const creation = await this.docker(sandboxArgs(this.image, name, workspace, readOnly), undefined, 15000);
      createReturned = true;
      if (creation.exitCode) throw new Error("Docker sandbox creation failed");
      signal.throwIfAborted();
      if ((await this.docker(["start", name], signal)).exitCode) throw new Error("Docker sandbox start failed");
      return await this.docker(["exec", name, "/bin/sh", "-c", command], signal);
    } finally {
      try {
        await this.docker(["rm", "--force", name], undefined, 15000);
        const inspection = await this.docker(["container", "inspect", name], undefined, 15000);
        const confirmedAbsent = inspection.exitCode !== 0 && /No such (object|container)/i.test(inspection.output);
        if (!createReturned || !confirmedAbsent) throw new Error("Container absence is uncertain");
      } catch {
        throw new UnreconciledExecutionError(`Sandbox cleanup unconfirmed for ${name}; inspect before retrying`);
      }
    }
  }
}
