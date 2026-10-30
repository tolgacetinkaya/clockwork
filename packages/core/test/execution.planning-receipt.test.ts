import { describe, expect, it } from "vitest";
import { validatePlanningReceipt } from "../src/index.js";
const receipt = () => ({ version: 1 as const, id: "planning-id", status: "completed" as "completed" | "running" | "error", head: "a".repeat(40), workspace: "/tmp/planning-worktree", provider: "controlled", usage: { input: 10, cached: 2, output: 4 }, usageUnknown: false, unreconciled: false });
describe("durable planning receipt validation", () => {
  it("keeps exact known usage and supports running or failed uncertain sessions", () => {
    const complete = receipt(); expect(validatePlanningReceipt(complete)).toEqual(complete);
    const { usage: _, ...base } = receipt();
    expect(validatePlanningReceipt({ ...base, status: "running", usageUnknown: true, unreconciled: true }).status).toBe("running");
    expect(validatePlanningReceipt({ ...base, status: "error", usageUnknown: true, unreconciled: true, error: "Termination unconfirmed" }).status).toBe("error");
    expect(validatePlanningReceipt({ ...receipt(), status: "error", workspaceChanged: true, error: "Workspace changed" }).workspaceChanged).toBe(true);
  });
  it.each([
    null, {}, { version: 1, status: "completed", usageUnknown: false, unreconciled: false },
    { ...receipt(), status: "invented" }, { ...receipt(), version: 2 }, { ...receipt(), head: "not-a-git-hash" }, { ...receipt(), head: "a".repeat(40) + "\n" },
    { ...receipt(), workspace: "relative/worktree" }, { ...receipt(), provider: " " }, { ...receipt(), model: "--unsafe" },
    { ...receipt(), usage: undefined }, { ...receipt(), usageUnknown: true }, { ...receipt(), unreconciled: true },
    { ...receipt(), usage: { input: 1, cached: 2, output: 1 } },
    { ...receipt(), usage: { input: Number.MAX_SAFE_INTEGER, cached: 0, output: 1 } },
    { ...receipt(), usage: { input: 1, cached: 0, output: 1, invented: 1 } },
    { ...receipt(), status: "running" }, { ...receipt(), status: "error" }, { ...receipt(), workspaceChanged: true },
    { ...receipt(), error: "Unexpected success error" }, { ...receipt(), id: "private\0id" },
    { ...receipt(), workspaceChanged: "false" }, { ...receipt(), privateField: "private contents" },
  ])("rejects incomplete or inconsistent persisted evidence without echoing contents", value => {
    expect(() => validatePlanningReceipt(value)).toThrow("Invalid planning receipt; inspect .teamsmith/planning.json before continuing");
  });
  it("returns an independent snapshot", () => {
    const value = receipt(); const parsed = validatePlanningReceipt(value); value.usage.input = 999;
    expect(parsed.usage!.input).toBe(10);
  });
});
