import type { Spec } from "../src/spec/types.js";

/** A valid sample spec, GP-1-like. Tests clone and break it. */
export function validSpec(): Spec {
  return {
    spec_version: 1,
    meta: {
      goal: "URL shortener web application",
      assumptions: ["OS: Windows 11", "License: MIT (default)"],
      open_questions: [],
    },
    priorities: {
      budget_target: "500k",
      bias: "thorough",
    },
    decision_gates: ["architecture", "stack"],
    work_units: [
      {
        id: "wu-db",
        type: "code",
        description: "Data layer: schema + access module",
        owns: ["src/db/**"],
        acceptance: ["unit tests pass", "migration runs clean"],
        budget_est: "40k",
      },
      {
        id: "wu-api",
        type: "code",
        description: "REST API: shorten + redirect endpoints",
        owns: ["src/api/**"],
        contracts: ["POST /shorten -> {slug}", "GET /:slug -> 302"],
        depends_on: ["wu-db"],
        acceptance: ["contract tests pass"],
        budget_est: "80k",
      },
      {
        id: "wu-front",
        type: "code",
        description: "Minimal frontend",
        owns: ["src/web/**"],
        depends_on: ["wu-api"],
        acceptance: ["e2e smoke passes"],
        budget_est: "60k",
      },
      {
        id: "wu-docs",
        type: "content",
        description: "README + LICENSE",
        owns: ["README.md", "LICENSE"],
        acceptance: ["setup steps verified"],
        budget_est: "10k",
      },
    ],
    agents: [
      {
        id: "backend-builder",
        purpose: "Data layer and API implementation",
        model_tier: "standard",
      },
      {
        id: "frontend-builder",
        purpose: "Frontend implementation",
        model_tier: "standard",
      },
      {
        id: "docs-writer",
        purpose: "Documentation",
        model_tier: "cheap",
      },
    ],
    assignment: {
      "wu-db": "backend-builder",
      "wu-api": "backend-builder",
      "wu-front": "frontend-builder",
      "wu-docs": "docs-writer",
    },
    verification: {
      global_gates: ["integration", "security"],
    },
    checkpoints: {
      gates: [{ trigger: "external_service_connect", action: "pause_and_ask" }],
      milestones: [
        { at: "backend contracts ready", mode: "soft" },
        { at: "integration complete", mode: "soft" },
      ],
    },
  };
}
