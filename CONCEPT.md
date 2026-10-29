# Clockwork — Concept Document

> Product name: **Clockwork** (formerly Teamsmith).
> Status: Ideation phase complete; design decisions largely locked in. No code has been written yet.
> Last updated: 2026-07-03

---

## 0. Vision and Positioning

The goal is not to produce a project; it is to offer an **agentic automation architecture** that anyone can use — one with an innovative outlook that lets people use any AI model more freely and easily in a **platform-independent** way, and that thinks through every professional detail. The user should be able to say "I stated the idea, and it did it."

**What we are not:** we are not a template factory in the style of vercel v0 / lovable, producing uniform projects from the same code infrastructure via deterministic rules. They do **template instantiation** (same infrastructure, different visuals); we do **synthesis from requirements** — the team, stack, and workflow are derived from the requirements of each project.

## 1. Problem

Existing agent automation repos are built on **static agent definitions**: a developer defines the roles, prompts, and workflow by hand in advance. The result:

- The system is not self-sustaining; it depends on continuous maintenance and updates by a developer.
- Every new project type requires a new hand-written agent definition.
- The team structure is shaped by the repo owner's foresight, not by the work itself.

## 2. Thesis

Whatever the content of the work, an agent team should be produced that is **shaped instantly and dynamically** according to the work being done. A superagent (orchestrator/team leader):

1. Analyzes the work described by the user,
2. Breaks the work into independent work units,
3. Produces a team suited to those units **at runtime** (role definitions, prompts, tool permissions, workflow topology),
4. Manages the run, verifies, learns.

This is not a framework but **a meta-system that produces agents**: "team-as-code, generated at runtime".

**Core insight:** The superagent's real intelligence lies not in spawning teams but in **work decomposition and contract definition**. Scale derives from the decomposability of the work, not from imitating departments: *"6 right agents > 40 random agents"*.

## 3. Target Audience and Scope

**Primary:** Technical users — developers, technical entrepreneurs, technically curious people who want to start their own business. Rationale: the distribution channel (GitHub repo / Claude Code plugin) reaches this audience. The spirit of the product is **power + transparency**; accessibility is a design principle, not a target audience.

**Project-type independence:** What the work actually is does not matter to the repo: web SaaS, mobile app, game, Chrome extension, macOS/Windows app, watch app, Claude plugin, AI model training/fine-tune, n8n automation, any AI-based system.

**Brownfield is a first-class scenario:** A significant portion of real usage will not be greenfield projects but **adding/changing features in an existing project**. This changes the decomposition (fitting the existing architecture, negotiating `owns` boundaries against existing code, regression risk), and the brownfield mode of spec generation is designed separately.

## 4. Architectural Principles

### 4.1 Platform-independent core + adapters
- The superagent first produces a platform-independent **team spec** (YAML); a thin **adapter layer** translates it to the target platform. First adapter: Claude Code.
- Other models/CLIs are added later via new adapters. When a platform API changes, only the adapter is updated.
- The same principle applies to memory, project understanding (graphify), the secrets vault, and the semantic index: all of them are adapters.

### 4.2 Visible and negotiated spec
- The spec is **visible and editable** to the user — the system's public contract. It has a schema, a version, and a validator.
- The superagent does not silently accept user edits: **critic behavior** ("you removed the review team; the risk is this"). The critic warns but **cannot veto**.

### 4.3 Producer-verifier separation
- Every work unit has acceptance criteria; verifier agents are prompted **independently of and adversarially to** the producer.
- The superagent proceeds based on verifier approval, not on a "done" claim. Verification is per-unit and continuous; there is no single review wave deferred to the end.

### 4.4 Budget is a first-class input
- The user provides a budget target; team size, model choice, and depth scale accordingly. Estimation is per work unit (`budget_est`) — deviations become attributable.

### 4.5 Minimum sufficient stack
- **Requirements decide; habit breaks ties.** Every infrastructure component in the spec must reference a requirement that necessitates it. An unjustified component is a finding the critic will flag. (Elasticsearch/RabbitMQ is not imposed on a small project.)

### 4.6 Assurance lives in the mechanism, not the prompt
- No assurance that could be left to prompt discipline is left to prompt discipline: `owns` boundaries, permission classes, and the budget ceiling are **actually enforced via hooks** (see §15).

### 4.7 Council structure — many minds for critical decisions
- **Triggered, not standing:** only for decisions with high leverage and expensive rollback (architecture, decomposition, stack choice, amendment impact analysis). Defined in the spec as `decision_gates`; the `bias` choice moves the threshold.
- **Different lenses:** members (cheap models) are not identical clones but different perspectives — cost, scalability, simplicity-advocate, risk. Correlated opinions are not diversity.
- **Independent-first:** members first produce opinions unaware of each other (an anchoring countermeasure), then the best 2-3 ideas are synthesized and presented to the chair (an expensive model). The chair produces the decision + rationale; **the rationale is written to the ledger** — making it measurable in retrospectives whether "council decisions were more accurate".
- **Status: not in the MVP, maybe never.** In the MVP a single strong model makes critical decisions; decision rationales accumulate in the ledger. The council is added only if that data says "single-model decisions are insufficient" — we are not committed to it.

## 5. Capability Strategy: find → vet → produce → accumulate

For every capability a role requires, the decision order is:

1. **The user's own assets** (global skills/hooks/agents/workflows discovered via the environment probe — the most trusted source, light vetting).
2. **The private library** (agent/skill definitions accumulated from past work).
3. **The ecosystem** (find-skills-style search) + **vetting gate (mandatory)**:
   - *Static reading:* SKILL.md and scripts are read; which commands, network access, writes outside the project, and credential access are extracted.
   - *Hard rules:* `curl | bash`, a combination that reads credentials and reaches the network, self-updating → rejected by default (the user can consciously override; the system does not silently accept).
   - *Pinning:* pinned by **commit hash**, not version tag (a tag can be moved, a hash cannot).
   - One card to the user: source, popularity, extracted permissions, decision + rationale.
4. **Produce** — and save to the private library. On the third use the system does not produce; it pulls from its history.

A user's global asset can be adapted to the project (a derivative, saved to the private library) but **the original is never touched** — modifying the user's global setup is a class 3 permission.

## 6. Memory Architecture

### 6.1 Project knowledge layer
- "What is in this codebase?" — for an existing codebase, a graph-based project understanding tool (e.g. graphify, as an adapter): the graph is extracted once, agents query the graph.

### 6.2 Experience memory layer
- "Which team structure worked for which type of work?" — **schema-backed flat files**: work type, spec, budget target/actual, verifier results, interventions, user decision.
- **Learning without signals learns noise:** every record is bound to success signals (§7) and "in what context was this correct" information.
- **Personalization scopes:** project / user / repo-wide. User preferences reduce CLARIFY questions over time; the §4.5 rule always takes precedence.
- **Semantic search: will not be used.** At this scale, structured filtering + a recall agent is more accurate; vector similarity finds "similar text", not "the right lesson". Records are kept as files with stable identities; if memory later fills with micro-lessons, a local embedding adapter can be added (the door is open, there is no plan).

## 7. Success Signals

The metrics belong to the system; the weights are set by the user's single "bias" choice (speed / cost / rigor).

- **Layer 1 — Process (automatic):** verifier results, deadlock-free completion, budget target/actual (per unit), **rework cycle count** (an indicator of bad decomposition), **human intervention count** (an indicator of bad role definition).
- **Layer 2 — Outcome:** a single-question user feedback at the end of the work + indirect signals (acceptance/abandonment/correction in the next session).
- **Code quality is not a separate axis** — it lives inside Layer 1 as part of the acceptance criteria.
- **Attributability:** signals are per unit and per role (to be able to say "the security verifier hasn't caught anything in 5 runs").
- **Goodhart countermeasure:** verifier prompts cannot be updated in the direction of "find fewer errors"; only via cross-validation with Layer 2.

## 8. Team Spec Skeleton

YAML (edited by humans), validated with **JSON Schema**. Versioning is file-based: `spec.v1.yaml`, `spec.v2.yaml` — the ledger references a version by hash.

```yaml
spec_version: 1
meta:
  goal: "..."
  assumptions: [...]           # includes OS/tool inventory, license assumption (default MIT), etc.
  open_questions: [...]

priorities:
  budget_target: 500k
  bias: thorough | fast | cheap

decision_gates: [architecture, decomposition, stack, amendment]   # decision types that go to the council

work_units:
  - id: wu-auth
    type: code | infra | content | research | ops
    description: "..."
    owns: ["src/auth/**"]
    contracts: [...]
    depends_on: [wu-db]
    acceptance: [...]
    budget_est: 40k

agents:
  - id: backend-builder
    purpose: "..."
    model_tier: standard | cheap | strong
    capabilities:
      skills: ["owner/repo@skill#<commit-hash>"]
    permissions: [...]

assignment:
  wu-auth: backend-builder

verification:
  per_unit: {...}
  global_gates: [integration, security]

checkpoints:
  gates:                       # risk-triggered, BLOCKING (class 2/3 actions)
    - trigger: external_service_connect | spend_over(X) | repo_create | deploy
      action: pause_and_ask
  milestones:                  # progress-triggered, REPORTING (see §9)
    - at: "backend contracts ready"
      mode: soft | hard        # soft: report + continue; hard: pauses until approval
    - at: "integration complete, test wave starting"
      mode: soft

retrospective:
  record: [signals_per_unit, spec_final, budget_actual, user_verdict, milestone_interventions]
```

Key rationales: `work_units` before `agents` (the staffing derives from the work); `owns`+`contracts` (conflicts are prevented at the spec stage); `assumptions`+`open_questions` (requests for missing information are formalized); per-unit `budget_est` (attributability); every infrastructure component references a requirement (§4.5).

**Amendment format:**
```yaml
amendment:
  base_version: 2
  initiated_by: user | system
  reason: "..."
  changes: [{unit: wu-x, action: add | cancel | modify, detail: ...}]
  impact:
    continue: [wu-a, wu-b]
    cancel: [{unit: wu-c, sunk_budget: 12k}]   # the cost of cancellation is visible — an informed decision
    new: [wu-d]
```

## 9. Lifecycle (State Machine)

```
INTAKE → RESEARCH → CLARIFY → DRAFT → NEGOTIATE → EXECUTE → RETRO → DONE
                       ↑                    ↑    ↓ (amendment)
                       └────────────────────┴── loops back from within EXECUTE
```

- **INTAKE:** goal extraction, similar records from experience memory, the project graph if one exists, **environment probe**: (a) the user's global assets (skill/hook/agent/MCP/workflow inventory + conflict check against our own hooks), (b) OS and tool inventory (Windows/macOS/Linux, installed tools, package managers → written to `assumptions`; a countermeasure against silent bash-assumption breakage), (c) **doctor self-check** (is the environment ready, ledger integrity, is there an interrupted run).
- **RESEARCH:** bounded: the list of questions comes out of INTAKE, one agent + budget per question, the phase ends when the list is exhausted.
- **CLARIFY:** questions are asked **in one batch** (including single-question items such as license preference).
- **DRAFT → NEGOTIATE:** the spec + a **dry-run cost preview** (estimated total cost/duration) + the milestone list are presented; the user edits (adds/removes/hardens milestones), the critic warns. On approval the spec is versioned and sealed into the ledger.
- **EXECUTE:** the scheduler runs units according to the dependency graph. Per-unit mini-machine: `pending → running → verifying → rework → accepted | failed`.
- **RETRO:** signals are written, the single-question feedback is collected, gains go into the private library, a draft playbook is produced if needed, and the **handoff report** is delivered (§12).

### Single source of truth
The orchestrator's state is not stored separately; it is **derived from unit states**.

### Ledger: event-sourcing
- The conversation context is NOT a state store. Every transition is written as an event to an append-only JSONL ledger: `{seq, ts, type, actor, unit_id?, data}`.
- **The event dictionary is closed and versioned** (free-text types are forbidden). Families: run, spec, unit, agent, interaction, budget, escalation.
- **Recomputability rule (testable):** the current state must be derivable solely from the events.
- Events are written by the **orchestrator**, not by agents.
- **Derived views:** the observability panel, the **CHANGELOG**, and reports are ledger projections — no second source of truth is kept.
- Every run is stamped with the **clockwork version** (reproducibility / diagnosing "it used to work").
- **Orchestrator context exhaustion (it will definitely happen):** the orchestrator operates under the discipline "my state is derivable from the ledger"; when the context fills, a fresh session takes over from the ledger (**handoff**). This is core behavior, not an afterthought.

### Checkpoint system: gates and milestones
- **Gate:** risk-triggered, blocking. Class 2/3 actions (external service, spending threshold, repo creation, deploy).
- **Milestone:** progress-triggered, reporting. The system derives milestones **from the natural boundaries of the dependency graph** (not from time/unit counts — the moments when changing a decision is cheapest are phase transitions), presents them with the plan; the user edits the count/placement.
  - **Default `soft`:** a report is produced (a ledger projection — cheap), delivered to the user, and independent units **keep running**. If the user wants changes, the amendment mechanism kicks in. Rationale: blocking at every milestone holds the wall clock hostage to the user's availability.
  - **`hard` can be flagged:** "wait for my approval before entering the frontend" — the system stops at that boundary.
  - Milestones are the batch-delivery moment for accumulated non-urgent questions (synergy with the question discipline).
  - The retrospective records "which milestones the user intervened at" → the system learns the user's preferred reporting frequency.

### Plan change: spec amendment
- Diff-based: new version + impact analysis (continue/cancel+sunk_budget/new). Goes through a mini NEGOTIATE round.
- **The system can trigger it too:** N reworks exceeded, budget deviated by X%, a wrong assumption surfaced → "the plan does not match reality; here is my proposal".

### Failure: four-step escalation
1. **Rework** (same agent, with verifier feedback, ≤N rounds) → 2. **Re-staff** (different prompt/model) → 3. **Re-decompose** (the unit is split, mini-amendment) → 4. **Escalation to the user**.
Step costs go to the ledger; the "which work type gets resolved at which step" data improves decomposition.
- **Deadlock is derivable:** units depending on a `failed` unit are automatically `blocked` → an amendment is triggered.
- **Budget exhaustion:** graceful stop at a unit boundary, delivery + a report of remaining work; if the user says "continue", it resumes where it left off.
- **Pause/kill switch:** the user can stop cleanly at any moment (at a unit boundary; safe resumption thanks to the ledger).

### Question discipline: two question moments
1. The batched CLARIFY at the start. 2. The urgent-question checkpoint during EXECUTE (the asking unit goes `blocked`, independent units keep running, questions are accumulated and delivered in batch at a milestone when possible). Agents have no direct right to ask questions — the right belongs to the orchestrator.

### Parallel code and merge policy
- `owns` prevents most conflicts; for shared files (dependency manifests, config, route tables) the policy is: parallel units run in **isolated working copies** (worktree logic), and write access to shared files is concentrated in a single **integrator** role.

## 10. Playbook Layer (Domain Knowledge)

Software lifecycle knowledge enters the system **as data, not as a pipeline**. The format is model-first: YAML frontmatter + free-form markdown body.

```markdown
---
id: web-saas
applies_to: [web app, saas, api backend]
version: 3
provenance: builtin | user | community | auto-draft
---
## Typical work layers
## Known couplings          # e.g. revenue model → DB schema + auth (hard to find by pure inference)
## Default quality thresholds   # e.g. 80% coverage; README + LICENSE as default work units
## Pitfalls
```

- A playbook is **prior knowledge, not a template**: the superagent discards what does not apply and adds what is missing.
- **Open set**, no closed list. **The system does not stop when there is no playbook:** it reasons from scratch, and the retrospective produces a **draft playbook**.
- **`provenance` rule:** auto-draft playbooks carry the draft stamp until a human reviews them or they prove themselves in a second successful run; the superagent weights them cautiously.
- Editable, versionable, **open to community contribution**.
- AI-era software topics (SEO/ASO/GEO, llms.txt, LLM integration, AI automation) **are code work** — the relevant playbooks live on the software side.
- The state machine is *process*, the playbook is *content* — if they are mixed, the system becomes static.

## 11. Execution Authority: Three Classes

| Class | Scope | Behavior |
|---|---|---|
| **1. Autonomous** | Local and reversible: code, tests, documentation, local docker | The system does it |
| **2. Gated** | External but low risk: staging deploy, sandbox API, test environment, **private repo creation** (GitHub/GitLab, default private) | Does it, but shows first |
| **3. Recommend-only** | Prod deploy, DNS/firewall/SSL, money-spending services, customer-facing communication, **making the repo public**, modifying the user's global setup | **Produces a runbook**; the user pulls the trigger |

The user can consciously demote an item from 3 to 2; that is never the default.

## 12. Security

### 12.1 Security of the generated code (`global_gates.security`)
1. **Automated scans:** dependency audit, secret scanning, SAST — tool runs, cheap and deterministic.
2. **Adversarial security verifier agents:** look at the logic errors the tools cannot find.
3. **Type-based threat model in the playbooks:** the threat model of a web app is not that of a CLI tool; the scan scope derives from the work type.

### 12.2 Secrets discipline
- We do not write our own crypto: the **OS vault** is used (Windows Credential Manager/DPAPI, macOS Keychain — an adapter).
- A secret **never enters spec/ledger/report as plain text**; ledger writing has a pattern-based **redaction filter** ("key received, connection test passed" gets through; the key does not).
- Builder agents have **network access disabled by default** (no egress means no leakage — blast radius).
- Access to a secret goes only to the unit that uses it (fewest agents, shortest duration, without persisting). Honest boundary: the using agent sees it in memory at that moment — the countermeasure is not "never sees it" but minimizing access.

### 12.3 Supply chain
- Third-party skill vetting + commit-hash pinning (§5). Sandboxed trial run is Phase 2.

### 12.4 Handoff report
- A single report at the end of the work: what was done, how to run it, assumptions, known limits, suggested next steps, budget breakdown, **license compliance** (license check of dependencies — a silent risk for a user targeting a commercial product). The final link in the "I stated the idea, and it did it" experience.

## 13. clockwork's Own Build Phases

> **Important distinction:** The phases here are **our plan for building clockwork**; they are NOT a methodology imposed on user projects. If the user says "build the full product", the decomposition is done for the full product; the superagent at most *suggests* scope phasing (critic behavior, not a veto).

### Phase 1 — Core (MVP): "from idea to a locally running product"
- Team architect core: analysis → spec → agent definitions + workflow → small-scale run (3–7 agents).
- Producer-verifier separation and the task ledger (non-negotiable), visible spec + critic, Claude Code adapter.
- **Budget telemetry:** per-unit spend is measured and reported (a meter exists, no smart spending — *optimization can be deferred, measurement cannot*).
- **Retrospective record writing:** from the very first run; the learning loop that consumes the records comes in Phase 2 (data cannot be collected retroactively).
- **`owns` hook + pause/kill switch:** parallel agents overwriting files will happen in the first run; an autonomous system that cannot be stopped is an untrustworthy system.
- **Full amendment mechanism:** diff-based change, impact analysis, `sunk_budget` — the first real user will change their mind in the first run.
- Scope: write code + test + bring up locally. Deploy/marketing is advice/report only.
- **Deliberately left out:** council (§4.7 — maybe never), model tiering, find-skills integration, management panel, learning loop.
- Rationale: scale is not increased before the quality of dynamic team generation is proven.

### Phase 2 — Reliability and economics
- Budget **management** (on top of Phase 1 telemetry): model tiering, scaling to budget.
- Learning loop: team-design improvement consuming the retro records accumulated since Phase 1.
- **Management panel** — with three design rules:
  1. *Projection + command issuer:* everything it shows is derived from the ledger; everything it makes happen is a command to the orchestrator. Zero business logic in the UI — the panel's feature set is the core's shadow, and the shadow cannot grow larger than the body.
  2. *Local-first:* a local web server (localhost) reading the `.teamsmith/` files; no cloud, data does not leave. A hosted panel is a Phase 3 topic.
  3. *File-based command channel:* panel → orchestrator communication via a command queue file the orchestrator watches (not HTTP) — platform-independent, works with every adapter.
- The full capability strategy (find-skills + vetting + private library); playbook library + auto-draft; class 2 work + runbook generation; skill sandbox.
- Council: only if the decision-rationale data in the ledger justifies it (optional).

### Phase 3 — Expansion
- Other models/CLIs (via adapters, budget-friendly multi-model).
- Marketing/operations: monitoring, analytics, mail loops — the transition from "a system that builds projects" to "a system that continuously operates the product" (scheduled + event-triggered mode). Thanks to the `type` field in the spec, the schema does not change.
- Hosted/shared panel (team usage).
- Productization for a non-developer audience (separate distribution).

> Detailed work packages, build order, and exit criteria: **ROADMAP.md**

## 14. Validation Harness (Golden Paths)

> **Important distinction:** Golden paths do not constrain the user — the user never sees them. They are **the regression test harness for clockwork developers**: whenever the core changes, "does the system still work end to end" is measured. The two scenarios being deliberately chosen as different types is a countermeasure against overfitting to a single type.

- **GP-1 (with a playbook):** a small URL-shortener web app — API + minimal frontend + DB + tests + dockerization. Multi-unit, a real need for `contracts`, objectively measurable acceptance.
- **GP-2 (without a playbook):** a type with no playbook (a small Claude Code skill or CLI tool) — the fallback and draft playbook generation are tested.
- **GP-3 (later, brownfield):** a feature-addition scenario on an existing project.
- **"Passed" is measurably defined:** all acceptance criteria + human interventions ≤ N + budget deviation ≤ X% + **reproducibility** (≥2 successes in 3 runs). The threshold numbers are calibrated in the first runs (pinning them down now would be speculative).

## 15. Claude Code Adapter Map

**Fundamental decision: the orchestrator is not a separate subagent; it is the main session itself.** Rationale: subagents cannot talk to the user directly; CLARIFY and NEGOTIATE are the very substance of user interaction.

| Spec part | Claude Code mechanism |
|---|---|
| Orchestrator behavior | Main-session skill |
| `agents` | Agent definitions generated at runtime / subagents with custom prompts; the ones that work go into the private library as files |
| `work_units` + scheduler | Orchestrator logic + deterministic fan-out (workflow) |
| `owns`, permission classes, budget ceiling | **Hooks** (PreToolUse: out-of-scope writes are actually blocked) |
| `checkpoints` | The orchestrator's user interaction (plan-approval logic) |
| Spec + ledger | Plain files inside the project (`.teamsmith/spec.vN.yaml`, `.teamsmith/ledger.jsonl`) |
| Packaging | **Plugin** (skill + hooks + commands in one package) |

## 16. Known Risks and Antidotes

| Risk | Antidote |
|---|---|
| Coordination cost grows super-linearly | Decomposition-first; `owns`/`contracts`; scale from decomposability |
| Errors accumulate silently across layers | Per-unit independent/adversarial verifiers |
| Third-party skill risk | Vetting gate, permission extraction, hash pinning, visible approval |
| Learning without signals learns noise | Success signals mandatory; context information embedded |
| Personalization overfits to the past | §4.5; acceptance of staleness |
| Goodhart | Verifier independence preserved in learning too; Layer 2 cross-check |
| Research phase burns money open-endedly | Question list + budget per question |
| Question bombardment | Two question moments; the right belongs to the orchestrator; batch delivery at milestones |
| "A black box is burning money" | Ledger panel; visible spec; dry-run cost preview; milestone reports |
| Playbooks make the system static | Prior knowledge ≠ template; open set; absence does not stop the run |
| The council multiplies cost, not opinions | Triggered use; different lenses; independent-first |
| Shared-file conflicts | Worktree isolation + single integrator role |
| Secret leakage | OS vault; ledger redaction; network-off default; least-access |
| Orchestrator context fills up | Handoff from the ledger — core behavior |
| Blocking milestones hold the run hostage | Default `soft` (report + continue), exception `hard` |

## 17. Open Topics

- Calibration of golden path threshold numbers (in the first runs).
- Details of the milestone-derivation heuristic (how a "phase boundary" is detected in the dependency graph).

Artifacts to be written (design done, production planned in the ROADMAP): the spec JSON Schema, the ledger event dictionary document, the first playbook (web-saas) + template, the orchestrator skill draft. Technology choice and build plan: **ROADMAP.md**.
