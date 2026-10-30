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


## Responsive and roster follow-up

The user reported large side gutters on an ultrawide monitor and repeated crew portraits. Removed the 1800px content cap and inherited centering. The crew heading now sits outside the card grid, so spanning headings cannot keep empty columns alive. Recorded crew uses six columns on wide screens, three on laptops, two on tablets and one on phones; fewer cards can expand into unused tracks. Task titles and descriptions now have separate block styling. Crew portraits are larger.

Added original transparent rabbit and red-panda artwork. Six roster identities receive six distinct portraits shared by Team and Overview, independent of activity ordering or role/status changes. Rosters larger than six reuse the palette; changes in roster membership can change the deterministic allocation. Species do not imply agent roles.

Validation: client/server type checks, 10 focused projection/render tests, public-file checks and Docker production build passed. Browser measurements at widths 3778, 1920, 1440, 768 and 390 showed no page overflow; 1920 renders six cards on one row, 1440 three per row, 768 two, and 390 one. Mobile task drawer and Escape close passed. All six production portraits loaded and the production tab had no console warnings/errors. Docker is healthy; six persistent files have the same data hash before and after the update.

Follow-up result: passed. Evidence: `arcade-responsive-team.png` in the local QA artifact folder.


## Motion and gamification follow-up

Added Motion for React 14.7.1: shared reduced-motion and document-visibility policy, cosmetic portrait breathing, identity-keyed crew entrance, spring task/platform selection, tap/hover feedback, state-color transitions and inspector transitions. Activity rings only animate for recorded working/verifying tasks in an active live workspace. The companion has idle/working/verifying behaviors, event-based alert/success reactions and an accessible click/Enter/Space interaction with a jump and short heart/sparkle burst. Initial or replayed historic outcomes do not trigger success reactions. All variants retain original raster artwork; these are 2D motion puppets, not newly rigged 3D characters.

React review: stable identity keys, shared visibility subscription with cleanup, no new polling/fetching, no per-frame React state updates, accessible native buttons, hidden decorative particles, and preserved localized text. Reduced-motion removes transforms and particle bursts; hidden documents suspend loops. Pure state tests cover disabled motion and historical-vs-explicit celebration policy. Browser system preference emulation was not performed.

Validation: both server and client type checks, all 134 panel tests across 20 files, public-file checks and Docker production build passed. Browser verified moving transform values over time, three particles after click/Enter, task inspector selection, no activity ring in recorded demo, 1440px and 390px layouts, and no console errors/warnings. Initial JS bundle increased from approximately 138KB to 185KB gzip; Vite reports its default uncompressed 500KB chunk-size advisory. No network animation assets or extra backend subscriptions are needed. License notices ship with panel assets.

Motion follow-up result: passed. Evidence: `arcade-motion.png` in the local QA artifact folder. Browser verification used the recorded demo; actual live state behavior is validated by existing companion-state and motion policy tests.


## Floating companion follow-up

The companion is now mounted once at the application boundary and portaled to a fixed browser-viewport layer. Its handle supports pointer capture for drag and arrow-key movement (16px; Shift64px), with reset and dock/float controls. Local placement preferences use a separate validated versioned key; existing creature and announcement preferences remain compatible. Position is committed at drag end or keyboard movement, not on every pointer event. Motion values update transforms without per-frame React renders. Window and element resize clamp the pet inside the viewport, including expanded settings; the scrollable panel retains a sticky toolbar. Dialogs remain above the companion.

Validation: server/client type checks and all139 panel tests across21 files passed. New boundary tests cover damaged storage, non-finite coordinates, negative positions, resize and undersized viewports. Browser verified actual pointer drag from(992,368) to(362,215), one ArrowLeft step to(346,215), reload persistence, navigation persistence with one companion instance, dock/float toggles, and390x600 viewport clamping with expanded settings. Fresh Docker tab: one floating companion, working keyboard movement, no console warnings/errors. Production build and public-file checks passed. Evidence: `arcade-floating-pet.png` in the local QA artifact folder.

Floating follow-up result: passed. Movement is within the browser viewport; cross-application desktop overlay requires a separate desktop host.
