# Local Codex execution (experimental)

Clockwork has a local Codex CLI adapter in addition to its Claude Code plugin.
The common runner takes an approved work unit, executes a producer, and runs a
fresh, independent verifier. It records both sessions in the existing ledger;
the React panel follows the same SSE projection. This is bounded unit execution,
not an autonomous background scheduler or a Codex desktop plugin.

## Requirements

- Node.js 24+, Git, installed Clockwork dependencies and a built panel.
- A local Codex CLI supporting `exec --json --ephemeral --output-schema` and
  `--ignore-user-config` (tested locally with 0.154.0).
- Run `codex login` and `codex login status` yourself. Authentication stays in
  the CLI's local store. No auth files are read/copied by Clockwork. API-key
  environment variables are removed from the worker environment.
- On Windows, a native sandbox must already be configured. Pass
  `--windows-sandbox elevated`, `unelevated`, or `mxc` to select the implementation
  you have configured. This only passes that one setting for the invocation;
  Clockwork does not install a sandbox, request administrator access, or edit
  your global configuration. MXC requires a CLI/OS combination that supports it.
  Do not switch implementations just to evade an enforcement failure.

The adapter ignores general user configuration, disables configured MCP servers
and nested Codex multi-agent spawning, and never uses full access or automatic
approval bypasses. User/project instructions and execpolicy rules can still
apply. Managed policy remains authoritative. Model selection is explicit with
`--model`; without it, the isolated CLI invocation uses its default, not a
Clockwork model-tier mapping. CLI account usage limits still apply.

## Prepare a run

The orchestrator instructions are in
`integrations/codex/skills/clockwork/SKILL.md`. Ask your Codex session to read that
file and follow it for the target project. It creates a draft spec, obtains user
approval and records the approved unit snapshot and budget. Running `init`
alone does not create a task plan or launch an agent. There is no `npx clockwork`
release yet.

Run the source CLI from the target project directory:

```sh
node /path/to/clockwork/node_modules/tsx/dist/cli.mjs /path/to/clockwork/packages/cli/src/bin.ts init
```

For the remaining examples, `cw` means that same source CLI invocation, from the
target project's root. The run must be in `execute`, with an approved current
specification, a positive recorded token budget, accepted dependencies, and no
blocking questions/checkpoints. The runner refuses corrupt or paused controls.

## Execute one unit

Create a linked worktree belonging to the target repository. Start from a commit
that includes the accepted dependencies; do not commit local state or secrets.

```sh
git worktree add --detach ../worker-auth HEAD
cw codex produce wu-auth --workspace ../worker-auth
cw codex verify wu-auth --workspace ../worker-auth
```

On Windows, append the selected `--windows-sandbox` option to both commands. If
`codex.exe` is not on PATH, use `--codex-bin` with its absolute executable path;
a `.cmd`/`.ps1` shim is not accepted through a shell fallback. `--timeout-ms`
defaults to 900000 and supports 1000 through 3600000. Prompts travel on stdin,
not as shell command strings.

A successful producer leaves the unit **running**, awaiting verification. A
successful verifier records **accepted** only with passing command/result
evidence for every exact acceptance criterion and no findings. Missing evidence
or findings produce **rework** (CLI exit code 1). The verifier is a new thread,
receives no producer report/reasoning, and runs read-only. Checks that need
writable build/cache directories cannot be certified by this first verifier;
report rework rather than treating an unexecuted check as success.

The worktree remains available for review and integration; Clockwork never merges,
commits or deletes it. Review accepted changes and integrate them into your own
branch before preparing downstream worktrees. The first runner serializes workers
per target project; automatic parallel scheduling is future work.

## Delivery boundaries and recovery

- Producers use Codex's workspace-write sandbox; verifiers use read-only. File
  `owns` globs are a prompt contract plus a **post-execution delivery gate**, not
  per-file OS permissions and not the Claude PreToolUse hook. Out-of-scope changes
  are retained for manual review and fail delivery. Ignored files, external side
  effects, Git metadata and transient writes are not comprehensively audited.
- Main-tree execution is rejected. The worker must be a separate linked Git
  worktree, and the control directory must be outside its writable root. The
  OS sandbox, installed rules and machine policy determine the real isolation.
- A producer receipt binds spec version, worktree, HEAD and the visible Git
  delivery fingerprint. Verification refuses an intervening edit or changed
  HEAD. Rework can reuse the recorded delivery. The receipt is local state,
  not authenticated evidence against a malicious host/user.
- Usage comes from CLI turn completion: input + output tokens; cached input is
  already included in input and is not counted twice. These are consumed tokens,
  not money. Estimates/recorded targets are checked before starting; one turn may
  overshoot the remaining target. This is not a real-time provider spending cap.
- Pause/stop, SIGINT and timeout interrupt the CLI child. Production interruption
  becomes failed; verification interruption becomes rework. Already started OS
  descendants may survive; inspect them before recovering. No work is auto-retried.
- If usage is unavailable after interruption/failure, `agent.error` records
  `usage_unknown`; future workers stop until an operator reconciles actual usage:
  `cw event budget.spent --data '{"tokens":123,"reconciles_execution":"EXECUTION_UUID"}'`.
  Use the execution ID in the error event and verified provider/session accounting;
  never invent a zero or a guessed total. Failed units need an explicit reviewed
  plan amendment/new unit; they are not silently reset to pending.
- A process crash may leave `.teamsmith/execution.lock`. Remove it only after
  confirming the owning worker and its descendants have stopped. Receipts and
  ledger appends are separate operations; a crash between them needs inspection.
- Notes/questions remain on the existing durable command queue. The supervising
  orchestrator consumes them; the bounded worker does not independently drain or
  acknowledge them. Local sessions are ephemeral; resuming a Codex thread is not
  exposed by this first adapter.

## Extending to other providers

`ExecutionAdapter` in core defines thread/activity/usage/report events.
`packages/runner` owns lifecycle, admission, controls and delivery gates.
`packages/adapter-codex` owns the Codex process and JSONL dialect. Claude prompt
builders retain their original exports; platform-neutral prompts now live in core.
The legacy Claude hook/config CLI remains explicitly Claude-specific.

A Gemini CLI adapter can implement the same execution contract. A direct model
API adapter also needs a tool executor, sandbox, approval policy and agent loop;
changing an endpoint URL alone is not a complete coding-agent integration.
Adapters must declare and test their actual capabilities before enabling a run.

References: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk),
[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox).
