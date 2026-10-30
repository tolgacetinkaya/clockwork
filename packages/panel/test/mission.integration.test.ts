import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readLedger, reduceLedger } from "@clockwork/core";
import type { ExecutionAdapter, ExecutionEvent } from "@clockwork/core";
import { runTeam, resumeTeam, inspectTeamRecovery } from "../../runner/src/index.js";
import { git } from "../../runner/src/workspace.js";
import { startPanel } from "../src/server.js";
import type { LaunchState, PanelSnapshot } from "../src/protocol.js";
import { planSpec } from "../client/mission-plan.js";

it("runs the actual form plan through HTTP, real isolated workers, a failed combined gate and reviewed recovery over SSE", async () => {
  const root = await mkdtemp(join(tmpdir(), "cw-mission-e2e-"));
  const project = join(root, "project");
  await mkdir(project);
  await git(project, "init", "-b", "main");
  await writeFile(join(project, "README.md"), "original\n");
  await git(project, "add", ".");
  await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
  const original = await git(project, "rev-parse", "HEAD");
  let producers = 0, gates = 0;
  let release!: () => void;
  const bothProducers = new Promise<void>(resolve => { release = resolve; });
  const adapter: ExecutionAdapter = { id: "controlled-test", async *execute(request): AsyncGenerator<ExecutionEvent> {
    const final = request.prompt.includes("# Final integration verification");
    if (final) {
      gates++;
      expect(request.mode).toBe("verify");
      expect(await readFile(join(request.workspace, "a.txt"), "utf8")).toBe("a");
      expect(await readFile(join(request.workspace, "b.txt"), "utf8")).toBe("b");
      yield { type: "command", id: "read-combined-files", command: "read a.txt and b.txt", exitCode: 0, status: "completed" };
    } else if (request.mode === "produce") {
      if (++producers === 2) release();
      await bothProducers;
      const id = request.prompt.match(/# Work unit: ([ab])/)![1]!;
      await writeFile(join(request.workspace, `${id}.txt`), id);
    } else {
      const id = request.prompt.match(/# Verification of work unit: ([ab])/)![1]!;
      expect(await readFile(join(request.workspace, `${id}.txt`), "utf8")).toBe(id);
      yield { type: "command", id: "read-unit-file", command: `read ${id}.txt`, exitCode: 0, status: "completed" };
    }
    const unit = final ? undefined : request.prompt.match(/# (?:Work unit|Verification of work unit): ([ab])/)![1]!;
    yield { type: "usage", input: 10, cached: 0, output: 2 };
    yield { type: "report", report: { outcome: final && gates === 1 ? "rework" : request.mode === "produce" ? "completed" : "accepted", summary: "Controlled verification", findings: final && gates === 1 ? ["Review required"] : [], evidence: [{ criterion: final ? "Both files compose correctly" : "File exists", command: final ? "read a.txt and b.txt" : `read ${unit}.txt`, result: "checked exact contents", passed: true }] } };
  } };
  const panel = await startPanel({ projectDir: project, execution: {
    run: options => runTeam({ ...options, adapter }),
    resume: options => resumeTeam({ ...options, adapter }),
    inspect: inspectTeamRecovery,
  } });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 35000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`${panel.url}/api/stream`, { signal: abort.signal });
    reader = response.body!.getReader();
    let buffer = "";
    const decoder = new TextDecoder();
    const next = async (status: string): Promise<PanelSnapshot> => {
      for (;;) {
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!frame.includes("event: snapshot")) continue;
          const data = frame.split("\n").find(line => line.startsWith("data: "))!.slice(6);
          const snapshot = JSON.parse(data) as PanelSnapshot;
          if (snapshot.launch?.status === status) return snapshot;
        }
        const chunk = await reader!.read();
        if (chunk.done) throw new Error("SSE ended before expected mission state");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };
    const post = async (action: string, body: unknown) => {
      const res = await fetch(`${panel.url}/api/launch/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await res.json();
      expect(res.status, JSON.stringify(payload)).toBe(200);
      return payload as LaunchState;
    };
    const spec = planSpec("Two parts, one validated result", ["a", "b"].map(id => ({ id, description: `Write ${id}.txt`, owns: `${id}.txt`, acceptance: "File exists", dependencies: "", estimate: 100 })), 10000, "Both files compose correctly");
    const draft = await post("draft", { spec });
    const approved = await post("approve", { revision: draft.draft!.revision });
    expect(producers).toBe(0);
    await post("start", { approvalToken: approved.approvalToken, concurrency: 2 });
    const stopped = await next("stopped");
    expect(stopped.launch!.result!.integrationVerification!.status).toBe("failed");
    expect(stopped.state.openCheckpoints.some(c => c.blocking)).toBe(true);
    const inspection = await post("recovery/inspect", {});
    expect(inspection.recovery!.canResume, inspection.recovery!.reasons.join("; ")).toBe(true);
    await post("recovery/resume", { recoveryToken: inspection.recovery!.recoveryToken, concurrency: 2 });
    const completed = await next("completed");
    expect(completed.launch!.result!.integrationVerification!.status).toBe("passed");
    expect(producers).toBe(2);
    expect(gates).toBe(2);
    expect(completed.state.openCheckpoints).toEqual([]);
    expect(await git(project, "rev-parse", "HEAD")).toBe(original);
    expect(await readFile(join(project, "README.md"), "utf8")).toBe("original\n");
    expect(reduceLedger((await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events).anomalies).toEqual([]);
  } finally {
    clearTimeout(timer); abort.abort(); await reader?.cancel().catch(() => {});
    await panel.close();
    await rm(root, { recursive: true, force: true });
  }
}, 45000);
