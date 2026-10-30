import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startPanel } from "../src/index.js";
import type { Command, PanelHandle, QueueStatus } from "../src/index.js";

describe("panel command channel", () => {
  let dir: string;
  let handle: PanelHandle;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-panel-commands-"));
    handle = await startPanel({ projectDir: dir, port: 0 });
  });

  afterEach(async () => {
    await handle.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET /api/commands reports an empty queue before anything is submitted", async () => {
    const res = await fetch(`${handle.url}/api/commands`);
    expect(res.status).toBe(200);
    const status = (await res.json()) as QueueStatus;
    expect(status).toEqual({ queued: [], consumedSeq: 0 });
  });

  it("round-trips answer_questions, resolve_checkpoint, and note through POST /api/commands", async () => {
    const answerRes = await fetch(`${handle.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "answer_questions", data: { text: "Use OAuth." } }),
    });
    expect(answerRes.status).toBe(200);
    const answerCommand = (await answerRes.json()) as Command;
    expect(answerCommand).toMatchObject({ seq: 1, type: "answer_questions", data: { text: "Use OAuth." } });

    const checkpointRes = await fetch(`${handle.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "resolve_checkpoint", data: { ref: "gate-1", note: "looks good" } }),
    });
    expect(checkpointRes.status).toBe(200);
    expect(await checkpointRes.json()).toMatchObject({
      seq: 2,
      type: "resolve_checkpoint",
      data: { ref: "gate-1", note: "looks good" },
    });

    const noteRes = await fetch(`${handle.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", data: { text: "watch the budget" } }),
    });
    expect(noteRes.status).toBe(200);
    expect(await noteRes.json()).toMatchObject({ seq: 3, type: "note" });

    const statusRes = await fetch(`${handle.url}/api/commands`);
    const status = (await statusRes.json()) as QueueStatus;
    expect(status.consumedSeq).toBe(0);
    expect(status.queued.map((c) => c.seq)).toEqual([1, 2, 3]);

    const onDisk = await readFile(join(dir, ".teamsmith", "commands.jsonl"), "utf8");
    expect(onDisk.trim().split("\n")).toHaveLength(3);
  });

  it("replays pulled commands until the consumer explicitly acknowledges successful processing", async () => {
    for (const text of ["a", "b", "c"]) {
      await fetch(`${handle.url}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "note", data: { text } }),
      });
    }

    const { acknowledgeCommands, consumeCommands } = await import("@clockwork/core");
    const first = await consumeCommands(dir);
    expect(first.map((c) => c.seq)).toEqual([1, 2, 3]);

    const statusAfterConsume = (await (await fetch(`${handle.url}/api/commands`)).json()) as QueueStatus;
    expect(statusAfterConsume.consumedSeq).toBe(0);
    expect(statusAfterConsume.queued.map((command) => command.seq)).toEqual([1, 2, 3]);

    const second = await consumeCommands(dir);
    expect(second).toEqual(first);
    await acknowledgeCommands(dir, 3);
    expect(await consumeCommands(dir)).toEqual([]);
    expect(await (await fetch(`${handle.url}/api/commands`)).json()).toEqual({ queued: [], consumedSeq: 3 });
  });

  it("reports corrupt queue data instead of silently delivering a partial queue", async () => {
    await fetch(`${handle.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", data: { text: "first" } }),
    });
    await appendFile(join(dir, ".teamsmith", "commands.jsonl"), "{not json}\n", "utf8");

    const res = await fetch(`${handle.url}/api/commands`);
    expect(res.status).toBe(500);
    const status = (await res.json()) as { error: string };
    expect(status.error).toContain("Corrupted command queue");
  });

  it("rejects an unknown command type with 400", async () => {
    const res = await fetch(`${handle.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "shutdown_orchestrator", data: {} }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("rejects detected credentials without echoing or persisting them and keeps the queue usable", async () => {
    const secret = "sk-abcdefghijklmnop1234";
    const send = (text: string) => fetch(`${handle.url}/api/commands`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "answer_questions", data: { text } }),
    });
    const rejected = await send(`use ${secret}`);
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).not.toContain(secret);
    await expect(readFile(join(dir, ".teamsmith", "commands.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const accepted = await send("Use OAuth.");
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ seq: 1, data: { text: "Use OAuth." } });
    const onDisk = await readFile(join(dir, ".teamsmith", "commands.jsonl"), "utf8");
    expect(onDisk).not.toContain(secret);
    expect(onDisk.trim().split("\n")).toHaveLength(1);
  });

  it("rejects malformed command data with 400", async () => {
    const res = await fetch(`${handle.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "resolve_checkpoint", data: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a request body missing type with 400", async () => {
    const res = await fetch(`${handle.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { text: "x" } }),
    });
    expect(res.status).toBe(400);
  });

  it("includes pending operator requests in the shared snapshot", async () => {
    await fetch(`${handle.url}/api/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "note", data: { text: "Shared across screens" } }) });
    const response = await fetch(`${handle.url}/api/snapshot`);
    expect(response.status).toBe(200);
    const snapshot = await response.json() as { queue: QueueStatus };
    expect(snapshot.queue.queued[0]).toMatchObject({ type: "note", data: { text: "Shared across screens" } });
  });
});
