import { describe, expect, it } from "vitest";
import type { Spec } from "@clockwork/core";
import {
  buildAgentDefinition,
  buildUnitPrompt,
  buildVerifierPrompt,
} from "../src/spawn/translate.js";

function spec(): Spec {
  return {
    spec_version: 1,
    meta: { goal: "URL shortener web application" },
    priorities: { bias: "thorough" },
    work_units: [
      {
        id: "wu-db",
        type: "code",
        description: "Data layer",
        owns: ["src/db/**"],
        contracts: ["createLink(url) -> {slug}", "resolve(slug) -> url | null"],
        acceptance: ["unit tests pass"],
      },
      {
        id: "wu-api",
        type: "code",
        description: "REST API endpoints",
        owns: ["src/api/**"],
        contracts: ["POST /shorten -> {slug}"],
        depends_on: ["wu-db"],
        acceptance: ["contract tests pass", "returns 302 on GET /:slug"],
      },
    ],
    agents: [
      { id: "backend-builder", purpose: "Implements data layer and API", model_tier: "standard" },
    ],
    assignment: { "wu-db": "backend-builder", "wu-api": "backend-builder" },
  };
}

describe("buildUnitPrompt", () => {
  it("carries goal, role, boundary, contracts, and acceptance", () => {
    const prompt = buildUnitPrompt(spec(), "wu-api");
    expect(prompt).toContain("URL shortener web application");
    expect(prompt).toContain("Implements data layer and API");
    expect(prompt).toContain("REST API endpoints");
    expect(prompt).toContain("- src/api/**");
    expect(prompt).toContain("blocked by a hook");
    // Own promises and upstream promises are both present, labeled by source.
    expect(prompt).toContain("POST /shorten -> {slug}");
    expect(prompt).toContain("wu-db: createLink(url) -> {slug}");
    expect(prompt).toContain("- contract tests pass");
    expect(prompt).toContain("Never claim an acceptance criterion passes");
  });

  it("throws for unknown units", () => {
    expect(() => buildUnitPrompt(spec(), "wu-ghost")).toThrow(/Unknown work unit/);
  });
});

describe("buildVerifierPrompt", () => {
  it("is adversarial and demands runnable evidence per criterion", () => {
    const prompt = buildVerifierPrompt(spec(), "wu-api");
    expect(prompt).toContain("TRY TO REFUTE");
    expect(prompt).toContain("Do not fix anything");
    expect(prompt).toContain("- returns 302 on GET /:slug");
    expect(prompt).toContain('"accepted" or "rework"');
    expect(prompt).toContain("Reading the code is not verification");
  });

  it("does not leak the producer's role description", () => {
    // Independence: the verifier judges the work, not the producer's intent.
    expect(buildVerifierPrompt(spec(), "wu-api")).not.toContain("Implements data layer and API");
  });
});

describe("buildAgentDefinition", () => {
  it("produces a reusable definition with provenance frontmatter", () => {
    const def = buildAgentDefinition(spec(), "backend-builder");
    expect(def).toContain("name: backend-builder");
    expect(def).toContain("model_tier: standard");
    expect(def).toContain("provenance: generated");
    expect(def).toContain("wu-db, wu-api");
    expect(def).toContain("Never claim unverified success");
  });
});
