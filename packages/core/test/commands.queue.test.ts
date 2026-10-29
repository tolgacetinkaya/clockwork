import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCommand,
  acknowledgeCommands,
  consumeCommands,
  peekCommands,
  readCommands,
  readCursor,
} from "../src/commands/queue.js";

describe("command queue", () => {
  let dir: string;
  const clock = () => new Date("2026-07-17T12:00:00.000Z");

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-commands-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends and reads back a round-trip with monotonic seq", async () => {
    await appendCommand(dir, "note", { text: "hello" }, { clock });
    await appendCommand(dir, "resolve_checkpoint", { ref: "gate-1" }, { clock });

    const { commands, issues } = await readCommands(dir);
    expect(issues).toEqual([]);
    expect(commands.map((c) => c.seq)).toEqual([1, 2]);
    expect(commands[0]!.type).toBe("note");
    expect(commands[0]!.ts).toBe("2026-07-17T12:00:00.000Z");
  });

  it("returns empty for a missing queue file", async () => {
    const { commands, issues } = await readCommands(dir);
    expect(commands).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("rejects appending an unknown command type", async () => {
    await expect(appendCommand(dir, "shutdown", {}, { clock })).rejects.toThrow(/unknown command type/i);
  });

  it("rejects appending a command with malformed data", async () => {
    await expect(appendCommand(dir, "note", {}, { clock })).rejects.toThrow(/invalid command/i);
  });

  it("skips corrupted lines but keeps valid ones", async () => {
    await appendCommand(dir, "note", { text: "first" }, { clock });
    await appendFile(join(dir, ".teamsmith", "commands.jsonl"), "{not json}\n", "utf8");
    await expect(appendCommand(dir, "note", { text: "second" }, { clock })).rejects.toThrow(/corrupted/);

    const { commands, issues } = await readCommands(dir);
    expect(commands).toHaveLength(1);
    expect(issues.map((i) => i.code)).toContain("command-parse");
  });

  it("refuses to append to a queue with broken seq ordering", async () => {
    await appendCommand(dir, "note", { text: "first" }, { clock });
    const line = JSON.stringify({
      seq: 1,
      ts: clock().toISOString(),
      type: "note",
      data: { text: "duplicate seq" },
    });
    await appendFile(join(dir, ".teamsmith", "commands.jsonl"), `${line}\n`, "utf8");
    await expect(appendCommand(dir, "note", { text: "third" }, { clock })).rejects.toThrow(/corrupted command queue/);
  });

  it("serializes concurrent appenders", async () => {
    await Promise.all(Array.from({ length: 16 }, (_, i) => appendCommand(dir, "note", { text: String(i) })));
    expect((await readCommands(dir)).commands.map(c => c.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("rejects out of range acknowledgments and preserves replay", async () => {
    await appendCommand(dir, "note", { text: "a" });
    await expect(acknowledgeCommands(dir, 2)).rejects.toThrow(/prefix/);
    expect((await consumeCommands(dir)).map(c => c.seq)).toEqual([1]);
    await acknowledgeCommands(dir, 1);
    await acknowledgeCommands(dir, 0);
    expect(await readCursor(dir)).toBe(1);
  });

  it("rejects truncated records and malformed cursors", async () => {
    await appendCommand(dir, "note", { text: "a" });
    await appendFile(join(dir, ".teamsmith", "commands.cursor"), "1junk");
    await expect(consumeCommands(dir)).rejects.toThrow(/cursor/i);
    await appendFile(join(dir, ".teamsmith", "commands.jsonl"), "{");
    await expect(appendCommand(dir, "note", { text: "b" })).rejects.toThrow(/corrupted/);
    await expect(acknowledgeCommands(dir, 1)).rejects.toThrow(/corrupted/i);
  });

  describe("cursor semantics", () => {
    it("consumes from the start when no cursor file exists", async () => {
      expect(await readCursor(dir)).toBe(0);
    });

    it("replays commands until explicit acknowledgment", async () => {
      await appendCommand(dir, "note", { text: "a" }, { clock });
      await appendCommand(dir, "note", { text: "b" }, { clock });
      await appendCommand(dir, "note", { text: "c" }, { clock });

      const first = await consumeCommands(dir);
      expect(first.map((c) => c.seq)).toEqual([1, 2, 3]);
      expect(await readCursor(dir)).toBe(0);
      expect(await consumeCommands(dir)).toEqual(first);
      await acknowledgeCommands(dir, 3);

      const second = await consumeCommands(dir);
      expect(second).toEqual([]);
      expect(await readCursor(dir)).toBe(3);
    });

    it("only returns commands appended after the cursor", async () => {
      await appendCommand(dir, "note", { text: "a" }, { clock });
      await acknowledgeCommands(dir, 1);
      await appendCommand(dir, "note", { text: "b" }, { clock });

      const pending = await consumeCommands(dir);
      expect(pending.map((c) => c.seq)).toEqual([2]);
    });

    it("peekCommands reports queued commands without advancing the cursor", async () => {
      await appendCommand(dir, "note", { text: "a" }, { clock });
      await appendCommand(dir, "note", { text: "b" }, { clock });

      const status1 = await peekCommands(dir);
      expect(status1.consumedSeq).toBe(0);
      expect(status1.queued.map((c) => c.seq)).toEqual([1, 2]);

      // Peeking twice must not consume.
      const status2 = await peekCommands(dir);
      expect(status2.consumedSeq).toBe(0);
      expect(status2.queued.map((c) => c.seq)).toEqual([1, 2]);

      await acknowledgeCommands(dir, 2);
      const status3 = await peekCommands(dir);
      expect(status3.consumedSeq).toBe(2);
      expect(status3.queued).toEqual([]);
    });

    it("persists the cursor as a plain integer on disk", async () => {
      await appendCommand(dir, "note", { text: "a" }, { clock });
      await acknowledgeCommands(dir, 1);
      const raw = await readFile(join(dir, ".teamsmith", "commands.cursor"), "utf8");
      expect(raw.trim()).toBe("1");
    });
  });
});
