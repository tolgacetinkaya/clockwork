---
id: cli-tool
applies_to: [cli, command-line tool, node cli, terminal utility, script with flags, file-processing cli]
version: 1
provenance: auto-draft
---

<!--
Auto-drafted at RETRO of GP-2 run-1 (mdtoc: a markdown-to-TOC Node CLI). No
playbook existed for CLI tools; this captures what worked so the next CLI run
starts warm. Treat cautiously until a human reviews it or a second successful
run confirms it.
-->

## Typical work layers

- Two units usually suffice for a small CLI:
  1. **core + entrypoint** (`code`) — the pure logic library plus the arg-parsing
     executable and the manifest (`package.json`, license). Owns `src/**`,
     `bin/**`, `package.json`, `LICENSE`.
  2. **tests + docs** (`code`, depends on core) — the test suite and the README
     with worked usage examples. Owns `test/**`, `README.md`.
- Keep the pure logic (a `generate*`/transform function) in a library module the
  CLI wraps, so it is unit-testable without spawning a process. This split is the
  single most useful decision — put it in the core unit's contract.
- A separate test unit is justified here (unlike web-saas where tests ride each
  unit's acceptance) because the docs+tests unit naturally depends on the pinned
  core contract and can be staffed to the same producer sequentially.

## Known couplings

- **Manifest ownership is the seam.** `package.json` carries the core's `bin`
  entry AND the test unit's `test` script. Give the WHOLE manifest to the core
  unit and have it pre-wire `test: "node --test"`; the test unit then only adds
  files under `test/**`. Two units editing `package.json` is a classic overlap —
  keep owns disjoint.
- **Output format is a contract, not a detail.** How the TOC/output is rendered
  (nesting, slugs, link style) must be pinned in the core contract, because the
  README examples and the CLI tests both assert against the exact bytes. If it
  drifts after docs are written, the README goes stale silently.
- **Slug/anchor generation** (or any id/normalization rule) belongs to core and
  is depended on by tests — do not let the test unit reinvent it.

## Default quality bars

- Zero runtime dependencies is the default for a small CLI — no arg-parser or
  markdown library unless a requirement forces it (minimum sufficient stack).
- Test runner: built-in `node:test` + `node:assert` (Node >= 18). No framework,
  no install. Wire `test` script to `node --test` (auto-discovers `test/**/*.test.js`).
- Acceptance must be exercised by RUNNING the binary (spawn via
  `node:child_process`), not only by importing the library: cover the happy path,
  each flag, at least one malformed-input path, and the error/exit-code path.
- README must contain >= 2 copy-pasteable examples whose shown output was
  captured from the real binary; a verifier should reproduce them byte-for-byte.

## Threat model notes

- CLI reads a user-supplied file path: handle missing/unreadable files with a
  clean stderr message and a non-zero exit — never an unhandled stack trace.
- Validate numeric/enumerated flags (e.g. `--max-depth N` must be a positive
  integer); reject bad input with a non-zero exit rather than silently ignoring.
- Dependency audit + secret scan still apply even at zero deps (confirm the tree
  is actually empty; scan sources for accidental keys).

## Pitfalls

- **budget_est vs recorded spend mismatch.** Per-unit `budget_est` naturally
  covers only PRODUCTION, but the ledger attributes the verifier's spend to the
  same unit, so every unit shows a large positive delta. Either estimate
  producer+verifier together, or read the per-unit delta as expected-high.
- **Subagent token accounting overshoots tiny budgets.** If you record each
  subagent's full context-window token count as spend, a trivial CLI (4 agent
  passes) can blow a 120k "cheap" target. Decide up front whether the ledger
  tracks marginal cost or context-window totals, and set the ceiling accordingly.
- Over-staffing a CLI is a failure signal: 2 units / 2 roles (a producer and an
  adversarial verifier) is the right size. Do not add a separate parser unit,
  packaging unit, or research fan-out for a job this small.
- README written before the CLI output stabilizes → stale examples. Schedule the
  docs unit AFTER the core contract is accepted (a soft milestone at the core
  boundary is enough).
- Guard model assumes parallel units in worktrees; a small CLI is usually
  SEQUENTIAL in one tree. `allow_main_tree: false` with no worktrees would block
  every producer write — use `allow_main_tree: true` (or per-unit worktrees) and
  document the choice.
<!-- confirmed by run-mdtoc-2 -->

<!-- confirmed by run-mdtoc-3 -->
