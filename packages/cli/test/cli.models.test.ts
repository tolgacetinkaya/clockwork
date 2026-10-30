import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runTeam: vi.fn(), runUnit: vi.fn(), resumeTeam: vi.fn(), inspectTeamRecovery: vi.fn(), startPanel: vi.fn() }));
vi.mock("@clockwork/runner", () => ({ runTeam: mocks.runTeam, runUnit: mocks.runUnit, resumeTeam: mocks.resumeTeam, inspectTeamRecovery: mocks.inspectTeamRecovery }));
vi.mock("@clockwork/panel", () => ({ startPanel: mocks.startPanel }));
import { runCli } from "../src/main.js";

afterEach(() => vi.clearAllMocks());
const flags = ["--model", "fallback-v1", "--producer-model", "builder-v1", "--verifier-model", "review-v2", "--integration-verifier-model", "final-v3"];
const selected = { model: "fallback-v1", producerModel: "builder-v1", verifierModel: "review-v2", integrationVerifierModel: "final-v3" };

describe("role model CLI defaults", () => {
  it("passes separate models through team execution", async () => {
    mocks.runTeam.mockResolvedValue({ status: "completed", accepted: [], failures: {} });
    expect((await runCli(["codex", "team", ...flags], process.cwd())).code).toBe(0);
    expect(mocks.runTeam).toHaveBeenCalledWith(expect.objectContaining(selected));
  });
  it.each(["produce", "verify"])("passes separate models through single-unit %s", async mode => {
    mocks.runUnit.mockResolvedValue({ outcome: mode === "produce" ? "completed" : "accepted" });
    expect((await runCli(["codex", mode, "wu-a", "--workspace", "worker", ...flags], process.cwd())).code).toBe(0);
    expect(mocks.runUnit).toHaveBeenCalledWith(expect.objectContaining({ ...selected, mode }));
  });
  it("wires the same defaults into panel start, inspection and resume", async () => {
    mocks.startPanel.mockResolvedValue({ url: "http://127.0.0.1:47833", close: vi.fn().mockResolvedValue(undefined) });
    const beforeInt = process.listeners("SIGINT"), beforeTerm = process.listeners("SIGTERM");
    try {
      expect((await runCli(["ui", "--enable-execution", ...flags], process.cwd())).code).toBe(0);
      const execution = mocks.startPanel.mock.calls[0]![0].execution;
      const options = { project: "test-project", concurrency: 2, signal: new AbortController().signal };
      await execution.run(options);
      await execution.inspect(options.project);
      await execution.resume({ ...options, recoveryToken: "reviewed-token" });
      expect(mocks.runTeam).toHaveBeenCalledWith(expect.objectContaining({ ...selected, ...options }));
      expect(mocks.inspectTeamRecovery).toHaveBeenCalledWith(options.project, selected);
      expect(mocks.resumeTeam).toHaveBeenCalledWith(expect.objectContaining({ ...selected, ...options, recoveryToken: "reviewed-token" }));
    } finally {
      for (const listener of process.listeners("SIGINT")) if (!beforeInt.includes(listener)) process.removeListener("SIGINT", listener);
      for (const listener of process.listeners("SIGTERM")) if (!beforeTerm.includes(listener)) process.removeListener("SIGTERM", listener);
    }
  });
  it.each(["model", "producer-model", "verifier-model", "integration-verifier-model"])("rejects invalid --%s before starting workers or panel", async name => {
    for (const value of ["", " ", "model\n", "--danger", "x".repeat(201), "true"]) {
      for (const command of [["codex", "team"], ["ui", "--enable-execution"]]) {
        const result = await runCli([...command, "--" + name + "=" + value], process.cwd());
        expect(result.code).toBe(1);
        expect(result.out).toContain(name);
      }
    }
    expect(mocks.runTeam).not.toHaveBeenCalled();
    expect(mocks.startPanel).not.toHaveBeenCalled();
  });
  it("rejects a model flag without a value", async () => {
    expect((await runCli(["codex", "team", "--verifier-model"], process.cwd())).code).toBe(1);
    expect(mocks.runTeam).not.toHaveBeenCalled();
  });
});
