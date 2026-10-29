import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPanel } from "../src/server.js";
import type { PanelHandle } from "../src/server.js";
import type { LaunchState, PanelSnapshot } from "../src/protocol.js";
import type { PanelExecution } from "../src/launch.js";
const exec = promisify(execFile);
const spec = () => ({ spec_version: 1, meta: { goal: "Build test feature" }, priorities: { budget_target: 10000, bias: "fast" }, work_units: [{ id: "wu-a", type: "code", description: "Write feature", owns: ["a.txt"], depends_on: [], acceptance: ["file exists"], budget_est: 100 }], agents: [{ id: "builder", purpose: "Build", model_tier: "standard" }], assignment: { "wu-a": "builder" }, verification: { global_gates: ["Combined feature works"] } });
let project: string, panel: PanelHandle;
let execution: PanelExecution;
async function post(action: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${panel.url}/api/launch/${action}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function prepare() {
  const draft = await (await post("draft", { spec: spec() })).json() as LaunchState;
  return (await (await post("approve", { revision: draft.draft!.revision })).json()) as LaunchState;
}
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "cw-launch-"));
  await exec("git", ["-C", project, "init", "-b", "main"]);
  await writeFile(join(project, "baseline.txt"), "base");
  await exec("git", ["-C", project, "add", "."]);
  await exec("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"]);
  execution = { run: vi.fn(async () => ({ status: "completed" as const, accepted: ["wu-a"], failures: {} })), inspect: vi.fn(async () => ({ recoveryToken: "review-token", canResume: true, reasons: [] })), resume: vi.fn(async () => ({ status: "completed" as const, accepted: [], failures: {} })) };
  panel = await startPanel({ projectDir: project, execution });
});
afterEach(async () => { await panel.close(); await rm(project, { recursive: true, force: true }); });

describe("mission control HTTP", () => {
  it("drafts and approves without executing, projects approval into snapshot, then starts once", async () => {
    const approved = await prepare();
    expect(execution.run).not.toHaveBeenCalled();
    const snapshot = await (await fetch(`${panel.url}/api/snapshot`)).json() as PanelSnapshot;
    expect(snapshot.launch!.approvalToken).toBe(approved.approvalToken);
    const started = await post("start", { approvalToken: approved.approvalToken, concurrency: 2 });
    expect(started.status).toBe(200);
    expect(execution.run).toHaveBeenCalledTimes(1);
    expect((await post("start", { approvalToken: approved.approvalToken })).status).toBe(409);
    const ledger = await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8");
    expect(ledger).toContain('"type":"spec.approved"');
  });
  it("invalidates approval on editing and rejects stale or duplicate reviews", async () => {
    const approved = await prepare();
    expect((await post("approve", { revision: approved.draft!.revision })).status).toBe(409);
    expect((await post("approve", { revision: "stale" })).status).toBe(409);
    const changed = spec(); changed.meta.goal = "New goal";
    expect((await post("draft", { spec: changed })).status).toBe(200);
    expect((await post("start", { approvalToken: approved.approvalToken })).status).toBe(409);
    expect(execution.run).not.toHaveBeenCalled();
  });
  it("rejects invalid plans, missing global gates, unsafe concurrency and dirty sources", async () => {
    const invalid = spec(); invalid.verification.global_gates = [];
    expect((await post("draft", { spec: invalid })).status).toBe(409);
    const approved = await prepare();
    expect((await post("start", { approvalToken: approved.approvalToken, concurrency: 9 })).status).toBe(409);
    await writeFile(join(project, "baseline.txt"), "user edit");
    expect((await post("start", { approvalToken: approved.approvalToken })).status).toBe(409);
    expect(await readFile(join(project, "baseline.txt"), "utf8")).toBe("user edit");
    expect(execution.run).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, no-origin cross-site, and non-JSON writes", async () => {
    expect((await post("draft", { spec: spec() }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("draft", { spec: spec() }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post("draft", { spec: spec() }, { "content-type": "text/plain" })).status).toBe(403);
    expect(execution.run).not.toHaveBeenCalled();
  });
  it("disables injected execution in demo mode", async () => {
    await panel.close(); panel = await startPanel({ projectDir: project, execution, demo: true });
    expect(((await (await fetch(`${panel.url}/api/launch`)).json()) as LaunchState).enabled).toBe(false);
    expect((await post("draft", { spec: spec() })).status).toBe(409);
    expect(execution.run).not.toHaveBeenCalled();
  });
  it("requires inspected reviewed token to resume and delegates stale validation", async () => {
    expect((await post("recovery/resume", { recoveryToken: "review-token" })).status).toBe(409);
    expect((await post("recovery/inspect", {})).status).toBe(200);
    expect((await post("recovery/resume", { recoveryToken: "old" })).status).toBe(409);
    expect((await post("recovery/resume", { recoveryToken: "review-token", concurrency: 1 })).status).toBe(200);
    expect(execution.resume).toHaveBeenCalledWith(expect.objectContaining({ project, recoveryToken: "review-token", concurrency: 1 }));
  });
  it("rejects changed committed HEAD after review without creating a run", async () => {
    const approved = await prepare();
    await writeFile(join(project, "baseline.txt"), "new baseline");
    await exec("git", ["-C", project, "add", "baseline.txt"]);
    await exec("git", ["-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "changed"]);
    expect((await post("start", { approvalToken: approved.approvalToken })).status).toBe(409);
    expect(execution.run).not.toHaveBeenCalled();
    await expect(readFile(join(project, ".teamsmith/ledger.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("honors a newer draft written through a second panel instance", async () => {
    const approved = await prepare();
    const other = await startPanel({ projectDir: project, execution });
    try {
      const edited = spec(); edited.meta.goal = "Other reviewed plan";
      const response = await fetch(`${other.url}/api/launch/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: edited }) });
      expect(response.status).toBe(200);
      expect((await post("start", { approvalToken: approved.approvalToken })).status).toBe(409);
      expect(execution.run).not.toHaveBeenCalled();
    } finally { await other.close(); }
  });
  it("keeps existing ledger and spec untouched when launch is incompatible", async () => {
    const approved = await prepare();
    const existing = '{"seq":1,"ts":"2026-10-29T00:00:00.000Z","type":"run.started","actor":"orchestrator","data":{"run_id":"existing"}}\n';
    await writeFile(join(project, ".teamsmith/ledger.jsonl"), existing);
    expect((await post("start", { approvalToken: approved.approvalToken })).status).toBe(409);
    expect(await readFile(join(project, ".teamsmith/ledger.jsonl"), "utf8")).toBe(existing);
    expect(execution.run).not.toHaveBeenCalled();
  });
  it("restores final gate evidence and recovery workspace review after restart", async () => {
    const report = { outcome: "accepted" as const, summary: "Combined result checked", findings: [], evidence: [{ criterion: "Combined feature works", command: "inspect combined files", result: "all present", passed: true }] };
    const integrationVerification = { status: "passed" as const, report, reason: "All gates passed" };
    execution.run = vi.fn(async () => ({ status: "completed" as const, accepted: ["wu-a"], failures: {}, integrationVerification }));
    const approved = await prepare(); await post("start", { approvalToken: approved.approvalToken });
    await panel.close(); panel = await startPanel({ projectDir: project, execution });
    const restored = await (await fetch(`${panel.url}/api/launch`)).json() as LaunchState;
    expect(restored.result?.integrationVerification).toEqual(integrationVerification);
    execution.inspect = vi.fn(async () => ({ recoveryToken: "review-token", canResume: true, reasons: [], receipt: { id: "team-id", accepted: ["wu-a"], workspaces: { "wu-a": "preserved-worker" }, integrationWorkspace: "preserved-integration", integrationVerification } }));
    await post("recovery/inspect", {});
    await panel.close(); panel = await startPanel({ projectDir: project, execution });
    const recovery = (await (await fetch(`${panel.url}/api/launch`)).json() as LaunchState).recovery;
    expect(recovery?.workspaces).toEqual({ "wu-a": "preserved-worker" });
    expect(recovery?.integrationVerification).toEqual(integrationVerification);
    expect(recovery?.teamId).toBe("team-id");
  });
  it("makes interrupted-running recovery reachable while preserving the durable launch guard", async () => {
    await prepare(); await panel.close();
    const path = join(project, ".teamsmith/launch.json");
    const saved = JSON.parse(await readFile(path, "utf8")); saved.status = "running";
    await writeFile(path, JSON.stringify(saved));
    execution.inspect = vi.fn(async () => ({ recoveryToken: "live-review", canResume: false, reasons: ["Execution lease is active or sessions are unreconciled"] }));
    panel = await startPanel({ projectDir: project, execution });
    const restored = await (await fetch(`${panel.url}/api/launch`)).json() as LaunchState;
    expect(restored.status).toBe("error");
    expect(restored.error).toContain("inspect recovery");
    expect(restored.approvalToken).toBeUndefined();
    expect((await post("draft", { spec: spec() })).status).toBe(409);
    expect((await post("start", { approvalToken: saved.approvalToken })).status).toBe(409);
    expect((await post("recovery/inspect", {})).status).toBe(200);
    expect((await post("recovery/resume", { recoveryToken: "live-review" })).status).toBe(409);
    await panel.close(); panel = await startPanel({ projectDir: project, execution });
    expect((await post("draft", { spec: spec() })).status).toBe(409);
    expect(execution.run).not.toHaveBeenCalled();
    expect(execution.resume).not.toHaveBeenCalled();
  });
  it("aborts and settles active execution before closing", async () => {
    let settled = false;
    execution.run = vi.fn(({ signal }) => new Promise<NonNullable<LaunchState["result"]>>(resolve => signal.addEventListener("abort", () => { settled = true; resolve({ status: "stopped", accepted: [], failures: {} }); }, { once: true })));
    const approved = await prepare();
    await post("start", { approvalToken: approved.approvalToken });
    await panel.close(); expect(settled).toBe(true);
  });
});
