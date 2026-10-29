import type { BudgetValue } from "./types.js";

const BUDGET_RE = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/;

/**
 * "40k" → 40_000, "1.5m" → 1_500_000, 500 → 500.
 * Throws RangeError on invalid input.
 */
export function parseBudget(value: BudgetValue): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Invalid budget value: ${value}`);
    }
    return value;
  }
  const m = BUDGET_RE.exec(value.trim());
  if (!m || m[1] === undefined) {
    throw new RangeError(`Invalid budget string: "${value}"`);
  }
  const base = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  const mult = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
  const result = base * mult;
  if (result <= 0) throw new RangeError(`Invalid budget string: "${value}"`);
  return result;
}

/** 40_000 → "40k", 1_500_000 → "1.5m", 500 → "500". */
export function formatBudget(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    throw new RangeError(`Invalid budget value: ${tokens}`);
  }
  if (tokens >= 1_000_000 && tokens % 100_000 === 0) {
    return `${tokens / 1_000_000}m`;
  }
  if (tokens >= 1_000 && tokens % 100 === 0) {
    return `${tokens / 1_000}k`;
  }
  return String(tokens);
}
