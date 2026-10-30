import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerWriter, readLedger, reduceLedger, writeSpecFile } from "@clockwork/core";
import type { ExecutionAdapter, ExecutionEvent, ExecutionReport, Spec } from "@clockwork/core";
import { inspectTeamRecovery, runTeam, runUnit } from "../src/index.js";
import { fingerprint, git } from "../src/workspace.js";

const exec = promisify(execFile);
const criterion = "greeting is hello";
const argv = ["tests/check.cjs"];
const command = JSON.stringify([process.execPath, ...argv]);
const completed: ExecutionReport = { outcome: "completed", summary: "Written", evidence: [], findings: [] };

describe("command-backed verification trust with real Git and Node assertions", () => {
  let temp: string, project: string, workspace: string, spec: Spec;
  let started: boolean;
  const ledger = () => readLedger(join(project, ".teamsmith/ledger.jsonl"));
  const state = async () => reduceLedger((await ledger()).events);
  const checker = "const assert = require('node:assert/strict');\nconst fs = require('node:fs');\nassert.equal(fs.readFileSync('greeting.txt', 'utf8'), 'hello');\n";

  beforeEach(async () => {
    started = false;
    temp = await mkdtemp(join(tmpdir(), "clockwork-trust-"));
    project = join(temp, "project");
    workspace = join(temp, "worker");
    await mkdir(join(project, "tests"), { recursive: true });
    await mkdir(join(project, "src"));
    await writeFile(join(project, "tests/check.cjs"), checker);
    await writeFile(join(project, "src/feature.ts"), "export const feature = 42;\n");
    await git(project, "init", "-b", "main");
    await git(project, "config", "core.autocrlf", "false");
    await git(project, "add", ".");
    await git(project, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline");
    await git(project, "worktree", "add", "--detach", workspace, "HEAD");
    await mkdir(join(project, ".teamsmith"));
    await writeFile(join(project, ".teamsmith/control.json"), '{"paused":false,"kill":false}');
    spec = {
      spec_version: 1,
      meta: { goal: "Verified greeting" },
      priorities: { budget_target: 1000, bias: "fast" },
      work_units: [{ id: "wu-greeting", type: "code", description: "Write hello", owns: ["greeting.txt", "src/**", "tests/**"], acceptance: [criterion], budget_est: 20 }],
      agents: [{ id: "builder", purpose: "Build greeting", model_tier: "standard" }],
      assignment: { "wu-greeting": "builder" },
    };
  });
  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  async function start() {
    if (started) return;
    await writeSpecFile(join(project, ".teamsmith"), spec);
    const writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
    await writer.append("run.started", { data: { run_id: "trust-fixture" } });
    await writer.append("spec.approved", { actor: "user", data: { version: 1, budget_target: 1000, units: [{ id: "wu-greeting" }] } });
    await writer.append("run.phase_entered", { data: { phase: "execute" } });
    started = true;
  }
  async function produce(change?: () => Promise<void>, greeting = "hello") {
    await start();
    const adapter: ExecutionAdapter = {
      id: "local-producer",
      async *execute(): AsyncGenerator<ExecutionEvent> {
        await writeFile(join(workspace, "greeting.txt"), greeting);
        if (change) await change();
        yield { type: "usage", input: 1, cached: 0, output: 1 };
        yield { type: "report", report: completed };
      },
    };
    return runUnit({ project, workspace, unit: "wu-greeting", mode: "produce", adapter });
  }
  function verifier(runCommand = true): ExecutionAdapter {
    return {
      id: "local-node-verifier",
      async *execute(request): AsyncGenerator<ExecutionEvent> {
        let exitCode = 0;
        if (runCommand) {
          // The receipt is emitted only after the actual assertion child has exited.
          try { await exec(process.execPath, argv, { cwd: request.workspace, windowsHide: true }); }
          catch (error) {
            const code = (error as { code?: unknown }).code;
            if (typeof code !== "number") throw new Error("Local verifier could not execute");
            exitCode = code;
          }
          yield { type: "command", id: "node-assertion", command, exitCode, status: exitCode === 0 ? "completed" : "failed" };
        }
        yield { type: "usage", input: 1, cached: 0, output: 1 };
        // Deliberately claims success even if the real command fails.
        yield { type: "report", report: {
          outcome: "accepted", summary: "Claimed verification", findings: [],
          evidence: [{ criterion, command, result: exitCode === 0 ? "Node assertion exited successfully" : "Node assertion failed", passed: true }],
        } };
      },
    };
  }
  const verify = (adapter = verifier()) => runUnit({ project, workspace, unit: "wu-greeting", mode: "verify", adapter });

  it("rejects a report-only acceptance without an observed command", async () => {
    await produce();
    const report = await verify(verifier(false));
    expect(report.outcome).toBe("rework");
    expect(report.findings).toEqual(expect.arrayContaining([expect.stringContaining("successful observed command")]));
    expect((await state()).units["wu-greeting"]?.status).toBe("rework");
    expect((await ledger()).events.some((event) => event.type === "unit.accepted")).toBe(false);
  });

  it("rejects a failed real assertion despite a passed:true report", async () => {
    await produce(undefined, "wrong");
    const report = await verify();
    expect(report.outcome).toBe("rework");
    const receiptEvent = (await ledger()).events.find((event) => event.data?.command_receipt);
    expect(receiptEvent?.data?.command_receipt).toMatchObject({ command, exit_code: 1 });
    expect((await state()).units["wu-greeting"]?.status).toBe("rework");
  });

  it("accepts a successful real command and binds its receipt to the delivery in the ledger", async () => {
    await produce();
    const delivered = await fingerprint(workspace);
    const result = await verify();
    expect(result.outcome).toBe("accepted");
    const events = (await ledger()).events;
    const receiptEvent = events.find((event) => event.data?.mode === "verify" && event.data?.command_receipt);
    expect(receiptEvent?.data?.command_receipt).toMatchObject({
      id: "node-assertion", command, exit_code: 0,
      workspace: await realpath(workspace), head: delivered.head, delivery_hash: delivered.hash,
    });
    expect(events.findIndex((event) => event === receiptEvent)).toBeLessThan(events.findIndex((event) => event.type === "unit.accepted"));
    expect((await state()).units["wu-greeting"]?.status).toBe("accepted");
    const receipt = JSON.parse(await readFile(join(project, ".teamsmith/executions/wu-greeting.json"), "utf8"));
    expect(receipt).toMatchObject({ trustVersion: 1, head: delivered.head, hash: delivered.hash, integrity: { head: delivered.head } });
  });

  it("refuses a legacy production receipt before starting the verifier", async () => {
    await produce();
    const path = join(project, ".teamsmith/executions/wu-greeting.json");
    const receipt = JSON.parse(await readFile(path, "utf8"));
    delete receipt.trustVersion;
    await writeFile(path, JSON.stringify(receipt));
    let called = false;
    await expect(verify({ id: "should-not-start", async *execute() { called = true; } })).rejects.toThrow("review it before verification");
    expect(called).toBe(false);
    expect((await state()).units["wu-greeting"]?.status).toBe("running");
  });

  it("stops at a report-only final gate after a unit passes its actual child assertion", async () => {
    spec.verification = { global_gates: [criterion] };
    await start();
    let finalChecks = 0;
    const adapter: ExecutionAdapter = {
      id: "local-team-verifier",
      async *execute(request): AsyncGenerator<ExecutionEvent> {
        if (request.mode === "produce") {
          await writeFile(join(request.workspace, "greeting.txt"), "hello");
          yield { type: "usage", input: 1, cached: 0, output: 1 };
          yield { type: "report", report: completed };
          return;
        }
        const final = request.prompt.startsWith("# Final integration verification");
        if (final) finalChecks++;
        for await (const event of verifier(!final).execute(request)) yield event;
      },
    };
    const result = await runTeam({ project, adapter, concurrency: 1 });
    expect(result.accepted).toEqual(["wu-greeting"]);
    expect(finalChecks).toBe(1);
    expect(result.status).toBe("stopped");
    expect(result.integrationVerification?.status).toBe("failed");
    expect(result.integrationVerification?.report?.outcome).toBe("rework");
    const events = (await ledger()).events;
    expect(events.some((event) => event.type === "unit.accepted")).toBe(true);
    expect(events.some((event) => event.data?.mode === "verify" && event.data?.command_receipt)).toBe(true);
    expect(events.some((event) => event.data?.mode === "integration_verify" && event.data?.command_receipt)).toBe(false);
    const path = join(project, ".teamsmith/team.json");
    const receipt = JSON.parse(await readFile(path, "utf8"));
    expect(receipt.verificationTrustVersion).toBe(1);
    delete receipt.verificationTrustVersion;
    await writeFile(path, JSON.stringify(receipt));
    const recovery = await inspectTeamRecovery(project);
    expect(recovery.canResume).toBe(false);
    expect(recovery.reasons).toEqual(expect.arrayContaining([expect.stringContaining("predates command-backed verification")]));
  }, 20000);

  it("rejects production that weakens a pre-existing test even within ownership", async () => {
    await expect(produce(() => writeFile(join(workspace, "tests/check.cjs"), "// removed assertion\n"))).rejects.toThrow("integrity gate failed");
    expect((await state()).units["wu-greeting"]?.status).toBe("failed");
    const findings = (await ledger()).events.find((event) => event.data?.kind === "integrity_check")?.data?.findings;
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "protected_test_modified", file: "tests/check.cjs", severity: "blocking" })]));
  });

  it("blocks a newly introduced validation config even when its path is owned", async () => {
    spec.work_units[0]!.owns.push("jest.config.cjs");
    await expect(produce(() => writeFile(join(workspace, "jest.config.cjs"), "module.exports = { testPathIgnorePatterns: ['.*'] };\n"))).rejects.toThrow("integrity gate failed");
    const findings = (await ledger()).events.find((event) => event.data?.kind === "integrity_check")?.data?.findings;
    expect(findings).toEqual([{ code: "protected_config_added", severity: "blocking", file: "jest.config.cjs" }]);
  });

  it("permits a new validation config with an exact approved exception and actual verification", async () => {
    spec.work_units[0]!.owns.push("jest.config.cjs");
    spec.work_units[0]!.allowed_test_changes = ["jest.config.cjs"];
    await produce(() => writeFile(join(workspace, "jest.config.cjs"), "module.exports = { testMatch: ['**/*.test.ts'] };\n"));
    expect((await verify()).outcome).toBe("accepted");
    expect((await state()).units["wu-greeting"]?.status).toBe("accepted");
  });

  it("permits a legitimate test edit only with its exact approved exception", async () => {
    spec.work_units[0]!.allowed_test_changes = ["tests/check.cjs"];
    await produce(() => writeFile(join(workspace, "tests/check.cjs"), checker + "// approved explanatory comment\n"));
    expect((await verify()).outcome).toBe("accepted");
    expect((await state()).units["wu-greeting"]?.status).toBe("accepted");
  });

  it("blocks newly executable incomplete work despite a completed producer report", async () => {
    await expect(produce(() => writeFile(join(workspace, "src/feature.ts"), "export function feature() { throw new Error('not implemented'); }\n"))).rejects.toThrow("integrity gate failed");
    expect((await state()).units["wu-greeting"]?.status).toBe("failed");
    const findings = (await ledger()).events.find((event) => event.data?.kind === "integrity_check")?.data?.findings;
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "incomplete_work", marker: "unimplemented", severity: "blocking" })]));
  });

  it("records an ordinary follow-up comment as a warning and still permits actual acceptance", async () => {
    await produce(() => writeFile(join(workspace, "src/feature.ts"), "// TODO: improve diagnostics later\nexport const feature = 43;\n"));
    expect((await verify()).outcome).toBe("accepted");
    const findings = (await ledger()).events.find((event) => event.data?.kind === "integrity_check")?.data?.findings;
    expect(findings).toEqual([{ code: "incomplete_work", marker: "todo", severity: "warning", file: "src/feature.ts", line: 1 }]);
    expect((await state()).units["wu-greeting"]?.status).toBe("accepted");
  });
});
