/**
 * Loads retro records from a directory for the experience memory layer
 * (CONCEPT.md §6.2). A single corrupt or half-written record must not stop
 * INTAKE from reading the rest — malformed files are reported, not thrown.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { RetroRecord } from "../retro/record.js";
import type { LoadRetroRecordsResult, RetroLoadError } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural check, not a full schema validator: just enough to trust the
 * fields buildExperiencePrior reads. Unknown extra fields are tolerated —
 * this module must not become the retro schema's second source of truth.
 */
export function validateRetroRecord(value: unknown): value is RetroRecord {
  if (!isPlainObject(value)) return false;
  if (typeof value.retro_schema_version !== "number") return false;
  if (typeof value.run_id !== "string" || value.run_id.length === 0) return false;
  if (value.outcome !== "done" && value.outcome !== "abandoned" && value.outcome !== null) return false;
  if (!isPlainObject(value.budget)) return false;
  if (typeof value.budget.total_spent !== "number") return false;
  if (!isPlainObject(value.signals)) return false;
  if (typeof value.signals.escalation_max_step !== "number") return false;
  if (!Array.isArray(value.units)) return false;
  for (const u of value.units) {
    if (!isPlainObject(u)) return false;
    if (typeof u.unit !== "string") return false;
    if (typeof u.estimated !== "number" || typeof u.spent !== "number") return false;
    if (typeof u.rework_attempts !== "number") return false;
  }
  if (value.context !== undefined && !isPlainObject(value.context)) return false;
  return true;
}

/** Reads and validates every `retro-*.yaml` file directly inside `dir`. */
export async function loadRetroRecords(dir: string): Promise<LoadRetroRecordsResult> {
  const records: RetroRecord[] = [];
  const errors: RetroLoadError[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    return { records, errors: [{ file: dir, message: (err as Error).message }] };
  }

  const files = entries.filter((f) => f.startsWith("retro-") && f.endsWith(".yaml")).sort();

  for (const file of files) {
    const filePath = join(dir, file);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      errors.push({ file: filePath, message: (err as Error).message });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      errors.push({ file: filePath, message: `invalid YAML: ${(err as Error).message}` });
      continue;
    }

    if (!validateRetroRecord(parsed)) {
      errors.push({ file: filePath, message: "does not match the retro record shape" });
      continue;
    }
    records.push(parsed);
  }

  return { records, errors };
}
