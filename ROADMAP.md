# Clockwork — Roadmap and Build Plan

> Concept and design decisions: **CONCEPT.md**. This document answers "what will be built, in what order, with what".
> Last updated: 2026-07-05

---

## 1. Technology Decision

### Language: TypeScript (Node.js) — not Python

The decision derives not from "which language is more powerful" but from **what this project's code surface is**. clockwork's code is not ML/AI computation; the intelligence lives in the prompts (the skill/playbook markdowns). The code to be written: hooks, CLI, spec validation, ledger reading/state derivation, the adapter layer, and (in Phase 2) the local panel. On this surface:

| Criterion | Assessment |
|---|---|
| **Runtime guarantee** | Claude Code is Node-based → Node is **already present** on the target audience's machine. Python is not guaranteed (version/PATH chaos, especially on Windows). Zero extra installation = zero first-use friction. |
| **Hook performance** | Hooks run on every tool call; Node's cold start is fast enough and can be compiled to a single file. |
| **Distribution** | The npm/npx ecosystem (`npx clockwork ...`) — the skills ecosystem (find-skills, `npx skills add`) is on the same channel. |
| **Panel (Phase 2)** | Local web server + frontend in the same language. |
| **Python's advantages** | ML libraries — we don't use them (no semantic search, no training). No valid advantage remains. |

Rules: strict TypeScript; the single runtime target is Node LTS; **the dependency budget is tight** — every npm package must justify itself (the "every component references a requirement" rule from §4.5 applies to our own repo as well). Anticipated core dependencies: a YAML parser, a JSON Schema validator (ajv), a test framework (vitest). That is all.

### Repository Structure (draft)

```
clockwork/
  packages/
    core/                # PLATFORM-INDEPENDENT — contains no Claude Code knowledge whatsoever
      spec/              #   schema (JSON Schema), validation, versioning, amendment
      ledger/            #   event dictionary, append, state derivation (pure functions)
      budget/            #   telemetry: per-unit meter, reporting
      retro/             #   retrospective record schema and writing
    adapter-claude/      # Claude Code adapter — plugin package
      hooks/             #   owns-enforcement, permission class, budget ceiling (PreToolUse)
      spawn/             #   spec → agent definition/subagent invocation translation
    cli/                 # clockwork doctor | pause | status | (phase 2: ui)
  plugin/                # Claude Code plugin: orchestrator skill + PreToolUse hook wiring
    skills/orchestrator/ #   the brain of the system (markdown)
    hooks/hooks.json     #   guard hook registration
  assets/
    playbooks/           # web-saas.md, cli-tool.md, ... (+ template)
  golden-paths/          # GP-1, GP-2 scenario definitions + "passed" thresholds
  docs/                  # CONCEPT.md, ROADMAP.md, (later) schema references
```

Critical boundary: not a single line about Claude Code leaks into `core/` — the platform-independence principle (CONCEPT §4.1) enforced at the directory level. Testable rule: `core/` talks only to the file system and its own types.

## 2. Coding Methodology

1. **Core first, pure functions first.** The `ledger` state derivation ("event list in → state out") and `spec` validation are pure functions → written with TDD. The "recomputability rule" from CONCEPT §9 is the first unit test.
2. **Intelligence in markdown, mechanics in code.** Orchestrator behavior is skill text; the code only does enforcement (hooks), recording (ledger), and translation (adapter). When the "should we write this in code or in the skill" dilemma arises: must be deterministic → code; requires reasoning → skill.
3. **Golden paths are the regression gate.** GP-1/GP-2 are run whenever the core changes; the threshold numbers (interventions ≤ N, deviation ≤ X%, ≥2 of 3 runs) are calibrated in the first runs and written under `golden-paths/`.
4. **Developed with Claude Code** — we cannot build clockwork with clockwork (it doesn't exist yet), but trying it on itself (self-hosting) at the end of each milestone is a long-term goal; GP-2's "produce a Claude Code skill" scenario opens that door.
5. **Docs and code move together:** every PR that changes a schema also changes the reference in docs. (Once the spec skeleton in CONCEPT becomes "a shadow of the real schema", the JSON Schema becomes the single source and CONCEPT points to it.)

## 3. Phase 1 — MVP Build Milestones

Ordering follows dependencies; every milestone has an **exit criterion**.

### M1 — Skeleton + spec core
- Repository structure, TypeScript/test infrastructure, `core/spec`: JSON Schema, YAML loading, validation, versioning (`spec.vN.yaml`), amendment schema + impact-analysis data model.
- **Exit:** sample specs validate; an invalid spec is rejected with a meaningful error; an amendment can produce `continue/cancel(+sunk_budget)/new` between two versions.

### M2 — Ledger + state derivation
- Event dictionary (closed, versioned; families: run/spec/unit/agent/interaction/budget/escalation), append-only JSONL writing, **pure state derivation** (per-unit mini-machines + the derived orchestrator view + deadlock/`blocked` derivation), redaction filter (secrets), version stamp.
- **Exit:** the "read events → derive state → compare with expected state" test suite passes; the CHANGELOG projection can be produced.

### M3 — Budget telemetry + retro record
- `core/budget`: per-unit spend meter (from ledger `budget.*` events), target/actual report. `core/retro`: record schema (signals per unit+role, context information, user decision) and its writing during RETRO.
- **Exit:** at the end of a run, the per-unit cost breakdown and the retro file are produced automatically.

### M4 — Claude Code adapter: hooks + spawn
- `owns` enforcement (PreToolUse: out-of-scope writes are blocked), permission-class gates, budget ceiling; spec → subagent translation; pause/kill switch (graceful stop at a unit boundary); worktree isolation + integrator role.
- **Exit:** deliberate violation scenarios (out-of-scope write, attempted class 3 action, ceiling overrun) are actually blocked.

### M5 — Orchestrator skill v1
- The entire lifecycle as markdown: INTAKE (environment probe + doctor) → RESEARCH (budgeted) → CLARIFY (batched) → DRAFT → NEGOTIATE (critic + dry-run cost preview + milestone list) → EXECUTE (scheduler, escalation ladder, soft/hard milestones, amendment) → RETRO (handoff report). Includes the handoff-from-ledger (context exhaustion) behavior.
- **Exit:** an end-to-end run completes on a small job; when the session is killed and restarted, it resumes from the ledger.

### M6 — Golden paths + calibration + packaging
- The GP-1 (URL shortener) and GP-2 (playbook-less: small CLI/skill) scenarios are written, run 3 times each, thresholds calibrated; the first playbook (web-saas) + the playbook template; plugin packaging; `clockwork doctor`.
- **Exit = MVP definition:** GP-1 and GP-2 "pass" with calibrated thresholds; the plugin installs and runs with a single command.

## 4. Phase 2 — Reliability and Economics (summary work packages)

1. **Budget management** — DONE 2026-07-16: model-tiering + budget-scaling rules in the
   orchestrator skill (criticality × budget; thorough bias buys verifiers first),
   fed by recall's estimation calibration.
2. **Learning loop** — DONE 2026-07-16: `core/recall` (retro consumption, experience
   prior with calibration/norms/warnings/confidence), playbook provenance mechanics
   (confirmations, auto-draft→confirmed promotion), `clockwork recall`, SKILL wiring.
3. **Management panel** — DONE 2026-07-16: `packages/panel` (ledger projection +
   file-based control channel, localhost-only, zero deps), `clockwork ui`.
4. **Capability strategy** — DONE 2026-07-16 (static set): vetting gate
   (`core/capability`, hard rules + permissions card, `clockwork vet`), hash-pin
   validation, private library (`clockwork library`, default `~/.teamsmith/library`).
   Remaining from this package: live find-skills/ecosystem integration and the
   skill sandbox trial (needs network/adapter work).
5. **Class 2 execution:** gated external operations (staging, sandbox API, private
   repo creation) + runbook generation. BLOCKED on the live plugin-hook validation.
6. **Council (optional):** only if the decision-rationale data in the ledger says
   "a single model is insufficient". No such signal in 5 runs — stays closed.

### Wave 2 — DONE 2026-07-17
- **Brownfield mode + GP-3**: `golden-paths/gp-3-brownfield.md` (feature-add on the
  GP-1-built URL shortener; regression gate / baseline-first / byte-identical
  behavior thresholds), `assets/playbooks/brownfield.md` (builtin, composes with
  type playbooks), SKILL brownfield branches (INTAKE baseline via assumptions —
  no fake event types; DRAFT minimal-touch owns + PRESERVED contracts; EXECUTE
  regression gate: old-test edits are findings). GP-3 not yet run.
- **Panel command channel**: `core/commands` (closed dictionary, JSONL + cursor),
  panel Q&A/checkpoint/note UI + `GET/POST /api/commands`, `clockwork commands
  pull|peek`, SKILL consumption rule (scheduler rounds + milestones + right after
  blocking waits; commands are requests — state changes only via ledger events).

### Wave 3 — DONE 2026-07-17
- **`clockwork audit`**: `core/audit` — secret scan reusing the Redactor (no
  pattern duplication; any secret → reject, exits nonzero), tolerant
  `npm audit --json` parsing (critical/high → caution, a user decision), single
  card output. SKILL security gate now runs it before the adversarial verifier.
  Known gap (documented in SKILL): multi-line secrets (PEM) evade per-line scan.
- **`clockwork gp verify`**: `core/gpcheck` + `golden-paths/thresholds/gp-*.json`
  (versioned machine-readable thresholds) — mechanical rows checked from the
  ledger (outcome incl. retro cross-check, budget deviation, execute-scoped
  interventions, anomalies, ledger errors, optional rework/team caps); human-
  judgment rows listed as `manual`; overall is never a bare "pass" while manual
  rows remain. Verified against the real GP-3 evidence bundle.

### Backlog — future discussion
- Golden-path FULL automation (wire orchestrated GP runs into `claude plugin
  eval`; `gp verify` is the building block).
- Second adapter (the platform-independence proof) — planned as the first
  Phase 3 item once the live hook + Class-2 package close.
- Small polish: YAML colon-space hint in `spec save`; milestone schema
  extension; multi-line secret scanning.

## 5. Phase 3 — Expansion (summary)

- A second adapter (a non-Claude CLI/API) — the real test of `core/`'s platform independence.
- Continuous-operation mode (monitoring/analytics/mail loops; scheduled + event-triggered).
- Hosted panel (team usage); productization for a non-developer audience.

## 6. Decision Record (specific to this document)

| Decision | Rationale |
|---|---|
| TypeScript/Node | The runtime is already on the target audience's machine; the code surface is tools/hooks/CLI, not ML |
| Monorepo, `core/` isolated | Platform independence enforced at the directory level |
| Tight dependency budget | Minimal supply-chain surface + installation friction |
| TDD only in the pure core | Ledger/spec are pure functions — cheap and valuable; skill text cannot be unit-tested, it is measured via golden paths |
| Amendment complete in the MVP | The first user changes their mind in the first run; flexibility is the thesis itself |
| Council out of the MVP (maybe never) | A separate hypothesis; not added unless ledger data justifies it |
