import type { ExecutionReport } from "./types.js";

export const executionReportSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary", "evidence", "findings"],
  properties: {
    outcome: {
      type: "string",
      enum: ["completed", "accepted", "rework", "blocked"],
    },
    summary: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "command", "result", "passed"],
        properties: {
          criterion: { type: "string" },
          command: { type: "string" },
          result: { type: "string" },
          passed: { type: "boolean" },
        },
      },
    },
    findings: { type: "array", items: { type: "string" } },
  },
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseExecutionReport(text: string): ExecutionReport {
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch {
    throw new Error("Provider returned invalid report JSON");
  }
  if (
    !record(r) ||
    !["completed", "accepted", "rework", "blocked"].includes(
      String(r.outcome),
    ) ||
    typeof r.summary !== "string" ||
    !r.summary.trim() ||
    !Array.isArray(r.findings) ||
    r.findings.some((f) => typeof f !== "string") ||
    !Array.isArray(r.evidence) ||
    r.evidence.some(
      (e) =>
        !record(e) ||
        typeof e.criterion !== "string" ||
        !e.criterion.trim() ||
        typeof e.command !== "string" ||
        !e.command.trim() ||
        typeof e.result !== "string" ||
        !e.result.trim() ||
        typeof e.passed !== "boolean",
    )
  )
    throw new Error("Provider returned an invalid execution report");
  return r as unknown as ExecutionReport;
}
