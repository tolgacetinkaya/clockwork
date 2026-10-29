import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acknowledgeCommands, appendCommand, consumeCommands, readCommands } from "../src/commands/queue.js";
import { LedgerWriter, readLedger } from "../src/ledger/store.js";
import { withStorageLock } from "../src/storage/lock.js";

const execute = promisify(execFile);

describe("process storage serialization", () => {
  it("assigns unique contiguous sequences across independent processes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-process-storage-"));
    try {
      const file = join(dir, "ledger.jsonl");
      const writer = await LedgerWriter.open(file);
      await writer.append("run.started", { data: { run_id: "concurrent" } });
      const queueUrl = new URL("../src/commands/queue.ts", import.meta.url).href;
      const ledgerUrl = new URL("../src/ledger/store.ts", import.meta.url).href;
      const script = `
        const { appendCommand } = await import(${JSON.stringify(queueUrl)});
        const { LedgerWriter } = await import(${JSON.stringify(ledgerUrl)});
        const writer = await LedgerWriter.open(${JSON.stringify(file)});
        for (let i = 0; i < 5; i++) {
          await appendCommand(${JSON.stringify(dir)}, "note", { text: "child" });
          await writer.append("run.phase_entered", { data: { phase: "intake" } });
        }
      `;
      await Promise.all(Array.from({ length: 4 }, () => execute(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script])));
      const queue = await readCommands(dir);
      const ledger = await readLedger(file);
      expect(queue.issues).toEqual([]);
      expect(ledger.issues).toEqual([]);
      expect(queue.commands.map(c => c.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(ledger.events.map(e => e.seq)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20000);

  it("rejects hardlinked storage and cursor files without modifying targets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-alias-"));
    try {
      const original = join(dir, "original");
      const alias = join(dir, "alias");
      await writeFile(original, "private fixture");
      await link(original, alias);
      await expect(LedgerWriter.open(alias)).rejects.toThrow(/aliased or nonregular/);
      await mkdir(join(dir, ".teamsmith"));
      await link(original, join(dir, ".teamsmith", "commands.jsonl"));
      await expect(appendCommand(dir, "note", { text: "hello" })).rejects.toThrow(/aliased or nonregular/);
      await rm(join(dir, ".teamsmith", "commands.jsonl"));
      await appendCommand(dir, "note", { text: "hello" });
      await link(original, join(dir, ".teamsmith", "commands.cursor"));
      await expect(consumeCommands(dir)).rejects.toThrow(/aliased or nonregular/);
      await expect(acknowledgeCommands(dir, 1)).rejects.toThrow(/aliased or nonregular/);
      expect(await readFile(original, "utf8")).toBe("private fixture");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects nonregular storage paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-nonregular-"));
    try {
      const file = join(dir, "directory");
      await mkdir(file);
      await expect(withStorageLock(file, async () => 0)).rejects.toThrow(/nonregular/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never exposes a secret through a lock symlink", async (context) => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-lock-symlink-"));
    try {
      const secret = "PRIVATE_LOCK_FIXTURE_DO_NOT_PRINT";
      const fixture = join(dir, "secret");
      const file = join(dir, "data");
      await writeFile(fixture, secret);
      try {
        await symlink(fixture, `${file}.lock`, "file");
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          context.skip();
          return;
        }
        throw error;
      }
      const error = await withStorageLock(file, async () => 0).catch(error => error as Error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).toMatch(/aliased or nonregular/);
      expect(await readFile(fixture, "utf8")).toBe(secret);
      await rm(`${file}.lock`);
      await symlink(fixture, file, "file");
      await expect(withStorageLock(file, async () => 0)).rejects.toThrow(/aliased or nonregular/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("releases locks after failures and never steals an existing owner lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clockwork-lock-"));
    const file = join(dir, "data");
    try {
      await expect(withStorageLock(file, async () => { throw new Error("intentional"); })).rejects.toThrow("intentional");
      expect(await withStorageLock(file, async () => 42)).toBe(42);
      await writeFile(`${file}.lock`, JSON.stringify({ pid: process.pid, token: "live" }));
      await expect(withStorageLock(file, async () => 0)).rejects.toThrow(/Storage lock timeout/);
      expect(JSON.parse(await readFile(`${file}.lock`, "utf8")).token).toBe("live");
      await rm(`${file}.lock`);
      await appendCommand(dir, "note", { text: "after recovery" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10000);
});
