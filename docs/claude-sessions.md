# Managed Claude chat and context policy

This experimental entry point owns a Claude conversation through the official
Agent SDK. It does not attach to an already open terminal, desktop chat, Codex
worker, or independent verifier. It is not a Claude team-execution adapter.
Use the installed native Claude Code executable (tested CLI contract: 2.1.319).
Older Claude versions that cannot enforce fail-closed hooks are rejected by the SDK.
Sign in with Claude Code normally before starting. Clockwork never stores API keys.

From the target project, invoke the source CLI with an absolute path:

```sh
node --import tsx /path/to/clockwork/packages/cli/src/bin.ts claude chat \
  --claude-bin /path/to/claude --model sonnet \
  --prompt "Review the current project and propose the next small improvement" \
  --compact-at 600000
```

`--compact-at` accepts 100000..1000000. Omit it to retain Claude's own policy.
600000 is an experiment, not an optimal value or a promise of better reasoning.
It controls the auto-compact window; Claude applies its own threshold and caps it
at the model capacity. The variable is set only in the child process. No global
settings are changed. `compact_boundary` events are reported when received.

## Optional idle messages

Add these flags to opt in for this invocation only:

```sh
--keep-warm --cache-ttl 1h --warm-interval-minutes 50 \
--warm-max-calls 3 --warm-duration-minutes 180 --warm-max-cost-usd 0.25 \
--max-cost-usd 5
```

Messages ask for only `OK` in the **same SDK process and conversation**. Model,
tool definitions and system prompt stay fixed. A PreToolUse hook denies every
tool during an idle message, including normally auto-approved reads. No nested
agents, MCP servers, or background commands are enabled. Normal work uses Claude
permissions plus Clockwork's existing guard; write/shell requests requiring
approval are presented in the terminal. These permissions are not an OS sandbox.

Keep-warm is **off by default**. It begins only after a successful user turn with
known usage. It never overlaps a user turn and never sends catch-up bursts. The
interval is measured from the last request start, because cache lifetime starts
at request time. Defaults: 4 minutes (50 with explicit 1h TTL), six messages,
one hour of elapsed lifetime, and 0.25 USD of estimated warm-message usage.
These are bounded trial settings, not evidence of savings. An interval longer
than the provider TTL cannot reliably retain that cache.

`--max-cost-usd` (default 5) is the SDK's estimated **whole invocation** limit,
including normal work. The warm-only cost limit is checked after each result,
so one request can cross it. Neither limit is a guaranteed billing cap. A short
reply is requested, not guaranteed; if an idle reply exceeds 64 output tokens,
further warm messages are disabled. Unknown usage, a failed turn, or a timeout
also stops automatic messages. Idle turns time out after at most 60 seconds;
normal turns default to 15 minutes (`--timeout-ms`). No automatic retries occur.

Type `/warm off` to disable idle messages or `/exit` to stop the session. Ctrl+C
also stops it. Closing the terminal does not leave a Clockwork daemon. Piped input
runs one turn; keep-warm requires an interactive terminal. `--once` explicitly
runs one turn. Messages typed during an active turn are rejected, not silently queued.

## Persistence and measurements

The native Claude transcript remains in Claude's own local session storage.
Clockwork records metadata in `~/.clockwork/claude-sessions/<id>.json`, without
duplicating prompts, responses, credentials, or tool outputs. The file includes
project, chat role, policy, last status, usage, and warm-call count. The session
lock prevents two Clockwork processes from using the same session concurrently.
An abandoned lock must only be removed after confirming its owner has exited.

Resume only a Clockwork-owned chat in the same project, using its printed ID:

```sh
node --import tsx /path/to/clockwork/packages/cli/src/bin.ts claude chat \
  --claude-bin /path/to/claude --resume SESSION_UUID --prompt "Continue"
```

Keep-warm must be opted into again. The first resumed result establishes a new
accounting baseline; its delta is marked unknown rather than attributing historical
usage to the new request. Later results difference cumulative SDK counters:
uncached input, cache-read input, cache-write input, output and estimated cost.
Do not sum cumulative snapshots. Cache reads are not free. Estimated USD is not
a subscription invoice, nor proof of savings; compare equivalent useful tasks
with and without probes. Failed/aborted calls may have unreported usage.

This command does not load filesystem Claude settings, project hooks or MCP
configuration. Supply project instructions in the prompt; automatic CLAUDE.md
loading is not enabled in this isolated session entry point. Panel controls and
team-role integration remain separate work. SDK events are terminal/local metadata,
not task acceptance evidence in the orchestration ledger.

Sources: [Claude context window](https://code.claude.com/docs/en/model-config),
[prompt caching](https://code.claude.com/docs/en/prompt-caching), and
[Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript).
