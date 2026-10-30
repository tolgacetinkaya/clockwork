# How Clockwork works today

Clockwork coordinates a reviewed task plan through local AI provider sessions. Independent tasks may run in parallel; dependencies delay tasks until their prerequisites are accepted. Each task has owned files and acceptance evidence. A separate verifier checks delivery evidence. Combined integration verification is required before treating the whole result as verified.

## Which panel am I seeing?

The Docker panel at port47831 is a recorded demo. It streams fixture changes but starts no AI sessions. Use its overview, task board and team to explore the UI. The Getting started screen explains the current mode and the next action. Demo execution controls are hidden and its plan editor is disabled.

For real execution, start Clockwork from the target project's clean Git directory. The panel binds to that directory; there is no browser folder upload/picker. With Clockwork installed and built, invoke its source CLI as shown in README, using `ui --enable-execution --port47833`. A configured local Codex CLI is required. Keep that terminal running. This UI does not automatically infer a task plan from the goal: planning is currently manual.

## The flow

1. Connect the target workspace from the terminal.
2. Open Mission control and define the goal, bounded tasks, owned paths, acceptance evidence and dependencies. Specify budget, concurrency and combined-result checks.
3. Save the plan, inspect it and approve that exact revision. Start separately and explicitly; saving/reviewing never starts agents.
4. Use Overview for overall progress, Workboard for task states/dependencies, Team for recorded actor contributions, Activity for events and Decisions for questions/checkpoints.
5. Inspect combined verification evidence before accepting the project result. Task acceptance alone is insufficient.

Recovery remains a separate reviewed flow for interrupted work. Existing execution cannot be overwritten by drafting another mission into the same workspace.
