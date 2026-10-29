import { describe, expect, it } from "vitest";
import { applyAmendment, validateAmendment } from "../src/spec/amendment.js";
import type { Amendment, WorkUnit } from "../src/spec/types.js";
import { validSpec } from "./fixtures.js";

const NEW_UNIT: WorkUnit = {
  id: "wu-analytics",
  type: "code",
  description: "Click analytics endpoint",
  owns: ["src/analytics/**"],
  depends_on: ["wu-db"],
  acceptance: ["unit tests pass"],
  budget_est: "30k",
};

function amendment(changes: Amendment["changes"], base = 1): Amendment {
  return {
    base_version: base,
    initiated_by: "user",
    reason: "test amendment",
    changes,
  };
}

describe("validateAmendment", () => {
  it("accepts a well-formed amendment", () => {
    const result = validateAmendment(
      amendment([{ action: "add", def: NEW_UNIT, assign_to: "backend-builder" }]),
    );
    expect(result.issues).toEqual([]);
    expect(result.amendment).toBeDefined();
  });

  it("rejects add without def", () => {
    const result = validateAmendment(amendment([{ action: "add" }]));
    expect(result.amendment).toBeUndefined();
    expect(result.issues.map((i) => i.code)).toContain("add-missing-def");
  });

  it("rejects cancel/modify without a target unit", () => {
    const result = validateAmendment(amendment([{ action: "cancel" }]));
    expect(result.issues.map((i) => i.code)).toContain("missing-target-unit");
  });

  it("rejects modify with neither patch nor assign_to", () => {
    const result = validateAmendment(amendment([{ action: "modify", unit: "wu-api" }]));
    expect(result.issues.map((i) => i.code)).toContain("empty-modify");
  });

  it("rejects schema violations", () => {
    const result = validateAmendment({ base_version: 1, changes: [] });
    expect(result.amendment).toBeUndefined();
    expect(result.issues.map((i) => i.code)).toContain("schema");
  });
});

describe("applyAmendment", () => {
  it("rejects a base version mismatch", () => {
    const result = applyAmendment(validSpec(), amendment([{ action: "cancel", unit: "wu-docs" }], 3));
    expect(result.next).toBeUndefined();
    expect(result.issues.map((i) => i.code)).toContain("base-version-mismatch");
  });

  it("adds a unit with assignment and bumps the version", () => {
    const result = applyAmendment(
      validSpec(),
      amendment([{ action: "add", def: NEW_UNIT, assign_to: "backend-builder" }]),
    );
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(result.next).toBeDefined();
    expect(result.next!.spec_version).toBe(2);
    expect(result.next!.work_units.map((u) => u.id)).toContain("wu-analytics");
    expect(result.next!.assignment["wu-analytics"]).toBe("backend-builder");
    expect(result.impact.new).toEqual(["wu-analytics"]);
  });

  it("rejects adding a unit whose id already exists", () => {
    const dup = { ...NEW_UNIT, id: "wu-api" };
    const result = applyAmendment(validSpec(), amendment([{ action: "add", def: dup }]));
    expect(result.next).toBeUndefined();
    expect(result.issues.map((i) => i.code)).toContain("add-duplicate-id");
  });

  it("cancelling a unit cascades to its transitive dependents with sunk budgets", () => {
    const spent = { "wu-db": 12_000, "wu-api": 5_000 };
    const result = applyAmendment(validSpec(), amendment([{ action: "cancel", unit: "wu-db" }]), spent);

    expect(result.next).toBeDefined();
    const cancelled = Object.fromEntries(result.impact.cancel.map((c) => [c.unit, c]));
    expect(cancelled["wu-db"]).toMatchObject({ reason: "explicit", sunk_budget: 12_000 });
    expect(cancelled["wu-api"]).toMatchObject({ reason: "cascade", sunk_budget: 5_000 });
    expect(cancelled["wu-front"]).toMatchObject({ reason: "cascade", sunk_budget: 0 });
    // Independent unit survives
    expect(result.impact.continue).toEqual(["wu-docs"]);
    // Cancelled units are gone from the next spec, including their assignments
    expect(result.next!.work_units.map((u) => u.id)).toEqual(["wu-docs"]);
    expect(Object.keys(result.next!.assignment)).toEqual(["wu-docs"]);
  });

  it("re-pointing a dependent's dependencies rescues it from the cascade", () => {
    const result = applyAmendment(
      validSpec(),
      amendment([
        { action: "cancel", unit: "wu-api" },
        { action: "modify", unit: "wu-front", patch: { depends_on: ["wu-db"] } },
      ]),
    );
    expect(result.next).toBeDefined();
    const cancelledIds = result.impact.cancel.map((c) => c.unit);
    expect(cancelledIds).toEqual(["wu-api"]);
    expect(result.impact.modified).toContain("wu-front");
    expect(result.next!.work_units.find((u) => u.id === "wu-front")!.depends_on).toEqual(["wu-db"]);
  });

  it("modify patches fields and can reassign, id stays immutable", () => {
    const result = applyAmendment(
      validSpec(),
      amendment([
        {
          action: "modify",
          unit: "wu-docs",
          patch: { description: "README + LICENSE + CONTRIBUTING" },
          assign_to: "backend-builder",
        },
      ]),
    );
    expect(result.next).toBeDefined();
    const unit = result.next!.work_units.find((u) => u.id === "wu-docs")!;
    expect(unit.description).toBe("README + LICENSE + CONTRIBUTING");
    expect(result.next!.assignment["wu-docs"]).toBe("backend-builder");
  });

  it("rejects modify/cancel of unknown units and assignment to unknown agents", () => {
    const spec = validSpec();
    expect(
      applyAmendment(spec, amendment([{ action: "cancel", unit: "wu-ghost" }])).issues.map((i) => i.code),
    ).toContain("cancel-unknown-unit");
    expect(
      applyAmendment(spec, amendment([{ action: "modify", unit: "wu-ghost", patch: { description: "x" } }]))
        .issues.map((i) => i.code),
    ).toContain("modify-unknown-unit");
    expect(
      applyAmendment(spec, amendment([{ action: "add", def: NEW_UNIT, assign_to: "ghost" }])).issues.map(
        (i) => i.code,
      ),
    ).toContain("assign-unknown-agent");
  });

  it("retarget raises the budget target and surfaces it in the impact", () => {
    const result = applyAmendment(
      validSpec(),
      amendment([{ action: "retarget", budget_target: "800k" }]),
    );
    expect(result.next).toBeDefined();
    expect(result.next!.priorities.budget_target).toBe("800k");
    expect(result.next!.priorities.bias).toBe("thorough"); // untouched
    expect(result.impact.retarget).toEqual({ budget_target: "800k" });
    expect(result.impact.continue.length).toBeGreaterThan(0); // units unaffected
  });

  it("retarget without budget_target is rejected at validation", () => {
    const result = validateAmendment(amendment([{ action: "retarget" }]));
    expect(result.amendment).toBeUndefined();
    expect(result.issues.map((i) => i.code)).toContain("retarget-missing-target");
  });

  it("the produced next spec is itself valid", () => {
    const result = applyAmendment(
      validSpec(),
      amendment([
        { action: "add", def: NEW_UNIT, assign_to: "backend-builder" },
        { action: "cancel", unit: "wu-front" },
      ]),
    );
    expect(result.next).toBeDefined();
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
