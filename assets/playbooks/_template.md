---
id: <kebab-case-id>
applies_to: [<free-text project descriptors the orchestrator matches against>]
version: 1
provenance: builtin | user | community | auto-draft
---

<!--
A playbook is PRIOR KNOWLEDGE, never a template. The orchestrator drops what
does not fit and adds what is missing. Auto-draft playbooks keep the
`auto-draft` provenance until a human reviews them or a second successful run
confirms them; the orchestrator weighs them cautiously until then.
-->

## Typical work layers
<!-- The unit decomposition that usually fits this project type, with typical
     dependency direction. Not a mandate — a starting point. -->

## Known couplings
<!-- Cross-cutting dependencies that pure inference tends to miss, e.g.
     "revenue model shapes the DB schema and auth from day one". These are the
     most valuable lines in the playbook. -->

## Default quality bars
<!-- Acceptance-criteria defaults for this type (coverage targets, contract
     tests, lint gates). Overridable per spec. -->

## Threat model notes
<!-- What the security gate should focus on for this type. -->

## Pitfalls
<!-- Failure modes observed in practice; each line should be actionable. -->
