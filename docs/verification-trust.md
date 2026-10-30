# Verification trust boundaries

Clockwork now gates local Codex deliveries on protected-test integrity, canonical ownership, and observed command completion. These checks supplement the configured execution sandbox; they do not turn model evaluation into a mathematical proof or protect against a malicious host.

## Existing tests and validation configuration

Before production, the runner captures the committed HEAD, existing test/configuration file identities and content hashes. Unapproved changes or deletion of those files fail delivery. New tests are allowed. Package manifests are protected as a whole because their scripts can bypass validation.

If the task intentionally changes an existing test or test configuration, name each exact repository-relative path in that work unit's approved specification:

```yaml
work_units:
  - id: wu-fix
    type: code
    description: Fix the parser and update its approved regression expectation
    owns: [src/parser.ts, tests/parser.test.ts]
    acceptance: [The parser regression test passes]
    allowed_test_changes: [tests/parser.test.ts]
```

These are explicit exceptions, not inferred from broad ownership. Globs, traversal, control directories and paths outside the unit's ownership are rejected. Existing test exceptions must name protected files. New recognized validation configurations/manifests also require an explicit exact-path exception; ordinary new tests do not. An approved exception authorizes an edit; independent verification must still evaluate whether that edit is correct. Plan edits require renewed approval. The current panel editor does not provide an exception editor; use the reviewed YAML specification workflow for these tasks.

## Command-backed evidence

The Codex adapter emits command receipts from completed CLI command_execution items. A receipt includes the tool item ID, exact command, completion status and exit code. Raw command output is not copied into receipts. The runner records redacted receipt metadata with the execution, workspace, HEAD and delivery fingerprint.

For unit and combined verification, every claimed evidence command must match a successful receipt from that same fresh verifier invocation. Only surrounding whitespace is ignored. The verifier must copy the full actual CLI command, including shell wrappers. A prose success claim, missing receipt, failed command, duplicated item ID, unfinished command or a later failed retry cannot establish acceptance. A producer's receipts cannot certify its verifier.

This establishes that the adapter observed a command complete, not that an arbitrary command tests the intended behavior. The independent verifier and reviewed acceptance criteria remain responsible for relevance. A check can still target an unrelated server or use insufficient assertions. Services, databases, browsers and tool subprocesses are not individually attested. No report-supplied shell command is automatically executed by this feature.

## Ownership and integration

Potentially overlapping scopes require dependency ordering; concurrently eligible tasks must have disjoint supported scopes. Scope matching is deliberately conservative for wildcard patterns. Delivery rejects changed file aliases, symlink/junction ancestors, hard-linked targets and control paths, including deleted leaves beneath an unsafe ancestor. Separate worktrees and serialized integration remain required.

Delivery fingerprints cover tracked differences, new visible files and ignored-file metadata. Ignored contents are not read. Common dependency/cache/build directories are opaque: their root metadata is recorded, but nested contents are not attested. The runner rejects observed ignored metadata changes; this is not comprehensive filesystem monitoring. The inventory is bounded and fails closed when its limits are exceeded. Path checks can still race external filesystem changes; the OS sandbox remains necessary.

Combined verification uses the same command-backed rules when global_gates are configured. Older specifications without gates continue to report not_configured; accepted units are not proof of a checked combined result. Contracts remain reviewed text, not generated executable contract tests.

## Incomplete work inventory

Introduced executable unimplemented markers and explicit implementation stubs fail delivery. New TODO/FIXME markers are recorded as warnings. Unchanged existing markers do not become new findings. Tests are excluded from implementation marker detection, and legitimate mocks are not categorically rejected. Findings contain categories, paths, line numbers and severity, not source text. This bounded static inventory cannot identify every disguised or semantic placeholder.

## Recovery compatibility

New unit and team receipts carry a verification trust version. Receipts from before this gate cannot silently certify a new verification or reviewed team recovery; inspect and reconcile them manually. Receipts remain local cooperative state, not cryptographically authenticated attestations against the operator.

## Validation

Tests exercise real temporary Git worktrees, filesystem aliases and actual local command processes as well as controlled adapter events. They do not require a paid model invocation. Live provider acceptance and platform-specific native sandbox behavior remain separate checks.
