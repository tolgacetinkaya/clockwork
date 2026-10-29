# Golden paths

Internal regression scenarios for clockwork development â€” users never see these. Run whenever the core changes.

- **GP-1** (with playbook): small URL shortener web app â€” parallel + sequential units, real contracts, objectively measurable acceptance.
- **GP-2** (without playbook): small CLI tool or Claude Code skill â€” tests the no-playbook fallback and draft-playbook generation.
- **GP-3** (later): brownfield â€” adding a feature to an existing project.

Pass definition: all acceptance criteria + human interventions â‰¤ N + budget deviation â‰¤ X% + repeatability (â‰¥2 of 3 runs). Thresholds are calibrated during the first runs (M6).

## Public-checkout evidence

Raw local `runs/` are intentionally ignored. Reviewed ledger fixtures under
`packages/core/test/fixtures/historical/` support deterministic public tests.
The scenario documents describe the original manual harness: a fresh checkout
does not include the GP-1 generated application that GP-3 historically used.
Create a new baseline app for a new live run; archived fixtures alone cannot
reproduce its product-level acceptance.
