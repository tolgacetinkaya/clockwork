/**
 * JSON Schema definitions for the team spec (draft-07).
 * YAML is for humans; this schema is the single source of validation truth.
 */

const BUDGET_VALUE = {
  anyOf: [
    { type: "number", exclusiveMinimum: 0 },
    { type: "string", pattern: "^\\d+(\\.\\d+)?\\s*[kKmM]?$" },
  ],
} as const;

const ID_PATTERN = "^[a-z0-9][a-z0-9-]*$";

/** Provider identifiers are open-ended; reject unsafe command-like values. */
export const modelIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  // The final negative lookahead requires the absolute end (unlike JS $).
  pattern: "^(?!-)[^\\s\\u0000-\\u001f\\u007f-\\u009f]+(?![\\s\\S])",
} as const;

export const executionModelsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    producer_model: modelIdSchema,
    verifier_model: modelIdSchema,
    integration_verifier_model: modelIdSchema,
  },
} as const;

export const watchdogSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    idle_ms: { type: "integer", minimum: 10, maximum: 3_600_000 },
    expected_ms: { type: "integer", minimum: 10, maximum: 3_600_000 },
    hard_ms: { type: "integer", minimum: 10, maximum: 3_600_000 },
    delivery_ms: { type: "integer", minimum: 10, maximum: 3_600_000 },
  },
} as const;

export const workUnitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "description", "owns", "acceptance"],
  properties: {
    id: { type: "string", pattern: ID_PATTERN },
    type: { enum: ["code", "infra", "content", "research", "ops"] },
    description: { type: "string", minLength: 1 },
    owns: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    contracts: { type: "array", items: { type: "string" } },
    depends_on: { type: "array", items: { type: "string" } },
    acceptance: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    allowed_test_changes: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    budget_est: BUDGET_VALUE,
    watchdog: watchdogSchema,
  },
} as const;

export const agentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "purpose", "model_tier"],
  properties: {
    id: { type: "string", pattern: ID_PATTERN },
    purpose: { type: "string", minLength: 1 },
    model_tier: { enum: ["standard", "cheap", "strong"] },
    capabilities: {
      type: "object",
      additionalProperties: false,
      properties: {
        skills: { type: "array", items: { type: "string" } },
        tools: { type: "array", items: { type: "string" } },
      },
    },
    permissions: { type: "array", items: { type: "string" } },
  },
} as const;

export const specSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://teamsmith.dev/schemas/spec/v1",
  type: "object",
  additionalProperties: false,
  required: ["spec_version", "meta", "priorities", "work_units", "agents", "assignment"],
  properties: {
    spec_version: { type: "integer", minimum: 1 },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["goal"],
      properties: {
        goal: { type: "string", minLength: 1 },
        assumptions: { type: "array", items: { type: "string" } },
        open_questions: { type: "array", items: { type: "string" } },
      },
    },
    priorities: {
      type: "object",
      additionalProperties: false,
      required: ["bias"],
      properties: {
        budget_target: BUDGET_VALUE,
        bias: { enum: ["thorough", "fast", "cheap"] },
      },
    },
    execution: executionModelsSchema,
    decision_gates: { type: "array", items: { type: "string" } },
    work_units: { type: "array", minItems: 1, items: workUnitSchema },
    agents: { type: "array", minItems: 1, items: agentSchema },
    assignment: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    verification: {
      type: "object",
      additionalProperties: false,
      properties: {
        watchdog: watchdogSchema,
        per_unit: { type: "object" },
        global_gates: { type: "array", items: { type: "string" } },
      },
    },
    checkpoints: {
      type: "object",
      additionalProperties: false,
      properties: {
        gates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["trigger", "action"],
            properties: {
              trigger: { type: "string", minLength: 1 },
              action: { enum: ["pause_and_ask"] },
            },
          },
        },
        milestones: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["at", "mode"],
            properties: {
              at: { type: "string", minLength: 1 },
              mode: { enum: ["soft", "hard"] },
            },
          },
        },
      },
    },
    retrospective: {
      type: "object",
      additionalProperties: false,
      properties: {
        record: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export const amendmentSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://teamsmith.dev/schemas/amendment/v1",
  type: "object",
  additionalProperties: false,
  required: ["base_version", "initiated_by", "reason", "changes"],
  properties: {
    base_version: { type: "integer", minimum: 1 },
    initiated_by: { enum: ["user", "system"] },
    reason: { type: "string", minLength: 1 },
    changes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
          action: { enum: ["add", "cancel", "modify", "retarget"] },
          unit: { type: "string" },
          budget_target: BUDGET_VALUE,
          def: workUnitSchema,
          patch: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: workUnitSchema.properties.type,
              description: workUnitSchema.properties.description,
              owns: workUnitSchema.properties.owns,
              contracts: workUnitSchema.properties.contracts,
              depends_on: workUnitSchema.properties.depends_on,
              acceptance: workUnitSchema.properties.acceptance,
              allowed_test_changes: workUnitSchema.properties.allowed_test_changes,
              budget_est: BUDGET_VALUE,
              watchdog: watchdogSchema,
            },
          },
          assign_to: { type: "string" },
        },
      },
    },
  },
} as const;
