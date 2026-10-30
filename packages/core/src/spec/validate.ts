import { Ajv } from "ajv";
import { posix } from "node:path";
import { specSchema } from "./schema.js";
import { parseBudget } from "./budget.js";
import type { Spec, ValidationIssue, ValidationResult, WorkUnit } from "./types.js";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateAgainstSchema = ajv.compile(specSchema);

/**
 * Schema + semantic validation. `spec` is returned only when there are no errors;
 * warnings do not invalidate the spec (they are raw material for critic behavior).
 */
export function validateSpec(doc: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!validateAgainstSchema(doc)) {
    for (const err of validateAgainstSchema.errors ?? []) {
      issues.push({
        level: "error",
        code: "schema",
        message: err.message ?? "schema violation",
        path: err.instancePath.replaceAll("/", ".").replace(/^\./, "") || undefined,
      });
    }
    return { issues };
  }

  const spec = doc as Spec;
  issues.push(...semanticIssues(spec));
  const policies = [...spec.work_units.map(unit => ({ path: `work_units.${unit.id}.watchdog`, value: unit.watchdog })), { path: "verification.watchdog", value: spec.verification?.watchdog }];
  for (const { path, value } of policies) if (value?.expected_ms !== undefined && value.hard_ms !== undefined && value.expected_ms >= value.hard_ms) issues.push({ level: "error", code: "watchdog-deadline", path, message: "Watchdog expected_ms must be less than hard_ms" });

  const hasError = issues.some((i) => i.level === "error");
  return hasError ? { issues } : { spec, issues };
}

function semanticIssues(spec: Spec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const unitIds = new Set<string>();
  const agentIds = new Set<string>();

  // Unique ids
  for (const u of spec.work_units) {
    if (unitIds.has(u.id)) {
      issues.push({
        level: "error",
        code: "dup-unit-id",
        message: `Duplicate work unit id: "${u.id}"`,
        path: "work_units",
      });
    }
    unitIds.add(u.id);
  }
  for (const a of spec.agents) {
    if (agentIds.has(a.id)) {
      issues.push({
        level: "error",
        code: "dup-agent-id",
        message: `Duplicate agent id: "${a.id}"`,
        path: "agents",
      });
    }
    agentIds.add(a.id);
  }

  // depends_on referential integrity
  for (const u of spec.work_units) {
    for (const dep of u.depends_on ?? []) {
      if (!unitIds.has(dep)) {
        issues.push({
          level: "error",
          code: "unknown-dependency",
          message: `Work unit "${u.id}" depends on unknown unit "${dep}"`,
          path: `work_units.${u.id}.depends_on`,
        });
      }
      if (dep === u.id) {
        issues.push({
          level: "error",
          code: "self-dependency",
          message: `Work unit "${u.id}" depends on itself`,
          path: `work_units.${u.id}.depends_on`,
        });
      }
    }
  }

  // Cycle detection
  const cycle = findCycle(spec.work_units);
  if (cycle) {
    issues.push({
      level: "error",
      code: "dep-cycle",
      message: `Dependency cycle: ${cycle.join(" -> ")}`,
      path: "work_units",
    });
  }

  // Assignment integrity
  for (const [unitId, agentId] of Object.entries(spec.assignment)) {
    if (!unitIds.has(unitId)) {
      issues.push({
        level: "error",
        code: "assignment-unknown-unit",
        message: `Assignment references unknown work unit "${unitId}"`,
        path: `assignment.${unitId}`,
      });
    }
    if (!agentIds.has(agentId)) {
      issues.push({
        level: "error",
        code: "assignment-unknown-agent",
        message: `Assignment of "${unitId}" references unknown agent "${agentId}"`,
        path: `assignment.${unitId}`,
      });
    }
  }
  for (const u of spec.work_units) {
    if (!(u.id in spec.assignment)) {
      issues.push({
        level: "error",
        code: "unassigned-unit",
        message: `Work unit "${u.id}" has no assigned agent`,
        path: "assignment",
      });
    }
  }

  // Ownership must be safe for every pair of potentially concurrent units.
  issues.push(...ownsOverlapIssues(spec.work_units));
  issues.push(...testExceptionIssues(spec.work_units));

  // Budget: does the sum of unit estimates exceed the target (warning)
  issues.push(...budgetIssues(spec));

  return issues;
}

function findCycle(units: WorkUnit[]): string[] | null {
  const graph = new Map(units.map((u) => [u.id, u.depends_on ?? []]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    state.set(id, "visiting");
    stack.push(id);
    for (const dep of graph.get(id) ?? []) {
      if (!graph.has(dep)) continue; // unknown-dependency already reported
      const s = state.get(dep);
      if (s === "visiting") {
        return [...stack.slice(stack.indexOf(dep)), dep];
      }
      if (s === undefined) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    state.set(id, "done");
    stack.pop();
    return null;
  };

  for (const u of units) {
    if (!state.has(u.id)) {
      const found = visit(u.id);
      if (found) return found;
    }
  }
  return null;
}

const ownershipControls = new Set([".git", ".teamsmith", ".codex", ".claude", ".agents", ".aws", ".ssh"]);
function validOwnershipPattern(pattern: string): boolean {
  // Keep the runtime ownership matcher in sync with this deliberately small grammar.
  return Boolean(pattern) && !/[\\:\x00-\x1f\x7f\[\]{}()!+@]/.test(pattern) &&
    pattern.split("/").every(part => part !== "" && part !== "." && part !== ".." &&
      !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
      !ownershipControls.has(part.toLowerCase()) && (!part.includes("**") || part === "**"));
}
function testExceptionIssues(units: WorkUnit[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fold = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  for (const unit of units) {
    for (const file of unit.allowed_test_changes ?? []) {
      if (!validOwnershipPattern(file) || /[*?]/.test(file)) {
        issues.push({ level: "error", code: "invalid-test-exception", message: `Unit "${unit.id}" test-change exception must name an exact canonical repository-relative path: "${file}"`, path: `work_units.${unit.id}.allowed_test_changes` });
      } else if (!unit.owns.some(scope => validOwnershipPattern(scope) && posix.matchesGlob(fold(file), fold(scope)))) {
        issues.push({ level: "error", code: "test-exception-outside-ownership", message: `Unit "${unit.id}" cannot approve test changes outside its ownership: "${file}"`, path: `work_units.${unit.id}.allowed_test_changes` });
      }
    }
  }
  return issues;
}

/** Ownership uses canonical relative POSIX globs: *, ?, and whole-component **.
 * Ambiguous wildcard intersections are treated conservatively. Dependency ordering
 * permits sharing; only potentially concurrent units receive a hard overlap error.
 */
function ownsOverlapIssues(units: WorkUnit[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const normalized: { unit: string; pattern: string; prefix: string }[] = [];
  const graph = new Map(units.map(unit => [unit.id, unit.depends_on ?? []]));
  const dependsOn = (unit: string, target: string, seen = new Set<string>()): boolean => {
    if (seen.has(unit)) return false;
    seen.add(unit);
    return (graph.get(unit) ?? []).some(dep => dep === target || dependsOn(dep, target, seen));
  };
  for (const unit of units) {
    for (const pattern of unit.owns) {
      const parts = pattern.split("/");
      const valid = validOwnershipPattern(pattern);
      if (!valid) {
        issues.push({ level: "error", code: "invalid-ownership", message: `Unit "${unit.id}" has an unsafe or unsupported ownership glob: "${pattern}"`, path: `work_units.${unit.id}.owns` });
        continue;
      }
      const firstMagic = parts.findIndex(part => /[*?]/.test(part));
      const prefix = (firstMagic < 0 ? parts : parts.slice(0, firstMagic)).join("/");
      normalized.push({ unit: unit.id, pattern, prefix: process.platform === "win32" ? prefix.toLowerCase() : prefix });
    }
  }
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i]!, b = normalized[j]!;
      if (a.unit === b.unit) continue;
      if (a.prefix === "" || b.prefix === "" || a.prefix === b.prefix || a.prefix.startsWith(`${b.prefix}/`) || b.prefix.startsWith(`${a.prefix}/`)) {
        const ordered = dependsOn(a.unit, b.unit) || dependsOn(b.unit, a.unit);
        issues.push({
          level: ordered ? "warning" : "error",
          code: "owns-overlap",
          message: `Units "${a.unit}" and "${b.unit}" have potentially overlapping ownership: "${a.pattern}" vs "${b.pattern}" (${ordered ? "dependency ordered" : "concurrent ownership is unsafe; add ordering or disjoint scopes"})`,
          path: "work_units",
        });
      }
    }
  }
  return issues;
}

function budgetIssues(spec: Spec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const target = spec.priorities.budget_target;
  if (target === undefined) return issues;

  let targetTokens: number;
  try {
    targetTokens = parseBudget(target);
  } catch {
    // Passed the schema pattern but failed to parse — be defensive, emit an error.
    issues.push({
      level: "error",
      code: "invalid-budget",
      message: `Unparseable budget_target: "${target}"`,
      path: "priorities.budget_target",
    });
    return issues;
  }

  let sum = 0;
  let allEstimated = true;
  for (const u of spec.work_units) {
    if (u.budget_est === undefined) {
      allEstimated = false;
      continue;
    }
    try {
      sum += parseBudget(u.budget_est);
    } catch {
      issues.push({
        level: "error",
        code: "invalid-budget",
        message: `Unparseable budget_est on unit "${u.id}": "${u.budget_est}"`,
        path: `work_units.${u.id}.budget_est`,
      });
    }
  }

  if (sum > targetTokens) {
    issues.push({
      level: "warning",
      code: "budget-overcommit",
      message:
        `Sum of unit estimates (${sum} tokens${allEstimated ? "" : ", partial"}) ` +
        `exceeds budget_target (${targetTokens} tokens)`,
      path: "priorities.budget_target",
    });
  }
  return issues;
}
