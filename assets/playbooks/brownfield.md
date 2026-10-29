---
id: brownfield
applies_to: [existing codebase, feature addition, bug fix in existing project, brownfield, extend an existing app, modify existing project]
version: 1
provenance: builtin
---

<!--
A playbook is PRIOR KNOWLEDGE, never a template. The orchestrator drops what
does not fit and adds what is missing. This one is cross-cutting: it composes
WITH the project-type playbook (e.g. web-saas) rather than replacing it —
brownfield changes what kind of work you're doing (add-to-existing vs.
build-new), not what the project IS.
-->

## Typical work layers

- **Baseline capture** is not a work unit — it is an INTAKE step that happens
  before DRAFT even starts: run the existing test suite, record pass/fail
  state, note the run command. Everything downstream is measured against this
  baseline, not against zero.
- **Codebase inventory** (also INTAKE, before DRAFT): structure, naming and
  file-layout conventions, test approach and framework, how the app is
  actually run/started, and — if a project-knowledge graph exists (graphify)
  — query it instead of re-deriving structure from scratch.
- Work units in brownfield tend to be **narrower and more numerous per line
  of diff** than greenfield: the unit boundary follows the *seam* in the
  existing code (the function/module/endpoint being extended), not a clean
  layer split. A greenfield-shaped "storage → api → frontend" decomposition
  is often wrong here; the right shape is "the two or three places this
  feature actually touches".
- Regression verification is not optional glue at the end — treat "run the
  full pre-existing suite" as a real acceptance step with its own budget, not
  a free side effect of writing new tests.

## Known couplings

- **Existing tests are load-bearing documentation.** They encode behavior
  nobody wrote down elsewhere. Read them during INTAKE inventory, not only
  when they fail — they are often the fastest way to learn the real contract
  of a function the README undersells.
- **Shared/high-traffic files stay with the integrator, same as greenfield**
  route tables, dependency manifests, shared config — but in brownfield these
  files ALREADY have content and conventions; the integrator's job is to
  extend the existing pattern (e.g. add one route in the existing router
  style), not to restructure it.
- **New feature's data shape ↔ existing storage shape.** If the feature adds
  a field or a counter to an existing record, the existing storage/serialization
  code is a dependency of the new unit even when no file lines overlap —
  changing a record shape can silently break every other reader of that
  record.

## Default quality bars

- **Regression acceptance criterion is mandatory on every unit that touches
  existing files**: "pre-existing suite passes unmodified." Not "still
  passes after my edits" — unmodified, same file, same assertions, unless the
  run report explicitly discloses and justifies an edit.
- New code should be indistinguishable in style from a diff written by
  whoever wrote the surrounding file: same test framework, same error-shape
  conventions, same naming, same module layout. A verifier flags new code
  that "reads like a different codebase" even if it works.
- Existing public interfaces (endpoints, exported functions, CLI flags) that
  the unit does not intend to change are listed in the unit's `contracts` as
  PRESERVED, with the specific cases that must stay byte-identical — this
  makes "I didn't mean to change that" checkable instead of assumed.

## Threat model notes

- Regression risk IS the threat model here as much as new-code risk: a
  silent behavior change in an existing, already-deployed-in-spirit endpoint
  is a bigger real-world hazard than a flaw in the brand-new code, because
  callers already depend on the old behavior and won't expect a change.
- Apply the type playbook's normal threat model (e.g. web-saas's input
  validation notes) to the NEW surface area only; don't re-audit the whole
  existing app unless the user asked for that as separate scope.

## Estimation notes

- **Reading cost is real and easy to under-budget.** A unit that touches 15
  lines of unfamiliar code can cost more in comprehension than a 150-line
  greenfield unit, because the producer has to reconstruct intent, find every
  caller, and locate the relevant existing tests before writing anything.
  Budget INTAKE's codebase inventory step like a small research unit, not as
  free overhead.
- The regression-gate verification (running the full pre-existing suite, not
  just the new unit's tests) adds real cost on top of the new unit's own
  verifier — budget it explicitly rather than assuming it rides free on the
  new test run.
- A brownfield unit's `budget_est` should account for two read passes (inventory,
  then the specific seam) before any write — greenfield units by contrast
  start writing close to immediately.

## Estimation notes

- Reading/understanding cost is real, but the sharper lesson (GP-3 run-1): the
  expensive unit is the one whose VERIFIER has no existing test pattern to
  reuse. A storage-layer change verified from scratch cost +135% while the
  API unit (riding the existing HTTP-test scaffolding) stayed near estimate.
  Budget verification by "how much scaffolding must the verifier build", not
  by the unit's architectural complexity.

## Pitfalls

- **Rewriting instead of extending.** The path of least resistance for an
  agent is often "this would be cleaner if I restructured X" — resist it
  unless restructuring is the actual ask. A rewrite invalidates the baseline
  and multiplies regression risk for no requirement-cited benefit.
- **"While I'm here" scope creep.** Touching adjacent code that "could use a
  cleanup" while implementing the feature turns a narrow, verifiable diff
  into a wide one nobody scoped or budgeted. Flag it as a separate suggestion,
  don't fold it in.
- **Breaking test fixtures shared with old tests.** A new unit that changes a
  shared fixture, seed file, or test helper to suit its own tests can silently
  break assertions in unrelated old tests that read the same fixture — check
  what else consumes a fixture before changing it.
- **Silently updating existing tests to match new behavior.** If new work
  makes an old test fail, that is a finding to surface, not a green light to
  edit the old test into passing — the orchestrator/verifier must treat a
  producer editing a pre-existing test as suspicious by default and require
  explicit disclosure and justification (see the SKILL's regression gate).
- **Skipping the baseline.** Starting DRAFT without having actually run the
  existing suite means a later failure can't be attributed — you won't know
  if the new unit broke something or if it was already broken. A dirty
  baseline (some tests already failing before any change) must be surfaced
  to the user, not silently absorbed into "well it's still broken."
- **Owning too much.** A brownfield unit that lists `owns: ["src/**"]` out of
  greenfield habit blocks every other unit that needs to touch the same tree
  and defeats minimal-touch; own only the files this unit actually needs to
  change.
