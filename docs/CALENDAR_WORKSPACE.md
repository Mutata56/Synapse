# Calendar workspace

The calendar combines local tasks, dated notes and a read-only iCal feed around one selected date. Month, Week and List use the same navigation context. Selecting a date opens its plan beside the calendar; work regions at most 1000px wide show that plan at full width and provide a return to the calendar. Opening and closing that region transfers keyboard focus to visible controls.

## Finding and planning a day

- Month uses a Monday-based six-week grid with bounded task/event previews and note counts. Arrow keys move the date focus; Home and End move within a week. Period arrows follow the displayed month, including when keyboard selection is in an adjacent month.
- Week has seven date columns and 24 hourly rows. An empty slot starts a timed task. Each hour shows at most two previews, retaining both task and event sources when present, plus an overflow action that opens the full day plan.
- List groups the current month's entries by date. Source filters, completed-task filtering and metadata search apply consistently to the visible entries and day plan.
- The day plan creates tasks, opens the selected day's journal and lists tasks, external events and notes. Editing a task changes its title, date, time, repeat interval/end, color and tags. Recurring completion belongs to the selected occurrence. The most recent deletion can be undone during the current Calendar visit.
- Long day lists use pages of 20 entries. Searching uses titles, note folders, task/note tags and event locations, without reading Markdown bodies. Opening a note explicitly uses the existing editor route.

Ordinary notes use their local creation date. Synapse daily notes use the ISO date in their deterministic `Дневник/<year>/<date>` path, so a backdated journal belongs to its intended day. Journal mood and writing streak remain available; previous years' entries are bounded to six suggestions.

## Loading and storage

Note-date indexes are weakly cached by the immutable tree revision. Task/event range indexes retain at most four visited ranges per source revision. Recurrences expand once for the visible range; day selection does not scan the full vault again. Daily and weekly task intervals jump directly to their occurrences using calendar-day arithmetic, independent of DST. Monthly repeats skip nonexistent dates such as February 31.

Task loads are shared. Accepted edits are serialized and published after an atomic file write succeeds. Read or write failure preserves the last durable state and exposes recovery. A corrupted `.tasks.json` is reported instead of being treated as an empty file. The mounted Calendar registers its accepted-write queue with the application's existing navigation/save-flush mechanism.

iCal requests for the same feed share one promise. A replaced/disconnected feed cannot publish a late result. Successful feeds remain fresh for five minutes; Calendar has no polling loop. The only clock timer updates the local day at midnight, with a visibility check after wake. iCal is read-only; CalDAV sending remains an explicit action in Calendar connections. The existing iCal parser's supported recurrence subset and machine-local treatment of floating/TZID dates are unchanged.

## Performance evidence

Measured on this Mac with `node tools/perf/calendar-benchmark.mjs 664129e`; these are JavaScript model timings, not frame-rate, battery or universal hardware guarantees.

| Scenario | Result |
| --- | --- |
| Identical recurrence work, 5000 mixed daily/weekly/monthly tasks | 164.705ms before; 18.369ms after; 143359 occurrences in both |
| Cold date index, 50000 synthetic notes | 35.673ms |
| Cold visible-range index, 5000 recurring tasks | 16.238ms |
| Warm model/range/day lookup | median 0.005ms, P95 0.007ms |

The browser fixture excludes application bootstrap, so its zero body-read counter describes Calendar browsing rather than all startup I/O. Native startup still has the application's other work. Synthetic data and light-palette compatibility are labeled on the review fixture; no synthetic entries are installed in the user's vault, and this work does not introduce a global light-theme setting.

## Validation

The final regression run includes the complete copied-vault corpus. Calendar cases cover shared caches, leap dates, year boundaries, DST, monthly skipping, occurrence completion, multi-day event overlap and exclusive ends, task load/save failures, serialized edits, undo, accepted-write flushing and stale iCal results. Browser checks cover timed creation, repeat editing, search, note opening and restored date context.

Independent review requested three fixes: displayed-period navigation, compact focus continuity and crowded hourly previews. The verdict scored all three resolved. Captures cover Month/Week/List at 1400x900, a 720x800 work region and synthetic English/light compatibility at 390x844. The global palette and other surface design rules remain the existing Synapse system.

The final browser stress fixture held 50000 synthetic notes and 5000 tasks: 42 date cells, 20 mounted note rows, 20 mounted task rows and about 1356 DOM elements. React profiling recorded 52.6ms for the initial commit and 11.1ms added across the next two commits when selecting another day, with zero note-body reads. These are fixture render costs, excluding application bootstrap.

Delivery verification: 130/130 JavaScript regressions, 8/8 native tests, TypeScript/Vite and Tauri builds, deferred-editor/capture startup checks, and native Month/Week/List navigation passed. The installed app displayed the real 56-note day with bounded pagination; all 598 files in the pre-update source snapshot kept identical hashes.
