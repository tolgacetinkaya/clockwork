import { describe, expect, it } from "vitest";
import { validateSpec } from "../src/spec/validate.js";
import { validateAmendment } from "../src/spec/amendment.js";
import { validSpec } from "./fixtures.js";

describe("watchdog spec policy", () => {
  it("keeps watchdog overrides optional and accepts bounded partial unit/integration policies", () => {
    expect(validateSpec(validSpec()).spec).toBeDefined();
    const spec = validSpec();
    spec.work_units[0]!.watchdog = { idle_ms: 10, expected_ms: 20, hard_ms: 3_600_000, delivery_ms: 30 };
    spec.verification = { watchdog: { hard_ms: 30, delivery_ms: 10 } };
    expect(validateSpec(spec).issues).toEqual([]);
    expect(validateSpec(spec).spec).toEqual(spec);
  });

  it.each([0, -1, 9, 3_600_001, Infinity, NaN, 10.1, "100", null])("rejects invalid millisecond override %s for each threshold", (value) => {
    for (const key of ["idle_ms", "expected_ms", "hard_ms", "delivery_ms"]) {
      const spec = validSpec();
      spec.work_units[0]!.watchdog = { [key]: value } as never;
      expect(validateSpec(spec).spec).toBeUndefined();
      spec.work_units[0]!.watchdog = {};
      spec.verification = { watchdog: { [key]: value } as never };
      expect(validateSpec(spec).spec).toBeUndefined();
    }
  });

  it.each([100, 101])("rejects expected_ms %s at or after hard_ms for unit and integration policy", (expected_ms) => {
    const spec = validSpec();
    spec.work_units[0]!.watchdog = { expected_ms, hard_ms: 100 };
    expect(validateSpec(spec).issues.some(issue => issue.code === "watchdog-deadline")).toBe(true);
    spec.work_units[0]!.watchdog = {};
    spec.verification = { watchdog: { expected_ms, hard_ms: 100 } };
    expect(validateSpec(spec).issues.some(issue => issue.code === "watchdog-deadline")).toBe(true);
  });

  it("rejects unknown watchdog fields and non-object policies", () => {
    for (const policy of [{ timeout: 100 }, [], null, 100]) {
      const spec = validSpec(); spec.work_units[0]!.watchdog = policy as never;
      expect(validateSpec(spec).spec).toBeUndefined();
    }
  });

  it("admits watchdog overrides in amendment add and modify shapes", () => {
    const spec = validSpec();
    const result = validateAmendment({ base_version: spec.spec_version, initiated_by: "user", reason: "Adjust deadlines", changes: [{ action: "modify", unit: spec.work_units[0]!.id, patch: { watchdog: { idle_ms: 10, hard_ms: 100 } } }] });
    expect(result.issues).toEqual([]);
    expect(validateAmendment({ base_version: spec.spec_version, initiated_by: "user", reason: "Add deadline", changes: [{ action: "add", def: { ...spec.work_units[0]!, id: "new-unit", watchdog: { delivery_ms: 10 } }, assign_to: spec.agents[0]!.id }] }).issues).toEqual([]);
    const invalid = validateAmendment({ base_version: spec.spec_version, initiated_by: "user", reason: "Adjust deadlines", changes: [{ action: "modify", unit: spec.work_units[0]!.id, patch: { watchdog: { hard_ms: 0 } } }] });
    expect(invalid.issues.length).toBeGreaterThan(0);
  });
});
