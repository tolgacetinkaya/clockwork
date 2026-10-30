# Companion and language packs

Clockwork includes an original desktop companion. It observes the
same SSE snapshot as the screens; it does not run another agent or make model
calls. Its expression and summary reflect recorded work, connection health,
operator input, and combined verification. Process liveness is not inferred.

Open the companion to inspect accepted-task progress and jump to the relevant
work or decisions. Choose a character, silence announcements, or collapse it to a
small launcher. Reduced-motion preferences are respected. Recorded demos and
stale connections are explicitly distinguished from current execution. Accepted
tasks alone never imply that the final integration passed verification.

The native preview runs outside the browser through Electron; see
[desktop companion](desktop-companion.md). Windows rendering and pointer dragging
have runtime verification; macOS and signed installers remain unverified. The browser
no longer mounts a duplicate pet. OS notifications are not implemented.

## Languages

The language selector offers English plus Turkish, Spanish, German, French and
Brazilian Portuguese. The browser's preferred supported language is used initially;
an explicit selection is stored locally and survives reloads. Storage failures
must not prevent the interface from working. Numeric and time presentation follow
the selected locale. Language changes do not reset a plan or change execution.

Only interface copy is translated. Goals, task descriptions, agent output,
commands, paths, verification evidence, and raw backend diagnostic messages remain
as recorded. The panel never sends them to an external translation service.

English source messages form the fallback catalog. Translated catalogs live in
`packages/panel/client/locales/`, grouped into shell, screens and companion copy.
Use `t("Message with {count}", { count })` rather than concatenating translated
fragments. Preserve placeholders exactly. Keep protocol values, IDs, CSS classes
and status discriminators independent of translated labels. Components subscribe
through `useI18n`; pure display helpers may call `t` at invocation time.

When contributing a language, include the complete catalog, matching placeholder
names, locale-aware formatting and accessible control labels. Run the catalog and
rendering tests and inspect long translations on a narrow viewport. These initial
translations are open to native-speaker review.

## Original character artwork

Piko uses an original transparent front-view atlas with twenty poses across five
rows: idle/blink, walking, work/focus, attention/wave and success/hop. CSS selects
the atlas cells; Motion animates the remaining original raster characters. Sprite
artwork and state policy remain separate. Deliberate native dragging selects walk
frames; recorded demos and historical successes never invent live work or a fresh
success reaction. Reduced motion freezes the first idle frame. No remote image
requests or executable pet plugins are loaded.
