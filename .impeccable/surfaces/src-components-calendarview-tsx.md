---
version: 1
slug: "src-components-calendarview-tsx"
primary_target: "src/components/CalendarView.tsx"
related_targets: ["src/components/calendar.css","src/components/calendar/CalendarTaskRow.tsx","src/lib/calendarModel.ts","src/lib/tasks.ts","src/store/calendar.ts","src/store/tasks.ts"]
---

# Calendar workspace

Primary target: src/components/CalendarView.tsx
Related targets: src/components/calendar.css, src/components/calendar/CalendarTaskRow.tsx, src/lib/calendarModel.ts, src/lib/tasks.ts, src/store/calendar.ts, src/store/tasks.ts

## Scope and authority

Mode: Operate. A local planning and dated-note workspace inside the existing Synapse shell. The user requested a complete redesign and optimization on a separate branch and explicitly delegated all scoped application decisions. Composition and implementation choices are resolved autonomously; the incumbent PRODUCT.md, DESIGN.md, Inter family, theme tokens and familiar desktop controls remain the visual authority. Build path: code, as recorded in .impeccable/config.json.

Preserve daily notes and their dates, metadata-only note browsing, task completion per recurrence occurrence, times, repeat rules, colors, tags, explicit task editing, iCal reading and deliberate CalDAV sending. Never add demonstration entries to the user's vault. Empty, loading, sync-error, crowded-day and narrow-workspace states are required.

## Direction contract

THESIS: A date is one shared context for planning and writing. Selecting a day reveals its plan beside the calendar, without interrupting browsing with a modal. Month, week and list views use one navigation anchor.

OWN-WORLD: Existing dark and light semantic surfaces, Inter, quiet grid rules and violet selection. Amber identifies local plans; blue identifies external events; labeled note counts and journal marks distinguish writing. Controls use the existing compact desktop vocabulary.

STORY: Scan the month, select a date, read the day's tasks and notes, add a timed task or open that day's journal. Switch to the week for hourly planning or to the list for busy periods. Filtering hides entries consistently without changing stored data.

FIRST VIEWPORT: A compact title/action header and period toolbar sit above a dominant seven-column calendar. A docked day pane, about 320px wide, shows the selected date, a task composer and separated task/event/note lists. Small work regions prioritize the calendar and open the day pane as a labeled full-width region. The primary action is New task; Daily note belongs to the chosen day.

FORM: Grounded structure 5, calendar canvas plus persistent day plan, from the seven-candidate set: day agenda with mini-calendar; full hourly week; note-first date browser; journal activity atlas; calendar canvas plus day plan; chronological period list; split journal and task lanes. Seed c5d2ade7 dealt 5, 3, 1. The delegated choice is 5. Signature interaction: a selected date stays visually linked to its plan across all three views. External catalog challengers are declined because their topology reduces calendar clarity; their density discipline informs bounded rows, not a new identity.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Performance acceptance

Index note dates once per tree revision; selecting a day and navigating periods must not reread Markdown or rescan the vault. Expand task/event occurrences once for the visible date range. Bound lists and cell previews. No polling or animation loop while idle; only a midnight clock update and explicit/stale calendar synchronization. Measure model cost and mounted DOM on synthetic large libraries; report hardware and scenario limits.

Stability follow-up preserves this visual contract: one midnight timer with focus/visibility recovery, timezone-aware date cache invalidation, offline feed backoff, and an application-level task exit barrier. IANA/UTC recurrence, nonexistent month dates, WKST, individual moves/cancellations and all-day DST ends are covered by regression fixtures. The model soak, browser cycles and installed-bundle limitations are recorded in `docs/CALENDAR_WORKSPACE.md`.

## Implemented extension

The direction contract and seed above remain the provenance for this scoped Operate extension. The built calendar uses the established dark semantic palette and Inter family, with amber local tasks, blue external events, lavender writing marks and violet selection/focus. OWN-WORLD's light-surface language is resolved as local token compatibility: mobile-light.png injects synthetic semantic tokens into the review fixture. The application still ships its dark palette, and no global light theme is added.

The built day plan is (310px) wide on large Calendar containers; it replaces the canvas at (1000px) and below when opened. The other Calendar container thresholds are (1100px), (720px) and (450px), governing preview times, wrapping and narrow density. The plan preserves separate journal/composer/task/event/note regions. Metadata queries match task title/tags, event summary/location and note title/folder/tags; journal and earlier same-date history retain their date context separately from that query.

Source bounds are explicit: 42 month dates, seven week dates, at most two combined month-cell previews, 24 fixed (63px) hour rows with at most two combined timed previews and overflow inside a (57px) preview stack, and 20-item pages per day-section list. The weekly all-day band and monthly list separately preview up to two tasks and one event. Task tags show three summaries plus overflow; earlier same-date history stops at six records. These bounds preserve detail access through the selected-day plan.

The Calendar CSS font reset gives ordinary action/task-title/week-chip buttons the workspace's inherited text size. More-specific mode/search/composer and editor-field rules retain their compact roles. The detector's (26px) and (19px) headings express page/period hierarchy; (9px) month-cell times/counts and (8px) narrow hour labels are ancillary and have accessible date/count labels plus a full day-detail path. Overridden small week-chip declarations are not promoted into normative rendered type. These are local density observations, not a replacement global type ramp. The earlier emoji-font warning was resolved with the existing emoji stack, and no new detector pass was run for documentation.

## Acceptance evidence and limits

The six required synthetic captures are .impeccable/review/desktop.png, week.png, agenda.png, narrow.png, narrow-day.png and mobile-light.png. The three desktop views are (1400 × 900), the two narrow views (720 × 800), and the synthetic light compatibility view (390 × 844). All were valid and opened for the completed review. They are review evidence, not shipping raster assets; this extension introduces no new shipping raster. Captures are JPEG-encoded images stored under the established .png evidence filenames.

Evidence directory: /Users/kirill/.codex/visualizations/2026/10/11/01a12849-ce30-7e52-a0d6-a6e878a2b01f/calendar-redesign.

- finish-review.md initially returned disposition fix and identified three material issues: period navigation after an adjacent-month selection, compact focus continuity and mixed crowded-hour containment.
- verdict-review.md returned disposition ship for exactly those three fixes. Navigation uses the displayed anchor, compact opening focuses the day heading and closing/Escape restores a visible date target, and the mixed hour retains two previews plus +1 within its hour. No regression was observed in those six recaptures and the sampled fix code. This is not an exhaustive whole-app or recurrence/ICS runtime review.
- review-fix-qa.json records both adjacent-month directions, heading/open and selected-date close/Escape focus, and two contained mixed-hour previews plus overflow. review-fix-tests.log records 130 passing core tests, including the copied corpus checks. native-build-reviewed.log records a successful release build and Synapse.app bundle; installed-app verification remains parent-owned and pending at this documentation handoff.
- functional-qa.json records timed creation, repeat interval, per-occurrence completion, delete/undo, date jump, tag search, note opening and return context in the supplied scenario. Its instrumented 530-note scenario recorded zero note reads and five explicit writes. That observation is scoped to the measured scenario rather than proof of zero I/O across the whole application.

benchmark.json compares baseline 664129e with the completed model on 50,000 synthetic notes, 5,000 recurring tasks and 42 visible dates. Equivalent recurrence work produced the same 143,359 occurrences, with median cost reduced from (164.705ms) to (18.369ms). Cold note-index cost was (35.673ms), cold visible-task index (16.238ms), and warm model median/P95 (0.00525ms / 0.006708ms). These are host-local model measurements; the saved JSON does not identify hardware/runtime, and it does not measure frame rate, battery, all DOM work or installed-app behavior. The model caches note metadata by immutable tree revision and at most four task/event ranges per immutable source revision; browsing source does not read Markdown bodies.

Current source was read directly because the global Synapse graph index is bound to the primary checkout and predates these worktree files. Exact worktree paths were missing from coverage; original indexed paths pointed to the primary checkout. No complete-graph claim supports this documentation. Existing non-Calendar tokens, snippets and surface guidance were preserved; no unrelated design drift was repaired.

## Installed delivery

Parent verification completed after the documentation handoff: the canonical /Users/kirill/Applications/Synapse.app opened the real Calendar immediately, all three modes worked, and the selected 2026-10-04 day displayed 56 actual notes with bounded pagination. The installed screenshot and native-qa.json are local evidence outside Git. All 598 source-snapshot files kept identical hashes; 8 native tests and deferred-startup checks passed. Native installation does not expand the finish review's three-fix scoring scope.
