import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerWriter } from "@clockwork/core";
import type { RunState, BudgetReport } from "@clockwork/core";
import { startPanel } from "../src/index.js";
import type { PanelHandle } from "../src/index.js";

describe("panel", () => {
  let dir: string;
  let handle: PanelHandle;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-panel-"));

    const writer = await LedgerWriter.open(join(dir, ".teamsmith", "ledger.jsonl"), {
      clock: () => new Date("2026-07-17T00:00:00.000Z"),
    });
    await writer.append("run.started", {
      data: { run_id: "run-1", teamsmith_version: "0.1.0", ledger_schema_version: 1 },
    });
    await writer.append("run.phase_entered", { data: { phase: "execute" } });
    await writer.append("spec.approved", {
      actor: "user",
      data: {
        version: 1,
        budget_target: 100_000,
        units: [{ id: "wu-db" }, { id: "wu-api", depends_on: ["wu-db"] }],
      },
    });
    await writer.append("budget.estimated", { unit_id: "wu-db", data: { tokens: 40_000 } });
    await writer.append("unit.started", { unit_id: "wu-db", agent_id: "builder" });
    await writer.append("budget.spent", { unit_id: "wu-db", data: { tokens: 15_000 } });
    await writer.append("interaction.checkpoint_raised", {
      data: { ref: "gate-1", kind: "gate", blocking: true },
    });
    await writer.append("interaction.questions_batched", {
      data: { questions: ["Which auth provider?"] },
    });

    handle = await startPanel({ projectDir: dir, port: 0 });
  });

  afterEach(async () => {
    await handle.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("binds to localhost only", () => {
    expect(handle.url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("supports an explicit container bind while retaining a usable local URL", async () => {
    const containerPanel = await startPanel({ projectDir: dir, host: "0.0.0.0" });
    try {
      expect((await fetch(`${containerPanel.url}/api/state`)).status).toBe(200);
    } finally {
      await containerPanel.close();
    }
  });

  it("exposes requested controls separately from historical ledger state", async () => {
    expect(await (await fetch(`${handle.url}/api/control`)).json()).toEqual({ paused: false, kill: false });
    await fetch(`${handle.url}/api/control`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: true }),
    });
    expect(await (await fetch(`${handle.url}/api/control`)).json()).toEqual({ paused: true, kill: false });
    expect(((await (await fetch(`${handle.url}/api/state`)).json()) as RunState).paused).toBe(false);
  });

  it("derives /api/state from the ledger", async () => {
    const res = await fetch(`${handle.url}/api/state`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as RunState;

    expect(state.runId).toBe("run-1");
    expect(state.phase).toBe("execute");
    expect(state.specVersion).toBe(1);
    expect(state.specApproved).toBe(true);
    expect(state.budgetTarget).toBe(100_000);
    expect(state.totalSpent).toBe(15_000);
    expect(state.units["wu-db"]?.status).toBe("running");
    expect(state.units["wu-db"]?.agent).toBe("builder");
    expect(state.units["wu-db"]?.spent).toBe(15_000);
    expect(state.units["wu-api"]?.status).toBe("pending");
    expect(state.openCheckpoints).toEqual([{ ref: "gate-1", kind: "gate", blocking: true }]);
    expect(state.pendingQuestions).toEqual(["Which auth provider?"]);
    expect(state.anomalies).toEqual([]);
  });

  it("derives /api/budget from the ledger", async () => {
    const res = await fetch(`${handle.url}/api/budget`);
    expect(res.status).toBe(200);
    const report = (await res.json()) as BudgetReport;

    expect(report.target).toBe(100_000);
    expect(report.totalSpent).toBe(15_000);
    expect(report.remaining).toBe(85_000);
    expect(report.exhausted).toBe(false);
    const wuDb = report.units.find((u) => u.unit === "wu-db");
    expect(wuDb).toMatchObject({ estimated: 40_000, spent: 15_000 });
  });

  it("serves /api/changelog as markdown text", async () => {
    const res = await fetch(`${handle.url}/api/changelog`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("# Changelog");
    expect(text).toContain("run-1");
  });

  it("serves the built React application and its local asset references", async () => {
    const res = await fetch(`${handle.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).toContain('type="module"');
    const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
    expect(asset).toBeDefined();
    const script = await fetch(`${handle.url}${asset}`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("round-trips POST /api/control into control.json (partial patch, merges with existing)", async () => {
    const pauseRes = await fetch(`${handle.url}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: true }),
    });
    expect(pauseRes.status).toBe(200);
    expect(await pauseRes.json()).toEqual({ paused: true, kill: false });

    const onDisk1 = JSON.parse(
      await readFile(join(dir, ".teamsmith", "control.json"), "utf8"),
    ) as unknown;
    expect(onDisk1).toEqual({ paused: true, kill: false });

    // Killing afterwards must not silently clear the earlier pause.
    const killRes = await fetch(`${handle.url}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kill: true }),
    });
    expect(killRes.status).toBe(200);
    expect(await killRes.json()).toEqual({ paused: true, kill: true });

    const onDisk2 = JSON.parse(
      await readFile(join(dir, ".teamsmith", "control.json"), "utf8"),
    ) as unknown;
    expect(onDisk2).toEqual({ paused: true, kill: true });
  });

  it("rejects a malformed /api/control body", async () => {
    const res = await fetch(`${handle.url}/api/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s unknown routes", async () => {
    const res = await fetch(`${handle.url}/nope`);
    expect(res.status).toBe(404);
  });
});
