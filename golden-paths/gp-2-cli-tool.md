# GP-2 — Markdown TOC CLI (without playbook)

Regression scenario for the no-playbook fallback. Deliberately a project type
with no playbook in `assets/playbooks/`: the orchestrator must reason from
scratch AND draft a new playbook in RETRO. Also exercises the small-team path
(2–3 units) — clockwork must not over-staff a small job (minimum sufficient
stack applies to team size too).

## Task prompt

> Build a small Node CLI called `mdtoc`: given a markdown file, it prints a
> table of contents generated from the headings (`mdtoc README.md`, with
> `--max-depth N`). Include unit tests and a README with usage examples.
> Budget target: 250k tokens. Bias: cheap.

(Target recalibrated from 120k after run 1: the spend convention counts each
subagent's total reported token usage, and four agent passes on this job cost
~165k. Targets must live under the same convention as the meter.)

## Expected shape (sanity reference)

- 2–3 work units (core + cli/docs), 1–2 agents. A 6-agent team for this job is
  itself a failure signal even if the code works.
- No playbook found at INTAKE → noted; RETRO drafts `assets/playbooks/cli-tool.md`
  with `provenance: auto-draft`.

## Pass thresholds — CALIBRATED (3 runs: 2026-07-05/06; runs 2–3 under the
## pinned spend convention landed at -41.5% budget, 0 interventions, 2 units/2 agents)

| Criterion | Threshold | Status |
|---|---|---|
| All acceptance criteria pass (verifier-confirmed) | 100% | calibrated |
| `mdtoc` works end to end on a sample file | required | calibrated |
| Team size | ≤ 3 units, ≤ 2 agents | calibrated |
| Unplanned human interventions during EXECUTE (protocol events — CLARIFY answers, spec approval — do not count) | ≤ 1 | calibrated |
| Budget deviation vs target | ≤ +25% (observed -41.5% on healthy runs; +50% would hide real overruns) | calibrated |
| Repeatability | ≥ 2 of 3 runs pass | calibrated |
| Draft playbook produced with `provenance: auto-draft` | required | fixed |
| Ledger integrity | `doctor` healthy; 0 error-level issues; anomalies = 0 | fixed |

Model-independence note: run 3 was driven by a different model (Opus) with no
flow deviations — the skill text held across models.

## Run protocol

Same as GP-1 (fresh dir + session, consistent answers, evidence bundle under
`runs/gp-2/run-<n>/`). No mid-run kill required for GP-2.
