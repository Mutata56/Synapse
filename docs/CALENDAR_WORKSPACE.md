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

Task loads are shared. Accepted edits are serialized and published after an atomic file write succeeds. Read or write failure preserves the last durable state and exposes recovery. A corrupted `.tasks.json` is reported instead of being treated as an empty file. The application exit barrier drains the store's complete write queue even after Calendar unmounts. Changes accepted while the barrier waits are included; a rejected write keeps the application open for retry. Native menu, tray and Dock/system Quit share this path. The existing note-editor navigation flush still has its two-second timeout; the task exit barrier has no such timeout. Forced termination and power loss remain outside this graceful-exit mechanism.

iCal requests for the same feed share one promise. A replaced/disconnected feed cannot publish a late result. Successful feeds remain fresh for five minutes; Calendar has no polling loop. Foreground checks back off for 30 seconds after a failure; explicit Retry and changing the feed bypass that backoff. The single midnight timer rearms on both focus and visibility recovery, including after wake or a clock change. Changing the system zone invalidates local note/event date indexes and reparses the retained feed locally without an extra network request. iCal is read-only; CalDAV sending remains an explicit action in Calendar connections.

IANA TZID uses the runtime's timezone database. UTC repetitions remain UTC; floating times and DATE values follow the machine's zone. Monthly/yearly repeats skip nonexistent dates without consuming COUNT, weekly intervals honor WKST (Monday by default), and EXDATE removes an occurrence while retaining its COUNT position. Single RECURRENCE-ID moves/cancellations replace the original slot. All-day ends remain at local midnight across 23- and 25-hour days. These decisions follow [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html), particularly sections 3.3.5 and 3.3.10. This remains a recurrence subset: custom VTIMEZONE aliases, RDATE, complex monthly/yearly BY* combinations and RANGE=THISANDFUTURE are not implemented. Unsupported timezone names report an error and preserve the last successful feed instead of silently using the machine's zone.

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

## Stability follow-up

The second pass reproduced three iCal failures before changing code: a New York event was seven hours early on this Moscow machine, a January 31 monthly series rolled into March 3/May 1, and a UTC daily series adopted the machine's DST offset. Regression cases now cover these, half-hour DST, ambiguous/gap times, finite historical COUNT, zero-duration meetings, cancellation/moves, timezone rebasing and offline focus backoff.

The exit integration test holds a real fixture file write for more than two seconds, accepts another task while waiting, and verifies both tasks are durable before exit is invoked. Repeated Quit calls share one request; a failed write blocks exit until a successful retry. This fixture does not write the user's vault. Clock recovery is tested with an injected clock and focus/visibility events; the physical Mac was not suspended by the test.

The final follow-up regression run passed 146/146 JavaScript tests and 8/8 native tests. The same-work recurrence benchmark remained 166.077ms before and 18.377ms after, with 143359 occurrences in both. Cold note/task index costs were 33.032ms and 16.368ms; the warm model median/P95 remained 0.005/0.007ms.

`node --expose-gc tools/perf/calendar-soak.mjs` traversed 480 periods and 32 metadata revisions with 50000 notes/5000 tasks. Retained model heap after explicit GC stayed around 23–24MB and ended 1.15MB below the warm-up sample. This is Node model retention, not a browser heap, native RSS or an hours-long physical session. The browser fixture recorded 50.7ms for its initial commit and 9.5ms added across the next two commits for day selection; 24 mode changes and eight metadata revisions retained 42 cells and 20 rows per selected-day source (about 1360 DOM elements), with zero note-body reads. Six Calendar remounts retained the selected date. The mode/revision and remount measurements have separate timelines because development hot reload reset the fixture between them.

The locally signed follow-up bundle was installed at `/Users/kirill/Applications/Synapse.app`; the previous bundle is retained in the private task artifacts. The installed executable SHA-256 is `5da148b52f61094994590f0c7fa9c03f72e72b37b8d6d56b0d9898e6a4afc842`. All 601 user source/attachment files kept identical hashes across the update. Native window/relaunch verification for this follow-up was blocked by the locked Mac, so successful compilation/signature verification must not be presented as a successful GUI launch. The prior application's process-family sample overlaps an uncontrolled user session and supplies no valid before/after battery or idle-CPU conclusion.
