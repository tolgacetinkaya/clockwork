import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runTeam: vi.fn(), runUnit: vi.fn() }));
vi.mock("@clockwork/runner", () => mocks);
import { runCli } from "../src/main.js";

afterEach(() => vi.clearAllMocks());

describe("codex team CLI", () => {
  it.each(["0", "9", "1.5", "NaN", "true"])("rejects invalid concurrency %s before execution", async (value) => {
    const result = await runCli(["codex", "team", "--concurrency", value], process.cwd());
    expect(result.code).toBe(1);
    expect(result.out).toContain("concurrency");
    expect(mocks.runTeam).not.toHaveBeenCalled();
  });

  it("uses default concurrency and cleans signal handlers", async () => {
    mocks.runTeam.mockResolvedValue({ status: "completed", accepted: ["a"], failures: {} });
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const result = await runCli(["codex", "team", "--model", "confirmed-model"], process.cwd());
    expect(result.code).toBe(0);
    expect(mocks.runTeam).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 2, model: "confirmed-model", signal: expect.any(AbortSignal) }));
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
    expect(mocks.runUnit).not.toHaveBeenCalled();
  });

  it("accepts the maximum and reports stopped execution as failure", async () => {
    mocks.runTeam.mockResolvedValue({ status: "stopped", accepted: [], failures: { a: "interrupted" } });
    const result = await runCli(["codex", "team", "--concurrency", "8"], process.cwd());
    expect(result.code).toBe(1);
    expect(mocks.runTeam).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 8 }));
    expect(JSON.parse(result.out).failures.a).toBe("interrupted");
  });

  it("cleans signal handlers on runner failure", async () => {
    mocks.runTeam.mockRejectedValue(new Error("blocked"));
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    expect((await runCli(["codex", "team"], process.cwd())).code).toBe(1);
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  });

  it.each([["--timeout-ms", "0"], ["--windows-sandbox", "invalid"], ["--workspace", "worker"]])("validates team options %s", async (...options) => {
    expect((await runCli(["codex", "team", ...options], process.cwd())).code).toBe(1);
    expect(mocks.runTeam).not.toHaveBeenCalled();
  });
});
