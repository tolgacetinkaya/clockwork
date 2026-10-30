import { Ajv } from "ajv";
import { modelIdSchema } from "../spec/schema.js";

export interface PlanningUsage { input: number; cached: number; output: number }
/** Durable evidence of a planner session, including uncertain termination and cost. */
export interface PlanningReceipt {
  version: 1;
  id: string;
  status: "running" | "completed" | "error";
  head: string;
  workspace: string;
  provider: string;
  model?: string;
  usage?: PlanningUsage;
  workspaceChanged?: boolean;
  usageUnknown: boolean;
  unreconciled: boolean;
  error?: string;
}
const safeText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength, pattern: "^(?![\\s\\S]*[\\u0000-\\u001f\\u007f-\\u009f])(?=[\\s\\S]*\\S)" });
const tokens = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const validateShape = new Ajv({ allErrors: true }).compile({
  type: "object", additionalProperties: false,
  required: ["version", "id", "status", "head", "workspace", "provider", "usageUnknown", "unreconciled"],
  properties: {
    version: { const: 1 }, id: safeText(200), status: { enum: ["running", "completed", "error"] },
    head: { type: "string", pattern: "^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})(?![\\s\\S])" },
    workspace: safeText(32768), provider: modelIdSchema, model: modelIdSchema,
    usageUnknown: { type: "boolean" }, unreconciled: { type: "boolean" }, workspaceChanged: { type: "boolean" },
    usage: { type: "object", additionalProperties: false, required: ["input", "cached", "output"], properties: { input: tokens, cached: tokens, output: tokens } },
    // Local errors can contain line breaks, but never NUL or terminal escapes.
    error: { type: "string", minLength: 1, maxLength: 65536, pattern: "^(?![\\s\\S]*[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f])(?=[\\s\\S]*\\S)" },
  },
});
/** Fail closed on malformed receipts; false uncertainty flags require actual usage evidence. */
export function validatePlanningReceipt(value: unknown): PlanningReceipt {
  const invalid = () => new Error("Invalid planning receipt; inspect .teamsmith/planning.json before continuing");
  if (!validateShape(value)) throw invalid();
  const receipt = value as PlanningReceipt;
  if (!/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(receipt.workspace)) throw invalid();
  if (receipt.usageUnknown === Boolean(receipt.usage)) throw invalid();
  if (receipt.usage && (receipt.usage.cached > receipt.usage.input || !Number.isSafeInteger(receipt.usage.input + receipt.usage.output))) throw invalid();
  if (receipt.status === "completed" && (receipt.usageUnknown || receipt.unreconciled || receipt.workspaceChanged || receipt.error !== undefined)) throw invalid();
  if (receipt.status === "running" && (!receipt.unreconciled || receipt.workspaceChanged || receipt.error !== undefined)) throw invalid();
  if (receipt.status === "error" && receipt.error === undefined) throw invalid();
  if (receipt.workspaceChanged && receipt.status !== "error") throw invalid();
  return structuredClone(receipt);
}
