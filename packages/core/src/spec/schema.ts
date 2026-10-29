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
    budget_est: BUDGET_VALUE,
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
              budget_est: BUDGET_VALUE,
            },
          },
          assign_to: { type: "string" },
        },
      },
    },
  },
} as const;
