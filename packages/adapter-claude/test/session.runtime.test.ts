import { afterEach, expect, it, vi } from "vitest";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ManagedClaudeSession, WARM_PROMPT, type SessionEvent, type QueryFactory } from "../src/session/runtime.js";
import { sessionPolicy } from "../src/session/policy.js";
import { tmpdir } from "node:os";
const id = "12345678-1234-4234-8234-123456789012";
class Messages {
  values: SDKMessage[] = []; ended = false; wake?: () => void;
  push(v: unknown) { this.values.push(v as SDKMessage); this.wake?.(); }
  close() { this.ended = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() { while (!this.ended) { const m = this.values.shift(); if (m) yield m; else await new Promise<void>(r => { this.wake = r; }); } }
}
const sessions: ManagedClaudeSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.stop(); });
function harness(resume = false, enabled = true, onEvent?: (e: SessionEvent) => Promise<void>) {
  let now = 0; let options!: Options; let input!: AsyncIterator<SDKUserMessage>;
  const messages = new Messages(); const events: SessionEvent[] = [];
  const factory: QueryFactory = args => { options = args.options; input = args.prompt[Symbol.asyncIterator](); return { [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](), close: () => messages.close() }; };
  const session = new ManagedClaudeSession({ cwd: tmpdir(), executable: "unused-test-executable", id, resume,
    policy: sessionPolicy({ autoCompactTokens: 600000, keepWarm: { enabled } }), now: () => now, factory,
    onEvent: async e => { events.push(e); await onEvent?.(e); },
  });
  sessions.push(session);
  const done = session.run("Inspect the project");
  return { session, done, messages, events, setNow: (n: number) => { now = n; },
    options: async () => { await vi.waitFor(() => expect(options).toBeDefined()); return options; },
    next: async () => { await vi.waitFor(() => expect(input).toBeDefined()); return (await input.next()).value; },
  };
}
function result(cost: number, input = 100, cached = 80, output = 10) {
  return { type: "result", subtype: "success", is_error: false, session_id: id, result: "OK", total_cost_usd: cost,
    modelUsage: { test: { inputTokens: input, outputTokens: output, cacheReadInputTokens: cached, cacheCreationInputTokens: 20 } } };
}
async function settled(h: ReturnType<typeof harness>, count: number) { await vi.waitFor(() => expect(h.events.filter(e => e.type === "turn_completed")).toHaveLength(count)); }
it("uses one conversation and blocks even auto-approved tools on a warm turn", async () => {
  const h = harness(); expect((await h.next()).message.content).toBe("Inspect the project");
  const o = await h.options(); expect(o.sessionId).toBe(id); expect(o.settingSources).toEqual([]); expect(o.strictMcpConfig).toBe(true);
  expect(o.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("600000");
  const hook = o.hooks!.PreToolUse![0]!.hooks[0]!;
  const read = { hook_event_name: "PreToolUse" as const, tool_name: "Read", tool_input: { file_path: "example.txt" }, tool_use_id: "t", session_id: id, transcript_path: "unused", cwd: tmpdir() };
  expect(await hook(read, "t", { signal: new AbortController().signal })).toEqual({});
  h.messages.push(result(0.01)); await settled(h, 1);
  h.setNow(240001); h.session.tick(); expect((await h.next()).message.content).toBe(WARM_PROMPT);
  expect(await hook(read, "t", { signal: new AbortController().signal })).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  h.messages.push(result(0.012, 110, 180, 11)); await settled(h, 2);
  const warm = h.events.find(e => e.type === "turn_completed" && e.kind === "warm")!;
  expect(warm.usage?.inputTokens).toBe(10); expect(warm.usage?.cacheReadInputTokens).toBe(100);
  expect(warm.usage?.estimatedCostUsd).toBeCloseTo(0.002); expect(warm.text).toBeUndefined();
  h.session.stop(); await h.done;
});
it("does not inject probes when disabled, busy, or stopped", async () => {
  const h = harness(false, false); await h.next();
  h.setNow(300000); h.session.tick(); expect(h.session.idle.calls).toBe(0);
  h.messages.push(result(0.01)); await settled(h, 1); h.session.tick(); expect(h.session.idle.calls).toBe(0);
  h.session.stop(); h.session.tick(); expect(h.session.send("more")).toBe(false); await h.done;
});
it("resumed history establishes a baseline without double counting", async () => {
  const h = harness(true); await h.next(); expect((await h.options()).resume).toBe(id);
  h.messages.push(result(2, 10000, 100000)); await settled(h, 1);
  expect(h.events.find(e => e.type === "turn_completed")?.usage).toBeUndefined();
  h.setNow(240001); h.session.tick(); await h.next();
  h.messages.push(result(2.01, 10010, 101000, 11)); await settled(h, 2);
  expect(h.events.filter(e => e.type === "turn_completed")[1]?.usage?.cacheReadInputTokens).toBe(1000);
  h.session.stop(); await h.done;
});
it("stops on identity mismatch, failed turn or timeout without retry", async () => {
  for (const mode of ["identity", "failure", "timeout"]) {
    const h = harness(); await h.next();
    if (mode === "identity") h.messages.push({ ...result(0.01), session_id: "other" });
    if (mode === "failure") h.messages.push({ ...result(0.01), subtype: "error_max_turns", is_error: true });
    if (mode === "timeout") { h.setNow(900001); h.session.tick(); }
    await h.done; expect(h.messages.ended).toBe(true); expect(h.session.idle.warmEnabled).toBe(false);
    expect(h.events.at(-1)?.type).toBe("stopped");
  }
});
it("does not hide missing usage or counter regression", async () => {
  for (const next of [{ ...result(0.02), modelUsage: {} }, result(0.001, 1, 0, 0)]) {
    const h = harness(); await h.next(); h.messages.push(result(0.01)); await settled(h, 1);
    expect(h.session.send("Next task")).toBe(true); await h.next(); h.messages.push(next); await settled(h, 2);
    expect(h.session.idle.warmEnabled).toBe(false);
    expect(h.events.filter(e => e.type === "turn_completed")[1]?.usage).toBeUndefined();
    h.session.stop(); await h.done;
  }
});
it("fails closed if metadata cannot be persisted before launching", async () => {
  const h = harness(false, true, async () => { throw new Error("disk unavailable"); });
  await expect(h.done).rejects.toThrow("persist"); expect(h.session.idle.warmEnabled).toBe(false);
});
it("denies background commands and does not bypass normal permission approval", async () => {
  const h = harness(); await h.next(); const o = await h.options();
  const hook = o.hooks!.PreToolUse![0]!.hooks[0]!;
  expect(await hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "sleep 10", run_in_background: true }, tool_use_id: "x", session_id: id, cwd: tmpdir(), transcript_path: "unused" }, "x", { signal: new AbortController().signal })).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  h.session.stop(); await h.done;
});
