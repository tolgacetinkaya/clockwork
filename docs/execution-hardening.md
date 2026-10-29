# Execution hardening

## Guard configuration

The Claude adapter's PreToolUse hook is registered for every tool, including
future tools. Known reads remain available while paused; mutations, shell calls,
and agent spawns stop at pause/kill or the recorded budget ceiling. Otherwise,
shell calls, spawns, and unknown tools require explicit approval. The existing
class-3 command patterns still deny recognized publishing/production operations.
Those patterns are not a shell parser or an isolation mechanism.

Direct file writes require absolute, unambiguous paths within their declared
scope. Traversal segments, Windows alternate streams/device names, sibling-tree
writes from a unit's cwd, and nested `.teamsmith` paths are rejected. Existing
symlink/junction ancestors are resolved and checked against physical ownership;
hard-linked existing targets are rejected. NotebookEdit validates notebook_path
exclusively; other direct writers validate file_path exclusively.

The hook validates the full guard configuration, regexes, control payload, and
budget ledger. Corruption fails closed. CLI `guard set` uses the same validator.
The configured project_root must match the directory containing the guard.

For normal workspaces, the outermost configured ancestor of the trusted hook
process cwd supplies the policy; a nested guard cannot override it. For external
worktrees or launchers that change cwd, set CLOCKWORK_PROJECT_ROOT to the absolute
project root in the trusted launcher's environment. An explicitly supplied anchor
is used exactly. It must point at an initialized guard: an unconfigured project
remains inactive, so verify installation before executing a run.

Pause/kill prevents future tool mutations; it does not terminate already running
processes. Resume through the local panel or a separate operator terminal because
the paused session's shell is also blocked. Re-running init preserves pause/kill.

This is an approval boundary for a cooperative orchestrator, not an OS sandbox
or authenticated process identity. Approved shell commands can access the host,
and concurrent filesystem changes can race path checks. Use an OS/container
sandbox for untrusted code or stronger isolation. Live enforcement in a real
Claude Code session still requires a separate plugin-enabled end-to-end run.

## Event admission

The ledger writer validates event payloads and transitions under the same process
lock used for sequence allocation and append. Invalid events leave the ledger
unchanged. Replay reports anomalies without applying rejected transitions.

Checks include finite nonnegative spending, positive targets, safe identifiers,
supported explicit ledger schema versions, valid nonempty dependency snapshots,
legal unit transitions, and accepted dependencies before starting a unit.
Completion requires an approved spec, accepted/cancelled units, and no blocking
checkpoints or unanswered questions. Graph changes stop after completion; final
unitless overhead accounting remains supported for historical runs.

Existing optional run-version metadata and legacy budget checkpoints remain
readable. Old malformed ledgers are available for diagnosis but must be repaired
explicitly before appending. doctor exits nonzero on state anomalies.

## Command acknowledgment

The queue uses explicit acknowledgment:

1. `commands pull` returns unacknowledged commands in order.
2. Apply one command and persist its resulting ledger event, including
   command_seq in event data.
3. `commands ack <seq>` acknowledges the successfully handled prefix.

A crash before acknowledgment replays the command. A crash after its effect but
before acknowledgment can also replay it: inspect the event's command_seq before
reapplying. Delivery is at least once, not exactly once. Concurrent consumers can
receive the same pending commands; use a single orchestrator or an idempotent
consumer. Repeated/older acknowledgments are harmless; future sequences, corrupt
cursors, gaps, and malformed queues are refused. Do not acknowledge a batch with
unfinished entries. A note without a state-changing action can be acknowledged
after reading it.

Migration: callers of consumeCommands/pull must now acknowledge explicitly.
Existing cursor values are preserved; commands already acknowledged by an old
consumer cannot automatically be reconstructed as pending.

## Storage and recovery

Queue appends, ledger appends, and acknowledgments serialize across processes
using exclusive sidecar locks. Cursor replacement is atomic. Final-file storage
aliases (symlinks/hardlinks), nonregular files, malformed records, sequence gaps,
and unfinished final lines are refused for mutations. Lock diagnostics never read
or print arbitrary lock-file contents.

Locks are never stolen based on age. If a process dies while holding a lock,
operations stop with a bounded timeout naming the lock. An operator must confirm
the owning process has stopped before removing that sidecar and retrying. Never
remove a live owner's lock. Diagnostic readers can observe a concurrent partial
append; retry after the writer finishes before concluding that storage is damaged.

These are per-file guarantees. A spec-file write and its amendment ledger event
are not one crash-atomic transaction. CLI preflights amendment admission before
writing a new spec, but recovery across a crash between those writes remains
future work.

## Local state safeguards

Worker workspace admission compares resolved path components. A worker may not
be the control directory or contain it, including control directory names that
start with two dots. This check does not replace the execution sandbox or the
ownership checks described above.

Panel control updates preserve omitted flags only after reading a valid control
file with boolean `paused` and `kill` fields. Only a missing file is treated as
uninitialized. Corrupt or unreadable files reject updates and remain untouched;
the panel snapshot reports a diagnostic instead of silently clearing a stop.

New commands containing recognized credential formats are rejected before they
are appended, with a generic error that does not repeat the credential. This
includes nested values and property names. Accepted command content is not
silently redacted or otherwise rewritten. Programmatic queue callers may supply
a `Redactor` with registered secret literals in addition to the built-in formats.
Ledger redaction also covers property names, preserving colliding entries under
distinct redacted names.

Secret detection is defense in depth, not a secret-storage mechanism: arbitrary
passwords and unrecognized formats are not guaranteed to be detected. Supply
credentials through the provider's authentication/configuration mechanism, not
operator answers or notes. Existing queue and ledger records are not rewritten
by these safeguards. Acknowledgment advances the queue cursor; it does not erase
old records. Previously stored credentials need separate review and rotation.
