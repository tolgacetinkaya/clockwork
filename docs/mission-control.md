# Mission control and the crew

Mission control is the local UI for a reviewed Codex team run. It does not infer
an engineering plan from a goal: you enter and edit the task breakdown, ownership,
acceptance criteria, dependencies, and estimates before approving it.

## Connect a target repository

Install/build Clockwork and authenticate the local Codex CLI as described in
[codex-local.md](codex-local.md). Use a target Git repository with a committed HEAD
and clean source files. The server is bound to that repository; the browser cannot
select another path, executable, or provider configuration.

From the target repository, invoke the source CLI (replace both checkout paths):

```sh
node /absolute/path/to/clockwork/node_modules/tsx/dist/cli.mjs /absolute/path/to/clockwork/packages/cli/src/bin.ts ui --port 47833 --enable-execution
```

On Windows, append `--windows-sandbox elevated` only if that is the native sandbox
you already configured. The same confirmed `--model`, `--codex-bin` and
`--timeout-ms` options as the unit runner are available. The host CLI owns these
settings; the UI cannot broaden them. No workers start merely by opening the panel.

The normal `ui` command without `--enable-execution` is an observation/control
panel. The Docker recorded demo also cannot launch workers, even if an execution
callback is supplied. Execution-enabled panels must bind to loopback.

## Define, review, approve, start

1. Open **Mission control** and describe the goal.
2. Add tasks with unique IDs, delivery descriptions, owned path globs, exact
   acceptance criteria, per-session estimated tokens and upstream task IDs.
3. Set the total token target and concurrency (1-8). Each active task reserves
   twice its estimate for producer and verifier. Leave additional budget for the
   final combined verification; estimates are not provider spending caps.
4. Add whole-project acceptance checks. These are evaluated by a fresh read-only
   verifier after all accepted deliveries have been integrated. Include precise
   commands and expected results where useful. Checks requiring writes/build
   caches cannot pass by assumption: they must be reported as unverified.
5. Save the plan, inspect it, check the review confirmation, approve that revision,
   and explicitly select **Start approved mission**. Saving or approving does not
   invoke the model. Starting may consume the configured Codex account's quota.

Plan edits invalidate approval. The server also checks the recorded project state
and Git HEAD against the approval before starting. Existing unrelated runs are
never overwritten. Independent units run in separate worktrees; accepted upstream
files are integrated before dependent work starts. The original checkout stays
unchanged, and the integration branch is not automatically merged or published.

## Follow the crew

The Team view groups specialists into production, verification and standby stages.
Task links explain who owns the current mission; details show acceptance criteria,
recorded activity and scope. Status comes from recorded events, not process health.

Contribution badges distinguish accepted delivery from independent verification.
They count unique accepted tasks only when both sides of the evidence chain are
present in the most recent event window. They are not lifetime scores, token-based
rewards, or proof that the combined result passed. Missing history earns no badge.
The separate combined-verification result shows checks, observed evidence and any
findings. An accepted task and a fully checked integration are different milestones.

## Review a stopped mission

Use **Inspect recovery state** to see preserved worktrees, accepted tasks, remaining
work, combined-check status and blockers. Inspect the actual preserved files and
evidence separately before confirming **Resume reviewed mission**. The opaque
review token binds the inspected ledger, plan, controls and Git fingerprints; a
change requires another inspection.

Controlled recovery retains integrated accepted tasks and archives old attempt
receipts. Failed/rework tasks receive an explicit user retry event and new worker
worktrees; a failed final gate reruns the final verifier without rerunning completed
tasks. Only this team's recovery checkpoint and reviewed pause/stop controls are
cleared. A newer stop request is respected.

Recovery refuses unknown usage, unreconciled workers, live/stale execution locks,
modified integration/source commits, conflicts, invalid receipts, unrelated
blocking checkpoints, and exhausted budgets. Resolve those through an explicit
operator review; the UI does not delete locks, discard work, invent usage, or
silently resolve Git conflicts. Older receipts may require manual reconciliation.

An interrupted OS child may leave descendants running. Establish that those have
stopped before manual lock or usage reconciliation. See the runner's
[delivery boundaries](codex-local.md#delivery-boundaries-and-recovery).
