import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LedgerWriter, readLedger } from "../src/ledger/store.js";
import { REDACTED, Redactor } from "../src/ledger/redact.js";

describe("ledger store", () => {
  let dir: string;
  let file: string;
  const clock = () => new Date("2026-01-01T12:00:00Z");

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clockwork-ledger-"));
    file = join(dir, ".teamsmith", "ledger.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends and reads back a round-trip with monotonic seq", async () => {
    const writer = await LedgerWriter.open(file, { clock });
    await writer.append("run.started", { data: { run_id: "run-1" } });
    await writer.append("run.phase_entered", { data: { phase: "intake" } });

    const { events, issues } = await readLedger(file);
    expect(issues).toEqual([]);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events[0]!.type).toBe("run.started");
    expect(events[0]!.actor).toBe("orchestrator");
  });

  it("resumes seq numbering when reopened — the handoff scenario", async () => {
    const first = await LedgerWriter.open(file, { clock });
    await first.append("run.started", { data: { run_id: "run-1" } });

    // A fresh session opens the same ledger and continues.
    const second = await LedgerWriter.open(file, { clock });
    const event = await second.append("run.phase_entered", { data: { phase: "intake" } });
    expect(event.seq).toBe(2);
  });

  it("serializes multiple writers and concurrent calls", async () => {
    const writers = await Promise.all(Array.from({ length: 4 }, () => LedgerWriter.open(file)));
    await writers[0]!.append("run.started", { data: { run_id: "concurrent" } });
    await Promise.all(Array.from({ length: 16 }, (_, i) => writers[i % 4]!.append("run.phase_entered", { data: { phase: "intake" } })));
    const result = await readLedger(file);
    expect(result.issues).toEqual([]);
    expect(result.events.map(e => e.seq)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  it("refuses a truncated final record even when it contains valid JSON", async () => {
    const writer = await LedgerWriter.open(file);
    await writer.append("run.started", { data: { run_id: "run-1" } });
    const raw = await readFile(file, "utf8");
    await (await import("node:fs/promises")).writeFile(file, raw.trimEnd());
    await expect(writer.append("run.paused")).rejects.toThrow(/corrupted/);
    await expect(LedgerWriter.open(file)).rejects.toThrow(/corrupted/);
  });

  it("returns empty for a missing file", async () => {
    const { events, issues } = await readLedger(join(dir, "missing.jsonl"));
    expect(events).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("skips corrupted lines but keeps valid ones", async () => {
    const writer = await LedgerWriter.open(file, { clock });
    await writer.append("run.started", { data: { run_id: "run-1" } });
    await appendFile(file, "{not json}\n", "utf8");
    await expect(writer.append("run.phase_entered", { data: { phase: "intake" } })).rejects.toThrow(/corrupted/);

    const { events, issues } = await readLedger(file);
    expect(events).toHaveLength(1);
    expect(issues.map((i) => i.code)).toContain("ledger-parse");
  });

  it("rejects appending events of unknown type", async () => {
    const writer = await LedgerWriter.open(file, { clock });
    // @ts-expect-error deliberately bypassing the type system, as a hostile caller would
    await expect(writer.append("unit.exploded", {})).rejects.toThrow(/invalid event/i);
  });

  it("refuses to append to a ledger with broken seq ordering", async () => {
    const writer = await LedgerWriter.open(file, { clock });
    await writer.append("run.started", { data: { run_id: "run-1" } });
    const line = JSON.stringify({
      seq: 1,
      ts: clock().toISOString(),
      type: "run.paused",
      actor: "orchestrator",
    });
    await appendFile(file, `${line}\n`, "utf8");
    await expect(LedgerWriter.open(file, { clock })).rejects.toThrow(/corrupted ledger/);
  });

  it("scrubs credential property keys from persisted and returned events", async () => {
    const secret = "ghp_abcdefghijklmnopqrst1234";
    const writer = await LedgerWriter.open(file, { clock });
    await writer.append("run.started", { data: { run_id: "redaction-keys" } });
    const event = await writer.append("interaction.answers_received", {
      data: { nested: [{ [secret]: { value: secret } }] },
    });
    expect(JSON.stringify(event)).not.toContain(secret);
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain(secret);
    expect(raw).toContain(REDACTED);
  });

  it("redacts secrets in event data before they reach disk", async () => {
    const redactor = new Redactor();
    redactor.registerSecret("hunter2-super-secret");
    const writer = await LedgerWriter.open(file, { clock, redactor });
    await writer.append("run.started", { data: { run_id: "redaction" } });

    await writer.append("interaction.answers_received", {
      data: {
        note: "user provided key sk-abcdefghijklmnop1234 and password hunter2-super-secret",
        nested: { token: "ghp_abcdefghijklmnopqrst1234" },
      },
    });

    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("sk-abcdefghijklmnop1234");
    expect(raw).not.toContain("hunter2-super-secret");
    expect(raw).not.toContain("ghp_abcdefghijklmnopqrst1234");
    expect(raw).toContain(REDACTED);
  });
});

describe("Redactor", () => {
  it("scrubs built-in credential formats", () => {
    const r = new Redactor();
    expect(r.redactText("key=sk-abcdefghijklmnop1234")).toBe(`key=${REDACTED}`);
    expect(r.redactText("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTED);
    expect(r.redactText("Authorization: Bearer abcdefghijklmnop.qrstuvwxyz")).toContain(REDACTED);
  });

  it("leaves ordinary text alone", () => {
    const r = new Redactor();
    const text = "unit wu-api accepted after 2 rework cycles";
    expect(r.redactText(text)).toBe(text);
  });

  it("deep-redacts registered literals in nested values", () => {
    const r = new Redactor();
    r.registerSecret("s3cr3t-value");
    const value = { a: ["contains s3cr3t-value here"], b: { c: "s3cr3t-value" }, n: 42 };
    expect(r.redactValue(value)).toEqual({ a: [`contains ${REDACTED} here`], b: { c: REDACTED }, n: 42 });
  });

  it("scrubs nested keys while preserving colliding entries and safe prototype-named keys", () => {
    const r = new Redactor();
    r.registerSecret("private-value");
    const input = JSON.parse('{"__proto__":{"safe":"ok"},"constructor":"kept","nested":[{"private-value":1,"sk-abcdefghijklmnop1234":2,"[REDACTED]":3,"[REDACTED] (2)":4}]}');
    const output = r.redactValue(input);
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.hasOwn(output, "__proto__")).toBe(true);
    expect(output.__proto__).toEqual({ safe: "ok" });
    expect(output.constructor).toBe("kept");
    expect(output.nested[0]).toEqual({
      "[REDACTED] (3)": 1, "[REDACTED] (4)": 2, "[REDACTED]": 3, "[REDACTED] (2)": 4,
    });
    expect(JSON.stringify(output)).not.toContain("private-value");
    expect(JSON.stringify(output)).not.toContain("sk-abcdefghijklmnop1234");
    expect(input.nested[0]["private-value"]).toBe(1);
  });

  it("ignores registration of trivially short strings", () => {
    const r = new Redactor();
    r.registerSecret("ab");
    expect(r.redactText("ab is fine")).toBe("ab is fine");
  });
});
