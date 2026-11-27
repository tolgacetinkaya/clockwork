import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Options, SDKMessage, SDKUserMessage, Query, ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import { handleHookInput } from "../guard/hook.js";
import { IdlePolicy, sessionEnv, sessionPolicy, type SessionPolicy } from "./policy.js";

export const WARM_PROMPT = "Idle connection check. Reply only OK. Do not continue any task, use tools, read files, or start agents.";
type Kind = "user" | "warm";
export interface UsageSnapshot { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; estimatedCostUsd: number }
export interface SessionEvent {
  type: "warm_disabled" | "ready" | "started" | "turn_started" | "turn_completed" | "compacted" | "stopped" | "failed";
  sessionId: string;
  model?: string;
  kind?: Kind;
  usage?: UsageSnapshot;
  cumulativeUsage?: UsageSnapshot;
  text?: string;
  reason?: string;
  warmCalls: number;
  warmEnabled: boolean;
  warmEstimatedCostUsd: number;
}
type SessionQuery = Pick<Query, typeof Symbol.asyncIterator | "close">;
export type QueryFactory = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => SessionQuery;
export function usageSnapshot(models: Record<string, ModelUsage>, total: number): UsageSnapshot | undefined {
  if (!models || !Object.keys(models).length || !Number.isFinite(total) || total < 0) return undefined;
  const value: UsageSnapshot = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: total };
  for (const model of Object.values(models)) {
    for (const key of ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"] as const) {
      if (!Number.isSafeInteger(model[key]) || model[key] < 0) return undefined;
      value[key] += model[key];
      if (!Number.isSafeInteger(value[key])) return undefined;
    }
  }
  return value;
}
function delta(next: UsageSnapshot, previous: UsageSnapshot): UsageSnapshot | undefined {
  const value = { ...next };
  for (const key of Object.keys(next) as (keyof UsageSnapshot)[]) {
    value[key] -= previous[key];
    if (value[key] < -1e-9) return undefined;
    value[key] = Math.max(0, value[key]);
  }
  return value;
}
class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private ended = false;
  push(text: string): void { this.queue.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid: randomUUID() }); this.wake?.(); }
  close(): void { this.ended = true; this.queue = []; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (!this.ended) {
      const value = this.queue.shift();
      if (value) yield value;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}
export interface ManagedSessionOptions {
  cwd: string;
  executable: string;
  id: string;
  resume?: boolean;
  model?: string;
  policy: SessionPolicy;
  onEvent: (event: SessionEvent) => Promise<void>;
  approveTool?: NonNullable<Options["canUseTool"]>;
  factory?: QueryFactory;
  now?: () => number;
}
/** One SDK process, one conversation. Never attached to another terminal or worker. */
export class ManagedClaudeSession {
  readonly idle: IdlePolicy;
  private readonly policy: SessionPolicy;
  private readonly inbox = new Inbox();
  private readonly abort = new AbortController();
  private readonly now: () => number;
  private query?: SessionQuery;
  private kind?: Kind;
  private since = 0;
  private closed = false;
  private started = false;
  private reason = "closed";
  private previous: UsageSnapshot | undefined;
  private eventQueue = Promise.resolve();
  private eventFailure = false;
  constructor(private readonly config: ManagedSessionOptions) {
    this.policy = sessionPolicy(config.policy);
    this.now = config.now ?? (() => performance.now());
    this.idle = new IdlePolicy(this.policy, this.now());
    // A resumed transcript may have unrecorded turns. First user result establishes
    // a new baseline; never bill all historical tokens as a keep-warm request.
    this.previous = config.resume ? undefined : { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0 };
  }
  get active(): boolean { return this.idle.active; }
  private emit(event: Omit<SessionEvent, "sessionId" | "warmCalls" | "warmEnabled" | "warmEstimatedCostUsd">): void {
    const full = { ...event, sessionId: this.config.id, warmCalls: this.idle.calls, warmEnabled: this.idle.warmEnabled, warmEstimatedCostUsd: this.idle.estimatedCostUsd };
    this.eventQueue = this.eventQueue.then(() => this.config.onEvent(full)).catch(() => { this.eventFailure = true; this.stop("session storage failed"); });
  }
  send(text: string): boolean {
    if (!text.trim() || text.length > 100000 || text.trimStart().startsWith("/")) throw new Error("Use a plain message of at most 100000 characters; slash commands are not forwarded");
    if (this.closed || !this.idle.beginUser(this.now())) return false;
    this.dispatch("user", text); return true;
  }
  private dispatch(kind: Kind, text: string): void {
    this.kind = kind; this.since = this.now();
    this.emit({ type: "turn_started", kind }); this.inbox.push(text);
  }
  tick(): void {
    if (this.closed) return;
    if (this.active && this.now() - this.since >= (this.kind === "warm" ? Math.min(60000, this.policy.turnTimeoutMs) : this.policy.turnTimeoutMs)) { this.stop("turn timeout; usage may be incomplete"); return; }
    const wasEnabled = this.idle.warmEnabled;
    if (this.idle.beginWarm(this.now())) this.dispatch("warm", WARM_PROMPT);
    else if (wasEnabled && !this.idle.warmEnabled) this.emit({ type: "warm_disabled", reason: "keep-warm policy limit reached" });
  }
  disableWarm(): void {
    this.idle.disable(); this.emit({ type: "warm_disabled", reason: "disabled by user" });
  }
  stop(reason = "closed"): void {
    if (this.closed) return;
    this.closed = true; this.reason = reason; this.idle.stop(); this.inbox.close(); this.abort.abort(); this.query?.close();
  }
  private async options(): Promise<Options> {
    return {
      cwd: this.config.cwd, pathToClaudeCodeExecutable: this.config.executable,
      ...(this.config.resume ? { resume: this.config.id } : { sessionId: this.config.id }),
      ...(this.config.model ? { model: this.config.model } : {}),
      env: sessionEnv(this.policy, process.env), abortController: this.abort,
      persistSession: true, settingSources: [], strictMcpConfig: true, mcpServers: {},
      tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
      permissionMode: "default", maxTurns: 30, maxBudgetUsd: this.policy.maxEstimatedCostUsd,
      canUseTool: async (...args) => this.kind === "warm" || this.closed ? { behavior: "deny", message: "No tools during keep-warm or shutdown" } : this.config.approveTool ? this.config.approveTool(...args) : { behavior: "deny", message: "Explicit terminal approval required" },
      hooks: {
        PreToolUse: [{ onFailure: "block", hooks: [async input => {
          if (this.kind === "warm" || this.closed || input.hook_event_name !== "PreToolUse") return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Tools disabled for idle probes or shutdown" } };
          if (input.tool_name === "Bash" && (input.tool_input as Record<string, unknown>)?.run_in_background) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Background commands are unsupported in managed chat" } };
          const guarded = await handleHookInput(JSON.stringify(input), this.config.cwd, true);
          // A guard allow must not bypass Claude's normal permissions.
          return guarded.hookSpecificOutput.permissionDecision === "allow" ? {} : guarded;
        }] }],
      },
    };
  }
  async run(initialPrompt: string): Promise<void> {
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      if (this.closed || this.started) throw new Error("Session already started or closed");
      this.started = true;
      const factory = this.config.factory ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
      this.emit({ type: "started" });
      if (!this.send(initialPrompt)) throw new Error("Session is busy");
      await this.eventQueue;
      if (this.closed) throw new Error("Session stopped before launch");
      this.query = factory({ prompt: this.inbox, options: await this.options() });
      timer = setInterval(() => this.tick(), 1000);
      for await (const message of this.query) {
        if (this.closed) break;
        if ("session_id" in message && message.session_id !== this.config.id) throw new Error("Unexpected Claude session identity");
        if (message.type === "system" && message.subtype === "init") this.emit({ type: "ready", model: message.model });
        if (message.type === "system" && message.subtype === "compact_boundary") this.emit({ type: "compacted" });
        if (message.type !== "result") continue;
        if (!this.kind) throw new Error("Unexpected unrequested result");
        const kind = this.kind;
        const cumulativeUsage = usageSnapshot(message.modelUsage, message.total_cost_usd);
        const usage = cumulativeUsage && this.previous ? delta(cumulativeUsage, this.previous) : undefined;
        const resumedBaseline = !this.previous && !!cumulativeUsage;
        this.previous = cumulativeUsage;
        const success = message.subtype === "success" && !message.is_error;
        this.idle.finish(kind, success, usage?.estimatedCostUsd ?? (resumedBaseline && kind === "user" ? 0 : undefined));
        this.kind = undefined;
        if (kind === "warm" && usage && usage.outputTokens > 64) this.idle.disable();
        this.emit({ type: "turn_completed", kind, usage, cumulativeUsage,
          ...(kind === "user" && message.subtype === "success" ? { text: message.result } : {}),
          ...(!usage ? { reason: resumedBaseline ? "resumed baseline; this turn usage is unknown" : "usage unknown; keep-warm disabled" } : {}),
        });
        if (!success) this.stop("provider turn failed; no automatic retry");
        await this.eventQueue;
      }
      if (!this.closed && this.kind) this.stop("provider closed before result; usage unknown");
    } catch (error) {
      if (!this.closed) {
        const reason = error instanceof Error && error.message.includes("onFailure") ? "Claude CLI cannot enforce fail-closed hooks; update Claude Code" : "Claude session failed; no automatic retry";
        this.emit({ type: "failed", reason }); this.stop("provider failure");
      }
    } finally {
      if (timer) clearInterval(timer);
      this.stop();
      this.emit({ type: "stopped", reason: this.reason });
      await this.eventQueue;
    }
    if (this.eventFailure) throw new Error("Could not persist session status");
  }
}
