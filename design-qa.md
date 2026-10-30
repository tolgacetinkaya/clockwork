# Mission Arcade design QA

Date: 2026-10-29
Reference: user-selected third Mission Arcade concept.
Scope: existing React panel, task overview, crew portraits, companion, shared dark theme. The live snapshot cache, Zustand UI store, SSE stream and guarded controls remain the application architecture.

## Fidelity review

| Surface | Review |
| --- | --- |
| Typography | DM Sans, strong compact task title, small labels with clear contrast; full task descriptions remain in the evidence drawer. |
| Layout | Compact icon navigation, segmented progress, rocky task route, crew cards, right-hand inspector and companion dock. Responsive single-column layout on small screens. |
| Palette | Charcoal surfaces, lime accepted states/actions, lilac selected and active states, semantic warning/error colors. |
| Asset quality | Original transparent fox, owl, turtle and puffin artwork plus generated terrain/platform assets. No remote image dependency. |
| Copy and semantics | English plus Turkish, Spanish, German, French and Brazilian Portuguese labels. User-authored task text remains in its original language. No invented activity, XP, model identity or verification evidence. |

Reference and rendered desktop captures were inspected together. Expected differences: the local recorded run has six accepted units, rather than the concept's partially completed example. Its legacy ledger does not contain the producer-plus-independent-verifier evidence required for delivery badges, so that strip is correctly absent. Existing saved companion choice is preserved; Piko is the default for new preferences. Route arrows only represent recorded adjacent dependencies; the inspector lists all dependencies.

## Findings and repairs

- P1: Long inspector text displaced the companion and evidence action. Fixed with concise summaries, bounded scrolling and persistent action; recaptured.
- P1: SSE-only Query observer emitted missing-query-function warnings. Explicit `skipToken` retains stream-owned cache updates; clean production load verified.
- P2: Accepted task class collided with global status styling. Scoped task-state classes now tint only the intended elements.
- P2: Mission cards repeated long source descriptions. Task titles and brief summaries now lead; full evidence remains accessible.
- P2: Narrow mobile navigation overflowed. Minimum item width corrected and retested at 390 pixels.
- P2: Six route nodes wrapped awkwardly at 1280 pixels. Grid sizing and terrain background sizing corrected and recaptured.
- P2: Mixed source encodings introduced broken Turkish characters. Corrected UTF-8 and verified rendered Turkish labels.

## Verification

- Full `npm run check`: type checks, production build, 503 tests across 57 files, and public-file checks passed.
- Follow-up type checks and 24 focused transport/quest/companion/locale tests passed after the final functional polish.
- Two additional overview render tests passed: accepted legacy tasks do not create unproven badges; all nine supplied tasks and an evidence action render; empty state is useful.
- Browser: task selection, dependency inspection, evidence drawer, Escape close, team/workboard navigation, language switching, companion selection/hide/restore verified.
- Desktop 1440x1024 and mobile 390x844 inspected. Production 1280-pixel layout also inspected. No page horizontal overflow. Fresh production tab has no console warnings/errors or missing inline images.
- Docker rebuilt and healthy on the existing local port. Persistent data hash was identical before and after replacement (six files). Previous image retained for rollback.

Evidence captures are kept in the local QA artifact folder: `arcade-desktop.png`, `arcade-mobile.png`, `arcade-docker-desktop.png`. They are review artifacts, not bundled application assets.

## Boundaries

Browser acceptance used the recorded demo, not a new paid/live agent execution. Existing automated transport and state tests cover ordering, reconnect admission and evidence rules; no claim of a new end-to-end Codex execution is made. Companion movement is state-driven 2D animation, not a native desktop pet application.

Final result: passed. Final production recapture shows all six route nodes in one row at 1280 pixels, the inspector and companion at 1440x1024, and no console warnings or errors.
