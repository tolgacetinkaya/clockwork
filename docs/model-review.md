# Separate production and review models

Clockwork can choose different models for production, independent unit review,
and the final combined-result review. This first implementation uses the existing
**local Codex CLI adapter**. It does not add Claude/Gemini/API execution adapters,
automatic price routing, or a multi-model voting judge.

## Configure the approved plan

The Mission control form has optional production and independent review model
fields, plus an optional final-review override. Save the plan, review the choices,
then approve it. Editing a selection requires saving and approving the new draft.
Existing advanced plan fields are preserved when editing these selections.

The equivalent YAML fields are:

```yaml
execution:
  producer_model: your-production-model-id
  verifier_model: your-review-model-id
  # Optional: otherwise the resolved verifier model handles the final gate.
  integration_verifier_model: your-final-review-model-id
```

These are placeholders. Use model IDs available to your installed Codex CLI and
account. Clockwork validates the shape of IDs, not account availability. It does
not silently substitute another model when the selected model fails.

## CLI defaults

From the target project, using the source CLI invocation described in
[local Codex execution](codex-local.md):

```sh
cw codex team --concurrency 2 --producer-model your-production-model-id --verifier-model your-review-model-id
cw ui --enable-execution --port 47833 --producer-model your-production-model-id --verifier-model your-review-model-id
```

The optional `--integration-verifier-model ID` chooses the final reviewer.
Legacy `--model ID` remains a shared fallback. Resolution for each role is:

1. The explicit model in the approved plan.
2. The corresponding role-specific CLI/runner default.
3. For production and unit review, legacy `--model`; for final review, the
   resolved unit reviewer.
4. If no model is selected, omit `--model` and let the isolated adapter invocation
   use its default.

A blank panel field means host/CLI default; it does not erase a CLI default.
Model-tier hints such as `cheap` or `strong` are not automatic model selection.
Model IDs are bounded to 200 characters and cannot contain whitespace/control
characters or start with a dash.

For separate `codex produce` and `codex verify` commands, configure both roles in
the approved YAML or pass the **same complete set of role flags to both commands**.
The production receipt binds the expected model selections, including review,
so changing flags between these steps is rejected before starting a verifier.

## What independent review means

Each producer and reviewer is a fresh adapter invocation. The reviewer receives
the task, acceptance criteria and produced worktree, not the producer's report or
conversation. The Codex adapter uses a read-only sandbox for review. Review does
not edit or silently repair the producer's work.

A unit passes only after command-backed evidence, existing integrity checks,
durable report acknowledgement and the normal acceptance gate. A different
model's positive opinion alone cannot accept a task. Rework/failure stops the
pipeline; automatic retries and model fallbacks are not introduced here.
The final reviewer runs against the combined integration worktree when global
acceptance gates are configured. Missing global gates remain `not_configured`,
not proof that the combined result passed.

The same model can serve both roles in separate sessions. Different models can
reduce shared blind spots, but are not a guarantee of independence or correctness.
Writable build/test caches remain subject to the existing read-only review limit.

## Audit and recovery

The ledger records each invocation's provider, role and **requested model** when
explicitly selected. It also records the resolved requested selections for all
roles. The team view displays the recorded identity. An omitted model is not
invented from a tier hint. These records do not prove an alias's provider-resolved
version or that an account default never changes.

Production and team receipts preserve the selections. Recovery inspection binds
them into its review token; changing selections blocks resume before changing
retry/control state. Restore the original settings and inspect again, or reconcile
manually. Older receipts without recorded model selection are conservatively
blocked for execution/recovery; historical ledger viewing remains supported.

## Validation scope

Regression tests cover schema and YAML round trips, CLI forwarding, plan review
invalidation, separate producer/reviewer/final-review routing, rejection gates,
recovery binding and real local child-process argument delivery. Git-worktree
integration tests exercise local isolated fixtures. They do not certify live
provider availability, model quality, pricing, or paid-account quota behavior.
