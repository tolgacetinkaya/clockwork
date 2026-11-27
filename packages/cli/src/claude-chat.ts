import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { atomicWrite, withStorageLock, assertStorageFile } from "@clockwork/core";
import { ManagedClaudeSession, sessionPolicy, type SessionEvent } from "@clockwork/adapter-claude";

export function chatPolicy(flags: Record<string, string>) {
  const known = new Set(["claude-bin", "prompt", "resume", "model", "compact-at", "cache-ttl", "keep-warm", "warm-interval-minutes", "warm-max-calls", "warm-duration-minutes", "warm-max-cost-usd", "max-cost-usd", "timeout-ms", "once"]);
  if (Object.keys(flags).some(k => !known.has(k))) throw new Error("Unknown claude chat flag");
  for (const k of ["keep-warm", "once"]) if (flags[k] !== undefined && !["true", "false"].includes(flags[k]!)) throw new Error(`${k} must be true or false`);
  if (flags["keep-warm"] === "true" && flags.once === "true") throw new Error("keep-warm cannot be combined with once");
  return sessionPolicy({
    ...(flags["compact-at"] === undefined ? {} : { autoCompactTokens: Number(flags["compact-at"]) }),
    ...(flags["cache-ttl"] === undefined ? {} : { cacheTtl: flags["cache-ttl"] }),
    ...(flags["timeout-ms"] === undefined ? {} : { turnTimeoutMs: Number(flags["timeout-ms"]) }),
    ...(flags["max-cost-usd"] === undefined ? {} : { maxEstimatedCostUsd: Number(flags["max-cost-usd"]) }),
    keepWarm: {
      enabled: flags["keep-warm"] === "true",
      ...(flags["warm-interval-minutes"] === undefined ? {} : { intervalMs: Number(flags["warm-interval-minutes"]) * 60000 }),
      ...(flags["warm-max-calls"] === undefined ? {} : { maxCalls: Number(flags["warm-max-calls"]) }),
      ...(flags["warm-duration-minutes"] === undefined ? {} : { maxDurationMs: Number(flags["warm-duration-minutes"]) * 60000 }),
      ...(flags["warm-max-cost-usd"] === undefined ? {} : { maxEstimatedCostUsd: Number(flags["warm-max-cost-usd"]) }),
    },
  });
}
export async function claudeChat(cwd: string, flags: Record<string, string>): Promise<{ code: number; out: string }> {
  const policy = chatPolicy(flags);
  const executable = flags["claude-bin"];
  if (!executable || !isAbsolute(executable) || !(await stat(executable)).isFile()) throw new Error("claude chat requires --claude-bin with an absolute native Claude executable path");
  if (!flags.prompt?.trim() || flags.prompt.length > 100000 || flags.prompt.trimStart().startsWith("/")) throw new Error("claude chat requires a plain --prompt (maximum 100000 characters)");
  if (policy.keepWarm.enabled && !process.stdin.isTTY) throw new Error("keep-warm requires an interactive terminal; no unattended daemon is started");
  const once = flags.once === "true" || !process.stdin.isTTY;
  const id = flags.resume ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("resume must be a Clockwork managed session UUID");
  const project = await realpath(cwd);
  const dir = join(homedir(), ".clockwork", "claude-sessions");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  return withStorageLock(file, async () => {
    await assertStorageFile(file);
    if (flags.resume) {
      if ((await stat(file)).size > 65536) throw new Error("Managed session metadata is too large");
      const old = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      if (old.schema !== 1 || old.sessionId !== id || old.project !== project || old.role !== "chat") throw new Error("Session does not belong to this project and chat role");
      if (flags.model && flags.model !== old.model) throw new Error("Resume must retain the original model; start a new chat to switch models");
      if (typeof old.model === "string") flags = { ...flags, model: old.model };
    }
    const input = once ? undefined : createInterface({ input: process.stdin, output: process.stdout });
    let pendingApproval: ((answer: boolean) => void) | undefined;
    let last: Record<string, unknown> = { schema: 1, sessionId: id, project, role: "chat", model: flags.model, policy };
    let failed = false;
    let completed = false;
    const session = new ManagedClaudeSession({
      cwd: project, executable, id, resume: !!flags.resume, model: flags.model, policy,
      approveTool: async (tool, args) => {
        if (!input || pendingApproval) return { behavior: "deny", message: "No interactive approval available" };
        process.stdout.write(`\nApprove ${tool}? ${JSON.stringify(args).slice(0, 12000)}\nType yes or no: `);
        const accepted = await new Promise<boolean>(resolve => { pendingApproval = resolve; });
        pendingApproval = undefined;
        return accepted ? { behavior: "allow", updatedInput: args } : { behavior: "deny", message: "User declined" };
      },
      onEvent: async (event: SessionEvent) => {
        const { text, ...metadata } = event;
        last = { ...last, ...metadata, updatedAt: new Date().toISOString() };
        await atomicWrite(file, JSON.stringify(last, null, 2));
        if (text) process.stdout.write(`\n${text}\n`);
        process.stdout.write(`${JSON.stringify(metadata)}\n`);
        if (event.type === "failed" || (event.type === "stopped" && !["closed", "user exit", "one turn complete"].includes(event.reason ?? ""))) failed = true;
        if (event.type === "turn_completed" && event.kind === "user") { completed = true; if (once) session.stop("one turn complete"); }
      },
    });
    const stop = () => { pendingApproval?.(false); session.stop("user exit"); };
    input?.on("line", line => {
      if (pendingApproval) { const resolve = pendingApproval; pendingApproval = undefined; resolve(line.trim().toLowerCase() === "yes"); return; }
      if (line.trim() === "/exit") { stop(); return; }
      if (line.trim() === "/warm off") { session.disableWarm(); process.stdout.write("Keep-warm disabled for this invocation.\n"); return; }
      if (!line.trim()) return;
      try { if (!session.send(line)) process.stdout.write("A turn is still active; send your message after it finishes.\n"); }
      catch (error) { process.stdout.write(`${(error as Error).message}\n`); }
    });
    input?.on("close", stop);
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      await session.run(flags.prompt!);
      return { code: failed || !completed ? 1 : 0, out: `Claude session ${id} closed. Resume with --resume ${id}. No background keep-warm process remains.` };
    } finally {
      stop(); input?.close();
      process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    }
  });
}
