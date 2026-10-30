---
name: clockwork
description: Plan and supervise approved Clockwork work units using the local Codex adapter, durable ledger and independent verification.
---

# Clockwork for Codex

Use this workflow only when the user asks to use Clockwork. Resolve the Clockwork
checkout and the target repository first. Read `docs/codex-local.md` in that
checkout, including its sandbox and recovery limits. Never assume this skill
installs hooks or starts a background scheduler.

## Start or resume

Use the source CLI from the target repository. Define `cw` as shorthand for
`node <checkout>/node_modules/tsx/dist/cli.mjs <checkout>/packages/cli/src/bin.ts`.
Run `cw state`, `cw status`, and `cw doctor`. With no initialized state run
`cw init`. An unfinished run resumes from ledger/spec/receipts; do not redo accepted
units, discard worktrees, reset failed units, or repeat applied queue commands.
The `.teamsmith` directory is private orchestration state: mutate it only via CLI.

## Plan before executing

1. Inspect existing source, conventions and the baseline checks. Record failures
   already present before modification. Clarify requirements in a single batch.
2. Decompose the job into minimally scoped work units with disjoint `owns`, explicit
   dependencies/contracts, runnable acceptance criteria and token estimates.
3. Read the current core Spec schema/types and a committed example before writing
   YAML. Use `cw spec save <draft.yaml>` to validate and version the draft.
4. Present the goal, units, roles, budget and risks to the user. Record
   `spec.approved --actor user` only after actual human approval, with the exact
   spec version, positive budget_target and full units/dependency snapshot.
5. Record per-unit `budget.estimated` events and `run.phase_entered` for execute.
   Record `run.started` first when creating a run. The closed event dictionary and
   CLI are authoritative; do not fabricate event types.

## Execute and verify

- Start from committed target-project code, with accepted upstream work integrated.
  Prepare one linked Git worktree per unit. Keep control state outside the worker.
- Use `cw codex produce <unit> --workspace <worktree>` and then
  `cw codex verify <unit> --workspace <same-worktree>`. On Windows select the
  already-configured native sandbox with `--windows-sandbox` for both commands.
- Choose `--model` only from the user's requested model or confirmed availability;
  never interpret cheap/standard/strong tiers as automatic model mappings.
- The common runner records task starts, agent events, usage and verification
  outcomes. Do not record those again yourself. A producer's completed report is
  not acceptance. Verification is a fresh read-only session with its own evidence.
- Stop on blocked/failed results, unknown usage, ownership violations or corruption;
  show the evidence and obtain the missing input. Never weaken sandbox/rules, pass
  full access, import broad user configuration, or automatically retry a failed
  turn. For ordinary rework, review findings and rerun produce then verify on the
  unchanged receipt/worktree. Preserve all files needed for review.
- A verifier that cannot run a write-requiring build must report it as unverified.
  Do not claim a passing source review proves runtime behavior.
- The first runner permits only one active worker per project. Do not invent
  parallel scheduling or nest subagents inside the bounded Codex worker.

## User input and completion

At unit boundaries, use `cw commands pull` to read panel requests. Persist a
command's effect as a valid ledger event with `command_seq`, then acknowledge only
its applied prefix with `cw commands ack <seq>`. Reconcile duplicates before
applying them. A note may be acknowledged after reading; requests are never proof
that their effect happened. Respect controls; resume from a separate operator
terminal if paused.

After independent acceptance, review/integrate delivered changes using the user's
Git workflow. Never merge, publish or delete worktrees merely to finish this skill.
The panel can be opened from the target root with `cw ui --port <free-port>`.
Before completion, check all units, unanswered questions and blocking checkpoints.
Record run completion only when the ledger accepts it; write a retrospective with
`--platform codex-cli`. Report implemented behavior, actual checks, costs and
remaining uncertainty clearly.
