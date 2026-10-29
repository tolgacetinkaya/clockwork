import { describe, expect, it } from "vitest";
import { COMMAND_TYPES, isCommandType, validateCommand } from "../src/commands/types.js";

function nextCommand(type: string, data: Record<string, unknown>) {
  return { seq: 1, ts: "2026-07-17T00:00:00.000Z", type, data };
}

describe("command dictionary", () => {
  it("is closed: unknown types are rejected", () => {
    expect(isCommandType("note")).toBe(true);
    expect(isCommandType("delete_everything")).toBe(false);
    expect(isCommandType("")).toBe(false);
  });

  it("lists exactly the three command types", () => {
    expect([...COMMAND_TYPES].sort()).toEqual(["answer_questions", "note", "resolve_checkpoint"]);
  });
});

describe("validateCommand", () => {
  it("accepts a well-formed answer_questions command", () => {
    const { command, issues } = validateCommand(nextCommand("answer_questions", { text: "Use OAuth." }));
    expect(issues).toEqual([]);
    expect(command).toBeDefined();
  });

  it("accepts a well-formed resolve_checkpoint command, with and without a note", () => {
    expect(validateCommand(nextCommand("resolve_checkpoint", { ref: "gate-1" })).issues).toEqual([]);
    expect(
      validateCommand(nextCommand("resolve_checkpoint", { ref: "gate-1", note: "looks good" })).issues,
    ).toEqual([]);
  });

  it("accepts a well-formed note command", () => {
    expect(validateCommand(nextCommand("note", { text: "watch the budget" })).issues).toEqual([]);
  });

  it("rejects unknown command types with a dedicated code", () => {
    const { command, issues } = validateCommand(nextCommand("delete_everything", {}));
    expect(command).toBeUndefined();
    expect(issues.map((i) => i.code)).toContain("unknown-command-type");
  });

  it("rejects envelope violations", () => {
    expect(validateCommand(null).issues.length).toBeGreaterThan(0);
    expect(validateCommand({ seq: 0, ts: "x", type: "note", data: { text: "x" } }).issues.length)
      .toBeGreaterThan(0);
  });

  it("rejects missing/blank required data fields per type", () => {
    expect(validateCommand(nextCommand("answer_questions", {})).issues.map((i) => i.code)).toContain("command-data");
    expect(validateCommand(nextCommand("answer_questions", { text: "   " })).issues.map((i) => i.code)).toContain(
      "command-data",
    );
    expect(validateCommand(nextCommand("resolve_checkpoint", {})).issues.map((i) => i.code)).toContain(
      "command-data",
    );
    expect(
      validateCommand(nextCommand("resolve_checkpoint", { ref: "gate-1", note: 5 })).issues.map((i) => i.code),
    ).toContain("command-data");
    expect(validateCommand(nextCommand("note", { text: "" })).issues.map((i) => i.code)).toContain("command-data");
  });

  it("rejects non-object data", () => {
    expect(validateCommand(nextCommand("note", null as unknown as Record<string, unknown>)).issues.length)
      .toBeGreaterThan(0);
  });
});
