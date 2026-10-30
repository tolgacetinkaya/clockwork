import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionModels } from "../src/index.js";
import { applyAmendment } from "../src/spec/amendment.js";
import { loadSpecFile, writeSpecFile } from "../src/spec/files.js";
import { validateSpec } from "../src/spec/validate.js";
import { validSpec } from "./fixtures.js";

const roles = ["producer_model", "verifier_model", "integration_verifier_model"] as const;
const models: ExecutionModels = {
  producer_model: "openai/gpt-6.1-sol",
  verifier_model: "provider:independent-verifier.v2",
  integration_verifier_model: "org/integration-model@latest",
};

describe("spec execution models", () => {
  it("keeps legacy specs and an empty execution selection valid without adding defaults", () => {
    const legacy = validSpec();
    expect(validateSpec(legacy).spec).toEqual(legacy);
    expect(validateSpec(legacy).spec?.execution).toBeUndefined();
    expect(validateSpec({ ...legacy, execution: {} }).spec?.execution).toEqual({});
  });

  it.each(roles)("accepts an independent optional selection for %s", role => {
    const spec = { ...validSpec(), execution: { [role]: models[role] } };
    expect(validateSpec(spec)).toEqual({ spec, issues: [] });
  });

  it("preserves every role and existing spec field without mutating input", () => {
    const spec = { ...validSpec(), execution: { ...models } };
    const before = structuredClone(spec);
    expect(validateSpec(spec)).toEqual({ spec: before, issues: [] });
    expect(spec).toEqual(before);
  });

  it.each(roles)("permits open-ended provider identifiers and the 200-character boundary for %s", role => {
    for (const model of ["gpt-6.1-sol", "provider/custom:model-v2.1", "a".repeat(200)]) {
      expect(validateSpec({ ...validSpec(), execution: { [role]: model } }).issues).toEqual([]);
    }
  });

  it.each(roles)("rejects malformed model values for %s", role => {
    const invalid: unknown[] = [
      "", " ", "model ", " model", "two models", "model\tvalue", "model\nvalue", "model\n",
      "model\r", "model\u0000", "model\u001f", "model\u007f", "model\u0085",
      "model\u00a0value", "model\u2028", "-model", "--model", "a".repeat(201),
      null, 42, false, [], {},
    ];
    for (const model of invalid) {
      const result = validateSpec({ ...validSpec(), execution: { [role]: model } });
      expect(result.spec, JSON.stringify(model)).toBeUndefined();
      expect(result.issues, JSON.stringify(model)).toContainEqual(expect.objectContaining({
        level: "error", code: "schema", path: "execution." + role,
      }));
    }
  });

  it.each([null, [], "gpt-6.1-sol", 42, { producer_model: "valid", unexpected: "model" }])(
    "rejects an invalid execution object or unknown field: %j", execution => {
      const result = validateSpec({ ...validSpec(), execution });
      expect(result.spec).toBeUndefined();
      expect(result.issues).toContainEqual(expect.objectContaining({ level: "error", code: "schema", path: "execution" }));
    },
  );

  it("still runs semantic validation with valid role model selections", () => {
    const spec = { ...validSpec(), execution: models };
    spec.assignment["wu-db"] = "missing-agent";
    const result = validateSpec(spec);
    expect(result.spec).toBeUndefined();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "assignment-unknown-agent" }));
  });

  it("preserves role selections when applying an unrelated amendment", () => {
    const result = applyAmendment({ ...validSpec(), execution: models }, {
      base_version: 1,
      initiated_by: "user",
      reason: "adjust budget only",
      changes: [{ action: "retarget", budget_target: "600k" }],
    });
    expect(result.issues).toEqual([]);
    expect(result.next?.execution).toEqual(models);
    expect(result.next?.spec_version).toBe(2);
  });

  it("preserves all selections through an immutable YAML spec round-trip", async () => {
    const tempRoot = await realpath(tmpdir());
    const dir = await mkdtemp(join(tempRoot, "clockwork-execution-"));
    try {
      const spec = { ...validSpec(), execution: models };
      const file = await writeSpecFile(dir, spec);
      expect(await loadSpecFile(file)).toEqual(expect.objectContaining({ spec, issues: [] }));
    } finally {
      const resolved = await realpath(dir);
      const child = relative(tempRoot, resolved);
      if (!child || child.startsWith("..") || child.includes(":")) throw new Error("Unsafe temporary test cleanup path");
      await rm(resolved, { recursive: true, force: true });
    }
  });
});
