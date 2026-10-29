/**
 * Spec → subagent translation (CONCEPT.md §15).
 *
 * Producer and verifier prompts are built from the same spec but are
 * deliberately different documents: the producer gets the work, the verifier
 * gets an adversarial mandate ("try to refute completion") and never sees
 * the producer's reasoning — independence is the point (§4.3).
 */

import type { AgentDef, Spec, WorkUnit } from "@clockwork/core";

function findUnit(spec: Spec, unitId: string): WorkUnit {
  const unit = spec.work_units.find((u) => u.id === unitId);
  if (!unit) throw new Error(`Unknown work unit: "${unitId}"`);
  return unit;
}

function findAgent(spec: Spec, agentId: string): AgentDef {
  const agent = spec.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Unknown agent: "${agentId}"`);
  return agent;
}

/** Contracts this unit's dependencies promised — its consumption interface. */
function upstreamContracts(spec: Spec, unit: WorkUnit): string[] {
  return (unit.depends_on ?? []).flatMap((dep) => {
    const upstream = spec.work_units.find((u) => u.id === dep);
    return (upstream?.contracts ?? []).map((c) => `${dep}: ${c}`);
  });
}

const list = (items: string[] | undefined): string =>
  items?.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)";

/** Producer prompt for the subagent assigned to a work unit. */
export function buildUnitPrompt(spec: Spec, unitId: string): string {
  const unit = findUnit(spec, unitId);
  const agent = findAgent(spec, spec.assignment[unitId] ?? "");

  return `# Work unit: ${unit.id}

## Project goal
${spec.meta.goal}

## Your role
${agent.purpose}

## Task
${unit.description}

## Ownership boundary (enforced)
You may create or modify files ONLY within:
${list(unit.owns)}
Writes outside these paths are blocked by a hook — do not attempt them. If you
believe you need a file outside your scope, STOP and report it instead.

## Contracts you must honor (interfaces your unit promises)
${list(unit.contracts)}

## Contracts you may rely on (promised by your dependencies)
${list(upstreamContracts(spec, unit))}

## Acceptance criteria (a separate verifier will check these adversarially)
${list(unit.acceptance)}

## Reporting
Your final message is a machine-consumed report, not prose for a human. Include:
- status: what you completed and what you could not
- files: every file you created or modified
- verification: how you checked each acceptance criterion yourself
- open issues: anything the integrator or verifier must know
Never claim an acceptance criterion passes without having run the check.`;
}

/** Adversarial verifier prompt for a completed work unit. */
export function buildVerifierPrompt(spec: Spec, unitId: string): string {
  const unit = findUnit(spec, unitId);

  return `# Verification of work unit: ${unit.id}

## Project goal
${spec.meta.goal}

## Mandate
You are an independent, adversarial verifier. The producer claims this unit is
complete. Your job is to TRY TO REFUTE that claim, not to confirm it. Assume
the work is broken until the evidence says otherwise. You did not write this
code; do not defend it.

## What the unit was supposed to deliver
${unit.description}

## Contracts the unit promised
${list(unit.contracts)}

## Acceptance criteria — check EVERY one by actually running it
${list(unit.acceptance)}

## Rules
- Run the checks yourself (tests, builds, commands). Reading the code is not verification.
- A criterion without runnable evidence is FAILED, not "probably fine".
- Do not fix anything — you verify, the producer reworks.

## Verdict (final message, machine-consumed)
- verdict: "accepted" or "rework"
- evidence: per criterion, the command/check you ran and its observed result
- findings: for "rework", concrete defects with reproduction steps`;
}

/**
 * Reusable agent definition file (markdown + frontmatter) for the private
 * library — what worked gets saved and pulled instead of regenerated (§5).
 */
export function buildAgentDefinition(spec: Spec, agentId: string): string {
  const agent = findAgent(spec, agentId);
  const units = Object.entries(spec.assignment)
    .filter(([, a]) => a === agentId)
    .map(([u]) => u);

  return `---
name: ${agent.id}
description: ${agent.purpose}
model_tier: ${agent.model_tier}
provenance: generated
---

${agent.purpose}

Originally forged for goal: "${spec.meta.goal}" (units: ${units.join(", ") || "none"}).

## Operating rules
- Respect the ownership boundary given in your unit prompt; out-of-scope writes are blocked.
- Your final message is a structured report (status, files, verification, open issues).
- Never claim unverified success.`;
}
