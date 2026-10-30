import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LedgerWriter,
  readLedger,
  reduceLedger,
  writeSpecFile,
} from "@clockwork/core";
import type {
  ExecutionAdapter,
  ExecutionEvent,
  ExecutionReport,
  ExecutionRequest,
  Spec,
} from "@clockwork/core";
import { runUnit } from "../src/index.js";
import { git } from "../src/workspace.js";
const good: ExecutionReport = {
  outcome: "completed",
  summary: "Producer-private reasoning",
  evidence: [],
  findings: [],
};
const verified: ExecutionReport = {
  outcome: "accepted",
  summary: "Checked independently",
  evidence: [
    {
      criterion: "greeting is hello",
      command: "read greeting.txt",
      result: "hello",
      passed: true,
    },
  ],
  findings: [],
};
describe("provider-neutral unit runner", () => {
  let temp: string,
    project: string,
    workspace: string,
    writer: LedgerWriter,
    spec: Spec;
  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), "clockwork-runner-"));
    project = join(temp, "project");
    workspace = join(temp, "worker");
    await mkdir(project);
    await git(project, "init", "-b", "main");
    await writeFile(join(project, "README.md"), "baseline");
    await git(project, "add", ".");
    await git(
      project,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "baseline",
    );
    await git(project, "worktree", "add", "--detach", workspace, "HEAD");
    await mkdir(join(project, ".teamsmith"));
    await writeFile(
      join(project, ".teamsmith/control.json"),
      JSON.stringify({ paused: false, kill: false }),
    );
    spec = {
      spec_version: 1,
      meta: { goal: "Greeting" },
      priorities: { budget_target: 10000, bias: "fast" },
      work_units: [
        {
          id: "wu-greeting",
          type: "code",
          description: "Write greeting.txt containing hello",
          owns: ["greeting.txt"],
          acceptance: ["greeting is hello"],
          budget_est: 100,
        },
      ],
      agents: [
        { id: "builder", purpose: "Build greeting", model_tier: "standard" },
      ],
      assignment: { "wu-greeting": "builder" },
    };
    await writeSpecFile(join(project, ".teamsmith"), spec);
    writer = await LedgerWriter.open(join(project, ".teamsmith/ledger.jsonl"));
    await writer.append("run.started", { data: { run_id: "run-local" } });
    await writer.append("spec.approved", {
      actor: "user",
      data: {
        version: 1,
        budget_target: 10000,
        units: [{ id: "wu-greeting" }],
      },
    });
    await writer.append("run.phase_entered", { data: { phase: "execute" } });
  });
  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });
  const state = async (project: string) =>
    reduceLedger(
      (await readLedger(join(project, ".teamsmith/ledger.jsonl"))).events,
    );
  function adapter(
    report: ExecutionReport,
    change?: (request: ExecutionRequest) => Promise<void>,
  ): ExecutionAdapter {
    return {
      id: "test",
      async *execute(request): AsyncGenerator<ExecutionEvent> {
        yield { type: "thread", id: request.mode + "-thread" };
        yield {
          type: "activity",
          kind: "command_execution",
          status: "started",
        };
        if (change) await change(request);
        yield { type: "usage", input: 10, cached: 8, output: 2 };
        yield { type: "report", report };
      },
    };
  }
  async function produce() {
    return runUnit({
      project,
      workspace,
      unit: "wu-greeting",
      mode: "produce",
      adapter: adapter(good, () =>
        writeFile(join(workspace, "greeting.txt"), "hello"),
      ),
    });
  }
  it("records live activity and real usage, then accepts only an independent verifier", async () => {
    await produce();
    expect((await state(project)).units["wu-greeting"]?.status).toBe("running");
    expect((await state(project)).totalSpent).toBe(12); // cached tokens are already included in input.
    let prompt = "";
    await runUnit({
      project,
      workspace,
      unit: "wu-greeting",
      mode: "verify",
      adapter: adapter(verified, async (r) => {
        prompt = r.prompt;
        expect(await readFile(join(workspace, "greeting.txt"), "utf8")).toBe(
          "hello",
        );
      }),
    });
    expect(prompt).not.toContain(good.summary);
    const current = await state(project);
    expect(current.units["wu-greeting"]?.status).toBe("accepted");
    expect(current.totalSpent).toBe(24);
    expect(current.anomalies).toEqual([]);
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl")))
      .events;
    expect(events.some((e) => e.type === "agent.activity")).toBe(true);
    expect(
      new Set(
        events.filter((e) => e.type === "agent.spawned").map((e) => e.agent_id),
      ).size,
    ).toBe(2);
  });
  it("sends missing acceptance evidence to rework and permits another producer on the same receipt", async () => {
    await produce();
    const result = await runUnit({
      project,
      workspace,
      unit: "wu-greeting",
      mode: "verify",
      adapter: adapter({ ...verified, evidence: [] }),
    });
    expect(result.outcome).toBe("rework");
    expect((await state(project)).units["wu-greeting"]?.status).toBe("rework");
    await produce();
    expect((await state(project)).units["wu-greeting"]?.status).toBe("running");
  });
  it("rejects a changed delivery between producer and verifier", async () => {
    await produce();
    await writeFile(join(workspace, "greeting.txt"), "tampered");
    await expect(
      runUnit({
        project,
        workspace,
        unit: "wu-greeting",
        mode: "verify",
        adapter: adapter(verified),
      }),
    ).rejects.toThrow(/changed since production/);
    expect((await state(project)).units["wu-greeting"]?.status).toBe("running");
  });
  it("rejects main-tree execution and dirty producer worktrees before spawning", async () => {
    await expect(
      runUnit({
        project,
        workspace: project,
        unit: "wu-greeting",
        mode: "produce",
        adapter: adapter(good),
      }),
    ).rejects.toThrow(/separate linked/);
    await writeFile(join(workspace, "existing.txt"), "preserve me");
    await expect(produce()).rejects.toThrow(/must be clean/);
    expect((await state(project)).units["wu-greeting"]?.status).toBe("pending");
  });
  it.each(["paused", "corrupt", "missing"])(
    "fails closed on %s controls",
    async (kind) => {
      const file = join(project, ".teamsmith/control.json");
      if (kind === "missing") await rm(file);
      else
        await writeFile(
          file,
          kind === "corrupt" ? "[]" : '{"paused":true,"kill":false}',
        );
      await expect(produce()).rejects.toThrow();
      expect((await state(project)).units["wu-greeting"]?.status).toBe(
        "pending",
      );
    },
  );
  it("refuses out-of-scope output and preserves files for manual review", async () => {
    await expect(
      runUnit({
        project,
        workspace,
        unit: "wu-greeting",
        mode: "produce",
        adapter: adapter(good, () =>
          writeFile(join(workspace, "README.md"), "out of scope"),
        ),
      }),
    ).rejects.toThrow(/outside unit ownership/);
    expect((await state(project)).units["wu-greeting"]?.status).toBe("failed");
    expect(await readFile(join(workspace, "README.md"), "utf8")).toBe(
      "out of scope",
    );
  });
  it("refuses a verifier that mutates the delivery", async () => {
    await produce();
    await expect(
      runUnit({
        project,
        workspace,
        unit: "wu-greeting",
        mode: "verify",
        adapter: adapter(verified, () =>
          writeFile(join(workspace, "greeting.txt"), "fixed by verifier"),
        ),
      }),
    ).rejects.toThrow(/Verifier modified/);
    expect((await state(project)).units["wu-greeting"]?.status).toBe("rework");
  });
  it("does not start with insufficient remaining budget", async () => {
    await writer.append("budget.spent", { data: { tokens: 9950 } });
    await expect(produce()).rejects.toThrow(/estimate exceeds/);
  });
  it("interrupts an active worker on pause and records unknown usage without inventing zero", async () => {
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const pending = runUnit({
      project,
      workspace,
      unit: "wu-greeting",
      mode: "produce",
      adapter: {
        id: "test",
        async *execute(request): AsyncGenerator<ExecutionEvent> {
          entered();
          await new Promise<void>((_, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(new Error("interrupted")),
              { once: true },
            );
          });
        },
      },
    });
    const assertion = expect(pending).rejects.toThrow(/interrupted/);
    await started;
    await writeFile(
      join(project, ".teamsmith/control.json"),
      '{"paused":true,"kill":false}',
    );
    await assertion;
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl")))
      .events;
    expect(
      events.find((e) => e.type === "agent.error")?.data?.usage_unknown,
    ).toBe(true);
    expect(events.some((e) => e.type === "budget.spent")).toBe(false);
    await writeFile(
      join(project, ".teamsmith/control.json"),
      '{"paused":false,"kill":false}',
    );
    await expect(produce()).rejects.toThrow(/unknown usage/);
  });
  it("records a blocked producer report without losing its explanation or usage", async () => {
    const report = await runUnit({
      project,
      workspace,
      unit: "wu-greeting",
      mode: "produce",
      adapter: adapter({
        ...good,
        outcome: "blocked",
        findings: ["Native sandbox is unavailable"],
      }),
    });
    expect(report.outcome).toBe("blocked");
    const events = (await readLedger(join(project, ".teamsmith/ledger.jsonl")))
      .events;
    expect(
      events.find((e) => e.type === "agent.completed")?.data?.report,
    ).toMatchObject({ findings: ["Native sandbox is unavailable"] });
    expect(events.some((e) => e.type === "agent.error")).toBe(false);
    expect((await state(project)).units["wu-greeting"]?.status).toBe("failed");
    expect((await state(project)).totalSpent).toBe(12);
  });
  it("does not accept a unit cancelled while its worker was executing", async () => {
    await expect(
      runUnit({
        project,
        workspace,
        unit: "wu-greeting",
        mode: "produce",
        adapter: adapter(good, async () => {
          await writer.append("unit.cancelled", {
            unit_id: "wu-greeting",
            data: { reason: "Operator cancelled" },
          });
        }),
      }),
    ).rejects.toThrow(/Run changed/);
    const current = await state(project);
    expect(current.units["wu-greeting"]?.status).toBe("cancelled");
    expect(current.anomalies).toEqual([]);
  });
  it("serializes competing producers with an observed in-flight worker", async () => {
    let release!: () => void,
      entered!: () => void,
      calls = 0;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const shared = adapter(good, async () => {
      calls++;
      entered();
      await gate;
    });
    const first = runUnit({
      project,
      workspace,
      unit: "wu-greeting",
      mode: "produce",
      adapter: shared,
    });
    await started;
    const second = runUnit({
      project,
      workspace,
      unit: "wu-greeting",
      mode: "produce",
      adapter: shared,
    });
    const assertion = expect(second).rejects.toThrow(/not ready/);
    await new Promise((r) => setTimeout(r, 75));
    expect(calls).toBe(1);
    release();
    await first;
    await assertion;
    expect(calls).toBe(1);
  });
});
