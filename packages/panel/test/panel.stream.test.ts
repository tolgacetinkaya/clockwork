import { request } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LedgerWriter,
  appendCommand,
  acknowledgeCommands,
} from "@clockwork/core";
import { startPanel } from "../src/server.js";
import type { PanelHandle } from "../src/server.js";
import type { PanelSnapshot } from "../src/protocol.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
async function stream(url: string, lastId?: string) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  const response = await fetch(`${url}/api/stream`, {
    signal: abort.signal,
    headers: lastId ? { "Last-Event-ID": lastId } : {},
  });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  let buffer = "";
  const decoder = new TextDecoder();
  return {
    close: () => {
      clearTimeout(timeout);
      abort.abort();
    },
    next: async (
      matches: (snapshot: PanelSnapshot) => boolean = () => true,
    ): Promise<PanelSnapshot> => {
      while (true) {
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!frame.includes("event: snapshot")) continue;
          const raw = frame
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
          if (!raw) continue;
          const snapshot = JSON.parse(raw) as PanelSnapshot;
          if (matches(snapshot)) return snapshot;
        }
        const chunk = await reader.read();
        if (chunk.done)
          throw new Error("Stream closed before expected snapshot");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

describe("shared live panel transport", () => {
  let project: string;
  let panel: PanelHandle;
  let writer: LedgerWriter;
  const clients: Awaited<ReturnType<typeof stream>>[] = [];
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "clockwork-live-"));
    writer = await LedgerWriter.open(
      join(project, ".teamsmith", "ledger.jsonl"),
    );
    await writer.append("run.started", { data: { run_id: "live-run" } });
    await writer.append("spec.approved", {
      data: { version: 1, budget_target: 100, units: [{ id: "task" }] },
    });
    await writer.append("unit.started", {
      unit_id: "task",
      agent_id: "builder",
    });
    panel = await startPanel({ projectDir: project });
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await panel.close();
    await rm(project, { recursive: true, force: true });
  });
  const connect = async (url: string, lastId?: string) => {
    const client = await stream(url, lastId);
    clients.push(client);
    return client;
  };

  it("delivers external CLI events to two subscribers with one consistent projection", async () => {
    const [a, b] = await Promise.all([connect(panel.url), connect(panel.url)]);
    const [first, second] = await Promise.all([a.next(), b.next()]);
    expect(first.streamId).toBe(second.streamId);
    expect(first.agents[0]).toMatchObject({
      id: "builder",
      status: "working",
      units: ["task"],
    });
    await exec(
      process.execPath,
      [
        join(root, "node_modules/tsx/dist/cli.mjs"),
        join(root, "packages/cli/src/bin.ts"),
        "event",
        "budget.spent",
        "--unit",
        "task",
        "--data",
        JSON.stringify({ tokens: 17 }),
      ],
      { cwd: project },
    );
    const [nextA, nextB] = await Promise.all([
      a.next((s) => s.state.totalSpent === 17),
      b.next((s) => s.state.totalSpent === 17),
    ]);
    expect(nextA.revision).toBeGreaterThan(first.revision);
    expect(nextA.state.lastSeq).toBe(4);
    expect(nextA.budget.totalSpent).toBe(nextA.state.totalSpent);
    expect(nextA.events.at(-1)?.seq).toBe(nextA.state.lastSeq);
    expect(nextA).toEqual(nextB);
  }, 15_000);

  it("streams controls, queued commands, and acknowledgments even without new ledger events", async () => {
    const client = await connect(panel.url);
    const first = await client.next();
    await writeFile(
      join(project, ".teamsmith", "control.json"),
      JSON.stringify({ paused: true, kill: false }),
    );
    const paused = await client.next((s) => s.control.paused);
    expect(paused.state.paused).toBe(false);
    await appendCommand(project, "note", { text: "Keep the scope small" });
    const queued = await client.next((s) => s.queue.queued.length === 1);
    expect(queued.state.lastSeq).toBe(first.state.lastSeq);
    expect(queued.revision).toBeGreaterThan(first.revision);
    await acknowledgeCommands(project, 1);
    const acknowledged = await client.next((s) => s.queue.consumedSeq === 1);
    expect(acknowledged.queue.queued).toEqual([]);
  });

  it("resynchronizes missed events and a new server epoch on reconnect", async () => {
    const a = await connect(panel.url);
    const old = await a.next();
    a.close();
    await writer.append("budget.spent", {
      unit_id: "task",
      data: { tokens: 21 },
    });
    const b = await connect(panel.url, `${old.streamId}:${old.revision}`);
    const current = await b.next();
    expect(current.state.totalSpent).toBe(21);
    b.close();
    await panel.close();
    panel = await startPanel({ projectDir: project });
    const c = await connect(
      panel.url,
      `${current.streamId}:${current.revision}`,
    );
    const restarted = await c.next();
    expect(restarted.streamId).not.toBe(old.streamId);
    expect(restarted.state.totalSpent).toBe(21);
  });

  it("keeps a recorded agent error visible even while its unit remains running", async () => {
    await writer.append("agent.error", {
      agent_id: "builder",
      data: { message: "Worker failed" },
    });
    const snapshot = (await (
      await fetch(`${panel.url}/api/snapshot`)
    ).json()) as PanelSnapshot;
    expect(snapshot.state.units.task?.status).toBe("running");
    expect(
      snapshot.agents.find((agent) => agent.id === "builder")?.status,
    ).toBe("attention");
  });

  it("associates an independent verifier with its unit and streams its recorded activity", async () => {
    await writer.append("agent.completed", {
      agent_id: "builder",
      unit_id: "task",
    });
    await writer.append("unit.verify_started", { unit_id: "task" });
    await writer.append("agent.spawned", {
      agent_id: "builder-codex-verify-1",
      unit_id: "task",
      data: { mode: "verify", provider: "codex" },
    });
    await writer.append("agent.activity", {
      agent_id: "builder-codex-verify-1",
      unit_id: "task",
      data: { kind: "command_execution", status: "completed" },
    });
    const snapshot = (await (
      await fetch(`${panel.url}/api/snapshot`)
    ).json()) as PanelSnapshot;
    const verifier = snapshot.agents.find(
      (agent) => agent.id === "builder-codex-verify-1",
    );
    expect(verifier?.units).toEqual(["task"]);
    expect(verifier?.status).toBe("verifying");
    expect(
      snapshot.agents.find((agent) => agent.id === "builder")?.status,
    ).toBe("completed");
    expect(snapshot.events.at(-1)?.type).toBe("agent.activity");
  });

  it("does not resend an unchanged large snapshot on every socket drain", async () => {
    await writer.append("agent.spawned", {
      agent_id: "context-agent",
      data: { context: "x".repeat(120_000) },
    });
    const client = await connect(panel.url);
    const first = await client.next();
    expect(first.events.at(-1)?.data?.context).toHaveLength(120_000);
    const duplicate = await Promise.race([
      client
        .next()
        .then(() => true)
        .catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    client.close();
    expect(duplicate).toBe(false);
  });

  it("exposes corrupt controls and queue diagnostics without silently clearing the run", async () => {
    await writeFile(join(project, ".teamsmith", "control.json"), "[]");
    await writeFile(
      join(project, ".teamsmith", "commands.jsonl"),
      "not json\n",
    );
    const snapshot = (await (
      await fetch(`${panel.url}/api/snapshot`)
    ).json()) as PanelSnapshot;
    expect(snapshot.issues).toHaveLength(2);
    expect(snapshot.state.runId).toBe("live-run");
  });

  it("rejects cross-origin mutations, invalid bodies, and asset traversal", async () => {
    const attack = await fetch(`${panel.url}/api/control`, {
      method: "POST",
      headers: { origin: "https://example.com" },
      body: JSON.stringify({ kill: true }),
    });
    expect(attack.status).toBe(403);
    expect(
      (await fetch(`${panel.url}/api/control`, { method: "POST", body: "[]" }))
        .status,
    ).toBe(400);
    expect(
      (await fetch(`${panel.url}/assets/%2e%2e%2fpackage.json`)).status,
    ).toBe(404);
    const hostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          `${panel.url}/api/state`,
          { headers: { host: "attacker.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(hostStatus).toBe(403);
  });
});
