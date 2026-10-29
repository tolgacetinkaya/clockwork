---
id: web-saas
applies_to: [web app, saas, web service, http api, backend + frontend, url shortener]
version: 1
provenance: builtin
---

## Typical work layers

- **storage/data** → **api/backend** → **frontend** (sequential contracts), with
  **docs** and **content** units independent and parallel.
- Contract direction: storage promises a data-access interface to the API; the
  API promises endpoint contracts to the frontend. Write both into the spec —
  integration failures live exactly at these seams.
- Tests are not a separate unit by default: unit/contract tests belong to each
  unit's acceptance criteria. A separate test unit is justified only for e2e
  suites spanning several units.
- Deployment work is class 2/3 territory: for Phase-1 scope produce a runbook
  (Dockerfile + local run instructions count as class 1 and stay in scope).

## Known couplings

- **Revenue model → schema + auth.** If the product will have tiers/billing,
  the data model and auth must anticipate it from day one, even in an MVP.
- **Auth choice → nearly everything.** Session vs token vs none changes API
  middleware, frontend state, and storage. Decide it in DRAFT, not mid-EXECUTE.
- **Slug/id generation → storage AND api.** Uniqueness strategy is a shared
  contract; two units deciding it independently is a classic integration defect.
- **Static assets → integrator.** Frontend build outputs and route tables are
  shared files; route them through the integrator role.

## Default quality bars

- Unit tests for storage and core logic; contract tests for every promised
  endpoint (status codes, redirect behavior, error shapes).
- The app must start locally with a single documented command; the README's
  setup steps are an acceptance criterion of the docs unit ("a fresh machine
  can follow them").
- Line coverage ~80% for code units — override per spec when the user's bias
  is `fast`/`cheap`.

## Threat model notes

- Input validation on anything that becomes a URL, slug, or path (open
  redirect, path traversal, injection into storage).
- Dependency audit + secret scan always; rate limiting and abuse concerns are
  worth a NEGOTIATE note even when out of MVP scope.

## Estimation notes

- Under `thorough` bias, units whose VERIFICATION does heavy real work are the
  ones that blow estimates — infra (real `docker build` + container run in both
  producer and verifier) and docs (verifier starts the server, runs the suite,
  follows the README on a "fresh machine" basis) can cost 100–150% of their
  production spend in verification alone. Budget infra/docs verification like a
  code unit's, not as a cheap afterthought.
- Three runs of evidence (2026-07-06): the parity rule is really about whether
  the VERIFIER MUST BOOT THE APP, not the unit's `type` tag. Any unit whose
  verifier stands up a real server / container / full suite (docs, infra,
  integration — and code units like a frontend verified via live round-trips)
  should budget the verifier AT PARITY with the producer. Observed: docs
  32k→86k, infra 35k→79k, integrate 40k→86k, frontend (code!) 45k→80k.

## Pitfalls

- Frontend started before API contracts are pinned → rework cascade. Put a
  milestone at the contract boundary.
- "Just add Redis/queue/search" without a citing requirement — minimum
  sufficient stack rule; small apps ship on SQLite/files.
- Verifier that only reads code — endpoint acceptance must be exercised with
  real requests (curl or test client), not inspection.
- Docs unit written before the run command stabilizes → stale README; schedule
  docs acceptance after integration.
