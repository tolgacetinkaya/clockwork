import { describe, expect, it } from "vitest";
import { validateSpec } from "../src/spec/validate.js";
import { validSpec } from "./fixtures.js";

function errorCodes(doc: unknown): string[] {
  return validateSpec(doc)
    .issues.filter((i) => i.level === "error")
    .map((i) => i.code);
}

function warningCodes(doc: unknown): string[] {
  return validateSpec(doc)
    .issues.filter((i) => i.level === "warning")
    .map((i) => i.code);
}

describe("validateSpec — schema", () => {
  it("accepts a valid spec with no issues", () => {
    const result = validateSpec(validSpec());
    expect(result.issues).toEqual([]);
    expect(result.spec).toBeDefined();
  });

  it("rejects non-object input", () => {
    expect(errorCodes(null)).toContain("schema");
    expect(errorCodes("spec")).toContain("schema");
  });

  it("rejects a spec without a goal", () => {
    const spec = validSpec();
    // @ts-expect-error deliberately breaking the shape
    delete spec.meta.goal;
    expect(errorCodes(spec)).toContain("schema");
  });

  it("rejects an invalid bias value", () => {
    const spec = validSpec();
    // @ts-expect-error deliberately breaking the shape
    spec.priorities.bias = "fastest";
    expect(errorCodes(spec)).toContain("schema");
  });

  it("rejects unit ids that do not match the id pattern", () => {
    const spec = validSpec();
    spec.work_units[0]!.id = "WU_DB!";
    expect(errorCodes(spec)).toContain("schema");
  });

  it("rejects an empty work_units list", () => {
    const spec = validSpec();
    spec.work_units = [];
    expect(errorCodes(spec)).toContain("schema");
  });

  it("rejects unknown top-level properties", () => {
    const spec = { ...validSpec(), pipeline: [] };
    expect(errorCodes(spec)).toContain("schema");
  });

  it("rejects a malformed budget string via the schema pattern", () => {
    const spec = validSpec();
    spec.work_units[0]!.budget_est = "40x";
    expect(errorCodes(spec)).toContain("schema");
  });
});

describe("validateSpec — semantics", () => {
  it("flags duplicate work unit ids", () => {
    const spec = validSpec();
    spec.work_units[1]!.id = "wu-db";
    expect(errorCodes(spec)).toContain("dup-unit-id");
  });

  it("flags duplicate agent ids", () => {
    const spec = validSpec();
    spec.agents[1]!.id = "backend-builder";
    expect(errorCodes(spec)).toContain("dup-agent-id");
  });

  it("flags a dependency on an unknown unit", () => {
    const spec = validSpec();
    spec.work_units[1]!.depends_on = ["wu-ghost"];
    expect(errorCodes(spec)).toContain("unknown-dependency");
  });

  it("flags self-dependency", () => {
    const spec = validSpec();
    spec.work_units[0]!.depends_on = ["wu-db"];
    const codes = errorCodes(spec);
    expect(codes).toContain("self-dependency");
  });

  it("flags a dependency cycle and names its members", () => {
    const spec = validSpec();
    spec.work_units[0]!.depends_on = ["wu-front"]; // db -> front -> api -> db
    const result = validateSpec(spec);
    const cycle = result.issues.find((i) => i.code === "dep-cycle");
    expect(cycle).toBeDefined();
    expect(cycle!.message).toMatch(/wu-db/);
    expect(cycle!.message).toMatch(/wu-front/);
  });

  it("flags an unassigned work unit", () => {
    const spec = validSpec();
    delete spec.assignment["wu-docs"];
    expect(errorCodes(spec)).toContain("unassigned-unit");
  });

  it("flags assignments to unknown agents and of unknown units", () => {
    const spec = validSpec();
    spec.assignment["wu-db"] = "ghost-agent";
    spec.assignment["wu-ghost"] = "docs-writer";
    const codes = errorCodes(spec);
    expect(codes).toContain("assignment-unknown-agent");
    expect(codes).toContain("assignment-unknown-unit");
  });

  it("warns on overlapping ownership between units", () => {
    const spec = validSpec();
    spec.work_units[2]!.owns = ["src/api/handlers/**"]; // inside wu-api's src/api/**
    expect(warningCodes(spec)).toContain("owns-overlap");
    // overlap is a warning, not an error: spec is still returned
    expect(validateSpec(spec).spec).toBeDefined();
  });

  it("does not warn when the same unit owns nested paths", () => {
    const spec = validSpec();
    spec.work_units[0]!.owns = ["src/db/**", "src/db/migrations/**"];
    expect(warningCodes(spec)).not.toContain("owns-overlap");
  });

  it("warns when unit estimates exceed the budget target", () => {
    const spec = validSpec();
    spec.priorities.budget_target = "100k"; // estimates sum to 190k
    expect(warningCodes(spec)).toContain("budget-overcommit");
  });

  it("does not warn when estimates fit the target", () => {
    const spec = validSpec();
    expect(warningCodes(spec)).not.toContain("budget-overcommit");
  });
});
