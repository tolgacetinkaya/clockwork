import { describe, expect, it, vi } from "vitest";
import { ApiAdapter, ModelRouter, validateApiConfig, modelRoute } from "../src/index.js";
import { parseUsage } from "../src/http.js";
import { sandboxArgs } from "../src/sandbox.js";
import type { ExecutionEvent, ExecutionRequest } from "@clockwork/core";
import { resolve } from "node:path";

const config = validateApiConfig({ sandboxImage: "node:24-bookworm-slim", providers: { deepseek: {}, kimi: {}, zai: {}, qwen: { baseUrl: "https://example.invalid/v1" }, local: { baseUrl: "http://127.0.0.1:9999/v1", apiKeyEnv: "LOCAL_KEY" } } });
const report = { outcome: "accepted", summary: "Checked", evidence: [{ criterion: "test passes", command: "node test.cjs", result: "exit 0", passed: true }], findings: [] };
const req: ExecutionRequest = { workspace: resolve("fixture"), mode: "verify", model: "any-model", prompt: "test passes", signal: new AbortController().signal };
function response(message: unknown, finish_reason = "stop", usage: unknown = { prompt_tokens: 100, completion_tokens: 8, prompt_cache_hit_tokens: 20 }): Response {
  return new Response(JSON.stringify({ choices: [{ message, finish_reason }], usage }), { status: 200 });
}
function tool(id = "call-1", command = "node test.cjs") {
  return { id, type: "function", function: { name: "execute_command", arguments: JSON.stringify({ command }) } };
}
async function collect(source: AsyncIterable<ExecutionEvent>, events: ExecutionEvent[] = []) {
  for await (const event of source) events.push(event);
  return events;
}
function setup(responses: Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fixture-secret");
    bodies.push(JSON.parse(String(init?.body)));
    return responses.shift()!;
  });
  const sandbox = { check: vi.fn(async () => {}), run: vi.fn(async () => ({ exitCode: 0, output: "passed" })) };
  const adapter = new ApiAdapter("deepseek", { config, transport, sandbox, env: { DEEPSEEK_API_KEY: "fixture-secret" } });
  return { adapter, sandbox, transport, bodies };
}
describe("API model routing and host policy", () => {
  it("accepts arbitrary old, small and self-hosted model IDs without a flagship whitelist", () => {
    for (const model of ["qwen::Qwen/Qwen2.5-0.5B-Instruct", "zai::glm-4-flash", "kimi::moonshot-v1-8k", "local::custom:latest"]) {
      expect(modelRoute(model).provider).toBe(model.split("::")[0]);
    }
    expect(modelRoute("gpt-model")).toEqual({ provider: "codex", model: "gpt-model" });
    expect(modelRoute("codex::custom-model")).toEqual({ provider: "codex", model: "custom-model" });
  });
  it("routes old unqualified selections to the existing adapter and rejects unconfigured providers", async () => {
    const execute = vi.fn(async function* (request: ExecutionRequest) { yield { type: "report", report: { ...report, summary: request.model! } } as ExecutionEvent; });
    const codex = { id: "codex", execute, plan: vi.fn() };
    const router = new ModelRouter(codex, config);
    await collect(router.execute({ ...req, model: "old-model" }));
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ model: "old-model" }));
    expect(router.providerForModel("kimi::any-model")).toBe("kimi");
    expect(() => router.execute({ ...req, model: "unknown::model" })).toThrow("not enabled");
  });
  it("requires regional Qwen configuration and rejects transport/credential overrides", () => {
    expect(() => validateApiConfig({ sandboxImage: "node:24", providers: { qwen: {} } })).toThrow("baseUrl");
    for (const baseUrl of ["http://external.invalid/v1", "https://user:secret@example.invalid/v1", "https://example.invalid/v1?key=secret"]) {
      expect(() => validateApiConfig({ sandboxImage: "node:24", providers: { kimi: { baseUrl } } })).toThrow();
    }
    expect(() => validateApiConfig({ sandboxImage: "node:24", providers: { kimi: { options: { tools: [] } } } })).toThrow("Unknown");
  });
  it("denies an unapproved destination before planning or executing", async () => {
    const { adapter, sandbox, transport } = setup([]);
    const request = { ...req, projectEgress: { policy: { allowCodex: false, apiEndpoints: { deepseek: "https://other.invalid" } }, assertCurrent: async () => {} } };
    await expect(adapter.plan(request)[Symbol.asyncIterator]().next()).rejects.toThrow("does not allow");
    await expect(adapter.execute(request)[Symbol.asyncIterator]().next()).rejects.toThrow("does not allow");
    expect(transport).not.toHaveBeenCalled();
    expect(sandbox.check).not.toHaveBeenCalled();
  });
  it("stops an allowed route before tool output is sent after profile revocation", async () => {
    const { adapter, sandbox, transport } = setup([response({ role: "assistant", tool_calls: [tool()] }, "tool_calls")]);
    let allowed = true;
    sandbox.run.mockImplementation(async () => { allowed = false; return { exitCode: 0, output: "project data" }; });
    const request = { ...req, projectEgress: {
      policy: { allowCodex: false, apiEndpoints: { deepseek: config.providers.deepseek!.baseUrl } },
      async assertCurrent() { if (!allowed) throw new Error("Profile changed"); },
    } };
    await expect(collect(adapter.execute(request))).rejects.toThrow("Profile changed");
    expect(sandbox.run).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledOnce();
  });
  it("does not transmit a request or start a sandbox when the API key is missing", async () => {
    const transport = vi.fn(), sandbox = { check: vi.fn(), run: vi.fn() };
    await expect(collect(new ApiAdapter("kimi", { config, env: {}, transport, sandbox }).execute(req))).rejects.toThrow("MOONSHOT_API_KEY");
    expect(transport).not.toHaveBeenCalled(); expect(sandbox.check).not.toHaveBeenCalled();
  });
});
describe("bounded API tool loop", () => {
  it("preserves provider reasoning, obtains real command receipts and aggregates cache usage once", async () => {
    const { adapter, sandbox, bodies } = setup([
      response({ role: "assistant", content: null, reasoning_content: "provider continuation", tool_calls: [tool()] }, "tool_calls"),
      response({ role: "assistant", content: JSON.stringify(report) }),
    ]);
    const events = await collect(adapter.execute({ ...req, projectEgress: {
      policy: { allowCodex: false, apiEndpoints: { deepseek: config.providers.deepseek!.baseUrl } },
      assertCurrent: async () => {},
    } }));
    expect(sandbox.run).toHaveBeenCalledWith(req.workspace, true, "node test.cjs", req.signal);
    expect(events).toContainEqual({ type: "command", id: "call-1", command: "node test.cjs", exitCode: 0, status: "completed" });
    expect(events.filter(e => e.type === "usage")).toEqual([{ type: "usage", input: 200, cached: 40, output: 16 }]);
    expect(JSON.stringify(events)).not.toContain("provider continuation");
    expect(bodies[1]!.messages).toContainEqual(expect.objectContaining({ reasoning_content: "provider continuation" }));
    expect(events).toContainEqual({ type: "report", report });
  });
  it("denies unsupported tools before any command in a batch runs", async () => {
    const { adapter, sandbox } = setup([response({ role: "assistant", tool_calls: [tool(), { ...tool("call-2"), function: { name: "host_shell", arguments: "{}" } }] }, "tool_calls")]);
    await expect(collect(adapter.execute(req))).rejects.toThrow("unsupported");
    expect(sandbox.run).not.toHaveBeenCalled();
  });
  it("never reruns a replayed tool-call ID", async () => {
    const { adapter, sandbox } = setup([0, 1].map(() => response({ role: "assistant", tool_calls: [tool()] }, "tool_calls")));
    await expect(collect(adapter.execute(req))).rejects.toThrow("repeated");
    expect(sandbox.run).toHaveBeenCalledTimes(1);
  });
  it("leaves incomplete multi-round usage unknown", async () => {
    const { adapter } = setup([
      response({ role: "assistant", tool_calls: [tool()] }, "tool_calls"),
      response({ role: "assistant", content: JSON.stringify(report) }, "stop", null),
    ]);
    const events: ExecutionEvent[] = [];
    await expect(collect(adapter.execute(req), events)).rejects.toThrow("omitted usage");
    expect(events.some(e => e.type === "usage")).toBe(false);
    expect(events.some(e => e.type === "report")).toBe(false);
  });
  it("does not retry HTTP errors or expose their bodies", async () => {
    const { adapter, transport } = setup([new Response("fixture-secret", { status: 429 })]);
    await expect(collect(adapter.execute(req))).rejects.toThrow("HTTP 429");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated reports", async () => {
    const { adapter } = setup([response({ role: "assistant", content: JSON.stringify(report) }, "length")]);
    await expect(collect(adapter.execute(req))).rejects.toThrow("complete report");
  });
  it("stops further tool calls when cancelled", async () => {
    const controller = new AbortController();
    const { adapter, sandbox } = setup([response({ role: "assistant", tool_calls: [tool(), tool("call-2")] }, "tool_calls")]);
    sandbox.run.mockImplementation(async () => { controller.abort(); return { exitCode: 0, output: "" }; });
    await expect(collect(adapter.execute({ ...req, signal: controller.signal }))).rejects.toThrow();
    expect(sandbox.run).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid and impossible token counters", () => {
    expect(() => parseUsage({ prompt_tokens: 1, completion_tokens: 2, prompt_cache_hit_tokens: 3 })).toThrow();
    expect(parseUsage({ prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 90 } })).toEqual({ input: 100, output: 1, cached: 90 });
  });
  it("never gives verification containers writable source or credentials", () => {
    const args = sandboxArgs("node:24", "test", req.workspace, true);
    expect(args).toContain("none");
    expect(args).toContain("no-new-privileges");
    expect(args.find(s => s.startsWith("type=bind"))).toMatch(/,readonly$/);
    expect(args).not.toContain("--env");
    expect(args).toContain("never");
  });
});

it("records known usage even when the final report fails validation", async () => {
  const { adapter } = setup([response({ role: "assistant", content: "not a report" })]);
  const events: ExecutionEvent[] = [];
  await expect(collect(adapter.execute(req), events)).rejects.toThrow("report JSON");
  expect(events.filter(e => e.type === "usage")).toEqual([{ type: "usage", input: 100, cached: 20, output: 8 }]);
});
it("rejects relative Docker binaries from host configuration", () => {
  expect(() => validateApiConfig({ sandboxImage: "node:24", dockerExecutable: "./docker", providers: { kimi: {} } })).toThrow("absolute");
});
