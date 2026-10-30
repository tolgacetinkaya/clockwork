import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generateGoalPlan: vi.fn(), runTeam: vi.fn(), runUnit: vi.fn(), resumeTeam: vi.fn(), inspectTeamRecovery: vi.fn(), startPanel: vi.fn() }));
vi.mock("@clockwork/runner", () => ({ generateGoalPlan: mocks.generateGoalPlan, runTeam: mocks.runTeam, runUnit: mocks.runUnit, resumeTeam: mocks.resumeTeam, inspectTeamRecovery: mocks.inspectTeamRecovery }));
vi.mock("@clockwork/panel", () => ({ startPanel: mocks.startPanel }));
import { runCli } from "../src/main.js";
afterEach(() => vi.clearAllMocks());
const result = { summary: "Investigate latency", spec: {}, usage: { input: 10, cached: 2, output: 5 }, provider: "codex", head: "a".repeat(40) };
const flags = ["--goal", "Investigate API latency", "--budget", "100k", "--constraints", "Keep the API contract", "--planner-model", "planner", "--producer-model", "builder", "--verifier-model", "reviewer"];
describe("goal planning CLI", () => {
  it("prepares a proposal with independent planner and role identities without running a team", async () => {
    mocks.generateGoalPlan.mockResolvedValue(result);
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const response = await runCli(["plan", ...flags], process.cwd());
    expect(response.code).toBe(0); expect(JSON.parse(response.out)).toEqual(result);
    expect(mocks.generateGoalPlan).toHaveBeenCalledWith(expect.objectContaining({ model: "planner", input: { goal: "Investigate API latency", constraints: "Keep the API contract", budget: 100000, execution: { producer_model: "builder", verifier_model: "reviewer", integration_verifier_model: "reviewer" } } }));
    expect(mocks.runTeam).not.toHaveBeenCalled(); expect(mocks.runUnit).not.toHaveBeenCalled();
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });
  it("uses the shared model fallback and exposes it in the unapproved proposal request", async () => {
    mocks.generateGoalPlan.mockResolvedValue(result);
    expect((await runCli(["plan", "--goal", "Audit docs", "--budget", "10000", "--model", "shared"], process.cwd())).code).toBe(0);
    expect(mocks.generateGoalPlan).toHaveBeenCalledWith(expect.objectContaining({ model: "shared", input: expect.objectContaining({ execution: { producer_model: "shared", verifier_model: "shared", integration_verifier_model: "shared" } }) }));
  });
  it("cleans signal handlers when planning fails", async () => {
    mocks.generateGoalPlan.mockRejectedValue(new Error("Planning failed"));
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    expect((await runCli(["plan", ...flags], process.cwd())).code).toBe(1);
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
    expect(mocks.runTeam).not.toHaveBeenCalled();
  });
  it.each([
    ["--goal", "Target"], ["--budget", "10000"], ["--goal", " ", "--budget", "10000"],
    ["--goal", "Target", "--budget", "0"], ["--goal", "Target", "--budget", "10000", "--planner-model"],
    ["--goal", "Target", "--budget", "10000", "--planner-model=--unsafe"],
    ["--goal", "Target", "--budget", "10000", "--timeout-ms", "0"],
    ["--goal", "Target", "--budget", "10000", "--windows-sandbox", "other"],
  ])("rejects invalid planning arguments before spawning: %j", async (...args) => {
    expect((await runCli(["plan", ...args], process.cwd())).code).toBe(1);
    expect(mocks.generateGoalPlan).not.toHaveBeenCalled();
  });
  it("wires panel planning with visible host defaults while respecting explicit form choices", async () => {
    mocks.startPanel.mockResolvedValue({ url: "http://127.0.0.1:47833", close: vi.fn() });
    mocks.generateGoalPlan.mockResolvedValue(result);
    const ints = process.listeners("SIGINT"), terms = process.listeners("SIGTERM");
    try {
      expect((await runCli(["ui", "--enable-execution", "--planner-model", "planner", "--model", "host", "--verifier-model", "host-review"], process.cwd())).code).toBe(0);
      const execution = mocks.startPanel.mock.calls[0]![0].execution;
      const input = { goal: "Fix a bug", budget: 10000, execution: { producer_model: "form-builder" } };
      await execution.plan({ project: "project", input, signal: new AbortController().signal });
      expect(mocks.generateGoalPlan).toHaveBeenCalledWith(expect.objectContaining({ model: "planner", input: { goal: "Fix a bug", budget: 10000, execution: { producer_model: "form-builder", verifier_model: "host-review", integration_verifier_model: "host-review" } } }));
      expect(input.execution).toEqual({ producer_model: "form-builder" });
      expect(mocks.runTeam).not.toHaveBeenCalled();
    } finally {
      for (const listener of process.listeners("SIGINT")) if (!ints.includes(listener)) process.removeListener("SIGINT", listener);
      for (const listener of process.listeners("SIGTERM")) if (!terms.includes(listener)) process.removeListener("SIGTERM", listener);
    }
  });
});
