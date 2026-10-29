# GP-3 — Brownfield feature addition (existing codebase)

Regression scenario for brownfield mode: adding a feature to an existing,
already-working project instead of building from scratch. Exercises: baseline-
first discipline (existing test suite run and recorded before any change),
read-before-plan (the new code must fit the existing codebase's conventions),
minimal-touch `owns` against pre-existing files, the regression gate at
verification (old suite must still pass unmodified), and the existing-behavior
contract (old endpoints unchanged for old cases).

The starting codebase is the GP-1 URL shortener (run-3 workspace): a zero-
runtime-dependency Node.js HTTP API + minimal HTML front end + JSON file
storage, `node --test` suite, Dockerfile, README. The task in run-3's
`README.md` documents its full existing behavior — treat that as the implicit
contract this run must not break.

## Task prompt (given verbatim to a fresh session with the orchestrator skill)

> Add per-link click statistics to the URL shortener. Every time
> `GET /:slug` redirects a visitor, count that redirect. Add a new endpoint
> `GET /api/stats/:slug` that returns `{"slug": "...", "url": "...",
> "clicks": <n>}` for a known slug (404 for an unknown or malformed slug, same
> shape as the existing 404). After creating a link on the HTML page, show the
> current click count next to the link (it starts at 0). Keep zero runtime
> dependencies. All existing tests must keep passing, and `POST /shorten` and
> `GET /:slug`'s existing behavior must stay byte-identical for cases that
> already worked. Budget target: 300k tokens. Bias: thorough.

## Expected shape (not enforced, sanity reference)

- 2–4 work units. A plausible split: storage+redirect-counting (extends
  `store.js`/`server.js`'s existing redirect path) → stats endpoint (depends on
  it) → frontend click-count display (depends on the stats endpoint's
  contract), with docs/README update either folded into the last unit or its
  own small unit.
- Every unit that touches `src/server.js` or `src/store.js` owns only the
  slice it needs; a unit list that "re-owns" the whole `src/**` tree the way a
  greenfield run would is a brownfield staffing smell.
- At least one unit's acceptance criterion is explicitly "pre-existing suite
  passes unmodified" (not just "new tests pass").
- The spec's `meta.assumptions` records the baseline: existing suite status
  (pass count, e.g. "16/16 passing") observed BEFORE any code change.

## Pass thresholds — DRAFT (no runs yet; calibrate after 3 runs per the rule below)

| Criterion | Threshold | Status |
|---|---|---|
| All acceptance criteria pass (verifier-confirmed) | 100% | draft |
| App runs: new stats flow works end to end (`POST /shorten` → `GET /:slug` increments → `GET /api/stats/:slug` reflects it) | required | draft |
| **Regression gate**: pre-existing test suite passes UNMODIFIED at RETRO (same file contents as the baseline, or any edit explicitly disclosed and justified in the run report) | required, 0 undisclosed edits | draft |
| **Baseline first**: INTAKE records the existing suite's pass/fail state before any file is touched (in `meta.assumptions`, before DRAFT) | required | draft |
| **Existing-behavior contract**: `POST /shorten` and `GET /:slug` produce byte-identical responses to the run-3 README's documented cases (status codes, headers, body shapes) for inputs that worked before | required, 0 deviations | draft |
| Human interventions during EXECUTE | ≤ 3 | draft |
| Budget deviation vs target | ≤ +40% (inherited GP-1 prior; brownfield reading cost may push this — watch item) | draft |
| Repeatability | ≥ 2 of 3 runs pass | draft |
| Ledger integrity | `doctor` healthy; 0 error-level issues; state anomalies = 0 | fixed |

## Run protocol

1. Fresh directory. Copy `runs/gp-1/run-3/workspace/` app files — `src/`,
   `public/`, `test/`, `package.json`, `README.md`, `Dockerfile` — into the
   fresh workspace. **Never run this scenario against the original
   `runs/gp-1/run-3/workspace/` directory** — it is the shared source, not a
   scratch copy.
2. Fresh Claude Code session with the clockwork plugin enabled, inside the
   copied workspace.
3. Paste the task prompt. Answer CLARIFY questions consistently (record
   answers in `runs/gp-3/run-<n>/answers.md` for repeatability).
4. No mid-run kill required for GP-3 (resume is already exercised by GP-1).
5. After RETRO: copy `.teamsmith/` into `runs/gp-3/run-<n>/` as the evidence
   bundle, alongside the baseline suite output captured at INTAKE; record
   threshold actuals in `runs/gp-3/results.md`.

## Calibration rule

After 3 runs, replace draft thresholds with observed p95 + margin and change
their status to `calibrated`, same rule as GP-1/GP-2. Pay particular attention
to the regression-gate and existing-behavior-contract rows: if any run passes
them only by loosening what "byte-identical" or "unmodified" means, that is a
finding about the scenario wording, not a reason to relax the threshold.
