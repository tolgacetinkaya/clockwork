import { Ajv } from "ajv";
import { amendmentSchema } from "./schema.js";
import { validateSpec } from "./validate.js";
import type {
  Amendment,
  AmendmentImpact,
  AmendmentResult,
  CancelledUnit,
  Spec,
  ValidationIssue,
  WorkUnit,
} from "./types.js";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validateAgainstSchema = ajv.compile(amendmentSchema);

/** Schema + consistency validation of an amendment document (independent of any spec). */
export function validateAmendment(doc: unknown): { amendment?: Amendment; issues: ValidationIssue[] } {
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

  const amendment = doc as Amendment;
  for (const [i, change] of amendment.changes.entries()) {
    if (change.action === "add" && !change.def) {
      issues.push({
        level: "error",
        code: "add-missing-def",
        message: `changes[${i}]: "add" requires a full unit "def"`,
        path: `changes.${i}`,
      });
    }
    if (change.action === "retarget" && change.budget_target === undefined) {
      issues.push({
        level: "error",
        code: "retarget-missing-target",
        message: `changes[${i}]: "retarget" requires "budget_target"`,
        path: `changes.${i}`,
      });
    }
    if (change.action !== "add" && change.action !== "retarget" && !change.unit) {
      issues.push({
        level: "error",
        code: "missing-target-unit",
        message: `changes[${i}]: "${change.action}" requires a target "unit"`,
        path: `changes.${i}`,
      });
    }
    if (change.action === "modify" && !change.patch && !change.assign_to) {
      issues.push({
        level: "error",
        code: "empty-modify",
        message: `changes[${i}]: "modify" requires a "patch" and/or "assign_to"`,
        path: `changes.${i}`,
      });
    }
  }

  return issues.some((i) => i.level === "error") ? { issues } : { amendment, issues };
}

/**
 * Applies an amendment to a spec: produces the next spec (version +1) + impact analysis.
 *
 * Cancellation cascade: every unit that (transitively) depends on a cancelled unit
 * is cancelled too, unless the amendment re-points its dependencies — the impact is
 * made visible instead of leaving a half-invalid plan behind (CONCEPT §9).
 *
 * @param spentByUnit tokens spent per unit so far (from the ledger; M2+).
 */
export function applyAmendment(
  spec: Spec,
  amendment: Amendment,
  spentByUnit: Record<string, number> = {},
): AmendmentResult {
  const issues: ValidationIssue[] = [];
  const emptyImpact: AmendmentImpact = { continue: [], modified: [], cancel: [], new: [] };

  if (amendment.base_version !== spec.spec_version) {
    return {
      impact: emptyImpact,
      issues: [
        {
          level: "error",
          code: "base-version-mismatch",
          message: `Amendment targets spec v${amendment.base_version} but current spec is v${spec.spec_version}`,
        },
      ],
    };
  }

  const unitsById = new Map(spec.work_units.map((u) => [u.id, u]));
  const agentIds = new Set(spec.agents.map((a) => a.id));
  const explicitCancels = new Set<string>();
  const added = new Map<string, WorkUnit>();
  const modified = new Map<string, WorkUnit>();
  const assignment = { ...spec.assignment };
  let retargetTo: WorkUnit["budget_est"] | undefined;

  for (const [i, change] of amendment.changes.entries()) {
    const where = `changes.${i}`;
    switch (change.action) {
      case "add": {
        const def = change.def;
        if (!def) {
          issues.push({ level: "error", code: "add-missing-def", message: `changes[${i}]: missing def`, path: where });
          break;
        }
        if (unitsById.has(def.id) || added.has(def.id)) {
          issues.push({
            level: "error",
            code: "add-duplicate-id",
            message: `changes[${i}]: unit "${def.id}" already exists`,
            path: where,
          });
          break;
        }
        added.set(def.id, def);
        if (change.assign_to !== undefined) {
          assignment[def.id] = change.assign_to;
          if (!agentIds.has(change.assign_to)) {
            issues.push({
              level: "error",
              code: "assign-unknown-agent",
              message: `changes[${i}]: assign_to references unknown agent "${change.assign_to}"`,
              path: where,
            });
          }
        }
        break;
      }
      case "cancel": {
        const target = change.unit;
        if (!target || !unitsById.has(target)) {
          issues.push({
            level: "error",
            code: "cancel-unknown-unit",
            message: `changes[${i}]: cannot cancel unknown unit "${target}"`,
            path: where,
          });
          break;
        }
        explicitCancels.add(target);
        break;
      }
      case "retarget": {
        if (change.budget_target === undefined) {
          issues.push({
            level: "error",
            code: "retarget-missing-target",
            message: `changes[${i}]: missing budget_target`,
            path: where,
          });
          break;
        }
        retargetTo = change.budget_target; // last one wins
        break;
      }
      case "modify": {
        const target = change.unit;
        const existing = target ? (modified.get(target) ?? unitsById.get(target)) : undefined;
        if (!target || !existing) {
          issues.push({
            level: "error",
            code: "modify-unknown-unit",
            message: `changes[${i}]: cannot modify unknown unit "${target}"`,
            path: where,
          });
          break;
        }
        modified.set(target, { ...existing, ...change.patch, id: target });
        if (change.assign_to !== undefined) {
          assignment[target] = change.assign_to;
          if (!agentIds.has(change.assign_to)) {
            issues.push({
              level: "error",
              code: "assign-unknown-agent",
              message: `changes[${i}]: assign_to references unknown agent "${change.assign_to}"`,
              path: where,
            });
          }
        }
        break;
      }
    }
  }

  if (issues.some((i) => i.level === "error")) {
    return { impact: emptyImpact, issues };
  }

  // Cascade: units that (transitively) depend on cancelled units and still point at them.
  const effectiveUnits = new Map<string, WorkUnit>();
  for (const u of spec.work_units) {
    if (explicitCancels.has(u.id)) continue;
    effectiveUnits.set(u.id, modified.get(u.id) ?? u);
  }
  for (const [id, def] of added) effectiveUnits.set(id, def);

  const cancelledSet = new Set(explicitCancels);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, unit] of effectiveUnits) {
      if (cancelledSet.has(id)) continue;
      if ((unit.depends_on ?? []).some((dep) => cancelledSet.has(dep))) {
        cancelledSet.add(id);
        grew = true;
      }
    }
  }

  const cancel: CancelledUnit[] = [...cancelledSet].map((unit) => ({
    unit,
    sunk_budget: spentByUnit[unit] ?? 0,
    reason: explicitCancels.has(unit) ? "explicit" : "cascade",
  }));

  const nextUnits = spec.work_units
    .filter((u) => !cancelledSet.has(u.id))
    .map((u) => modified.get(u.id) ?? u)
    .concat([...added.values()]);

  for (const id of cancelledSet) delete assignment[id];

  const nextDoc: Spec = {
    ...spec,
    spec_version: spec.spec_version + 1,
    work_units: nextUnits,
    assignment,
    ...(retargetTo !== undefined
      ? { priorities: { ...spec.priorities, budget_target: retargetTo } }
      : {}),
  };

  const validation = validateSpec(structuredClone(nextDoc));
  const impact: AmendmentImpact = {
    continue: nextUnits
      .filter((u) => !added.has(u.id) && !modified.has(u.id))
      .map((u) => u.id),
    modified: [...modified.keys()].filter((id) => !cancelledSet.has(id)),
    cancel,
    new: [...added.keys()].filter((id) => !cancelledSet.has(id)),
    ...(retargetTo !== undefined ? { retarget: { budget_target: retargetTo } } : {}),
  };

  return {
    next: validation.spec,
    impact,
    issues: [...issues, ...validation.issues],
  };
}
