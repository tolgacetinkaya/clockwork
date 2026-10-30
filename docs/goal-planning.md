# Goal-driven planning and teams

Clockwork can turn a concrete goal into an editable task plan and a team chosen
for that work. A goal may be a bug fix, investigation, code review, documentation,
infrastructure change, or a new product. Planning does not assume every goal is
an MVP and does not start implementation.

## From the panel

Start an execution-enabled panel from the target project's clean, committed Git
repository, as described in [getting started](getting-started.md).

1. In Mission control, enter the goal, constraints, proposed task token budget,
   and any production/review model choices.
2. Select **Create task plan from goal**. This explicitly invokes the host's
   planning model and consumes its quota. Planning usage is separate from the
   proposed task budget.
3. Wait for the generated summary. Select **Use generated plan** to replace the
   current form with the candidate. Incoming updates do not silently overwrite
   edits. Cancellation asks the current planner to stop.
4. Review tasks, scope ownership, dependencies, agent purposes, assumptions,
   acceptance checks and estimates. Resolve critical open questions by updating
   the plan and recording the answers in its constraints or assumptions.
5. Save, approve that revision, then explicitly start the mission. These remain
   separate actions. Saving or adopting a draft never starts production agents.

The planner proposes 1–20 work units and derives agent definitions from their
needs. Roles can be reused when appropriate. There is no fixed developer/tester
roster. The existing scheduler starts fresh production/review sessions only as
work becomes ready; independent units can overlap and dependent work waits for
accepted upstream integration. It does not create an idle pool of all agents at
startup or autonomously change an approved plan during execution.

Manual planning remains available. The recorded Docker demo cannot invoke a
planner or launch agents.

## Host and CLI options

Use the source CLI invocation from [local Codex execution](codex-local.md); the
following examples use `cw` as its shorthand:

```sh
cw ui --enable-execution --port 47833 --planner-model your-planning-model-id
cw plan --goal "Investigate the API timeout and propose the necessary fix" --constraints "Preserve the public API; do not add services" --budget 100000 --planner-model your-planning-model-id
```

The CLI command prints a JSON result containing `summary`, `spec`, planning
`usage`, requested provider/model and source `head`. It does not automatically
save an approved execution specification or start a team. Use the panel workflow,
or explicitly review and save the returned `spec` through the existing spec/CLI
approval workflow.

Planning uses `--planner-model`, then legacy `--model`, or the isolated Codex
invocation's default. Production/review selections use their existing separate
options; selected host defaults become visible in the generated proposal.
Model availability is determined by the local CLI/account, not a built-in model
catalog. Existing executable, timeout and configured Windows sandbox options
apply. Automatic model/price routing is not part of this package.

## Execution boundaries

Planning uses a fresh read-only Codex session in a disposable worktree of committed
HEAD. Structured output is schema-validated and then checked against the normal
specification rules. Cycles, unsafe concurrent ownership, conflicting roles,
invalid estimates, extra permissions, and model-selected host settings are rejected.
The user's goal, constraints, budget and model selections remain host-owned.
Constraints and approved assumptions reach producers, unit reviewers and the
final reviewer.

The planner cannot grant skills, tools, permissions, test-change exceptions or
approval. Task estimates must fit twice their sum into the proposed execution
budget for producer/reviewer reservations. Leave additional headroom for final
verification and rework: estimates are not provider spending caps, and no separate
final-review reservation is enforced. Unknown planning usage is never recorded
as zero.

The execution lease excludes simultaneous planning and task execution. Planning
has bounded time and shutdown tracking. Its receipt is stored in
`.teamsmith/planning.json`. An unconfirmed termination, unknown usage, or changed
planning workspace requires inspection and reconciliation before another run;
modified or potentially active worktrees are retained as evidence. Cancellation
is therefore not proof that no quota was consumed. There is no automatic retry
or automatic reconciliation of uncertain planner state.

Generated drafts are bound to the source Git revision. A changed source revision
requires a fresh plan/review. Critical open questions block approval and execution,
including direct runner use. Existing executed or recovery-pending missions are
not overwritten by goal generation.

## Current limits and verification

This first implementation supports the local Codex planning adapter and the
current target repository. Cross-provider planning, prior-project preference
import, automatic skill discovery and learned cost optimization are separate work.
Semantic plan quality still needs user review; schema validation does not prove
that generated requirements are correct or complete.

Tests exercise real temporary Git worktrees, controlled local child processes,
HTTP requests and panel interactions. They cover routing, bounded output,
constraints, approval separation, stale revisions, cancellation and error paths.
They do not establish paid-model availability or live planning quality.
