# GP-1 — URL shortener (with playbook)

Regression scenario for the core loop with a playbook available (`web-saas`).
Exercises: multi-unit decomposition with parallel + sequential dependencies,
real `contracts` between units, worktree isolation, adversarial verification,
budget telemetry, milestone reporting.

## Task prompt (given verbatim to a fresh session with the orchestrator skill)

> Build a tiny URL shortener as a local web app: an HTTP API with
> `POST /shorten` (returns a slug) and `GET /:slug` (302 redirect), a minimal
> HTML page to create links, SQLite or file-based storage, unit and contract
> tests, a Dockerfile, and a README. Budget target: 400k tokens. Bias: thorough.

## Expected shape (not enforced, sanity reference)

- 4–6 work units, e.g. storage → api → frontend, plus docs; storage/api/frontend
  with explicit contracts; docs independent.
- 2–4 agents; verifier per unit; integration gate at the end.
- At least one milestone at the storage/api contract boundary.

## Pass thresholds — CALIBRATED (3 runs, 2026-07-06; deviations +12%/+23%/+33%,
## interventions 0/0/3; run-1 product-green but ledger-red pre-fix)

| Criterion | Threshold | Status |
|---|---|---|
| All acceptance criteria pass (verifier-confirmed) | 100% | calibrated |
| App runs: `POST /shorten` + `GET /:slug` round-trip works locally | required | calibrated |
| Human interventions during EXECUTE | ≤ 3 | calibrated |
| Budget deviation vs target | ≤ +40% (observed max +33%; upward trend across runs is a watch item) | calibrated |
| Repeatability | ≥ 2 of 3 runs pass | calibrated |
| Ledger integrity | `doctor` healthy; 0 error-level issues; state anomalies = 0 | fixed |
| Resume | killing the session mid-EXECUTE and restarting continues without redoing accepted units | fixed (exercised in run 2: 0 redone units, 0 re-asked questions) |

## Run protocol

1. Fresh directory, fresh Claude Code session with the clockwork plugin enabled.
2. Paste the task prompt. Answer CLARIFY questions consistently (record answers
   in `runs/gp-1/run-<n>/answers.md` for repeatability).
3. Mid-EXECUTE on run 2: kill the session after the first unit is accepted,
   restart, confirm resume (threshold row above).
4. After RETRO: copy `.teamsmith/` into `runs/gp-1/run-<n>/` as the evidence
   bundle; record threshold actuals in `runs/gp-1/results.md`.

## Calibration rule

After 3 runs, replace draft thresholds with observed p95 + margin and change
their status to `calibrated`. A threshold that every run beats easily should be
tightened, not celebrated.
