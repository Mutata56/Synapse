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
