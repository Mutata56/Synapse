---
version: 1
slug: "src-components-writingdashboard-tsx"
primary_target: "src/components/WritingDashboard.tsx"
related_targets: ["src/components/dashboard/overview.css", "src/components/dashboard/OverviewAnalytics.tsx", "src/lib/overviewModel.ts", "src/lib/overviewWords.ts"]
---

# Overview

Mode: Operate. The user requested a complete redesign, rethinking and optimization in a separate branch, and explicitly delegated all decisions without approval rounds. This is a code-led application surface inside the established Synapse visual system.

## Direction contract

THESIS: A useful starting point for a local knowledge base: resume work, find recently changed notes and move into collections. Detailed writing analytics is a second mode rather than the opening task.

OWN-WORLD: Preserve the existing Inter/system typography, dark theme roles and configurable accent, violet actions/selection and mint tags. Flat work areas and quiet separators organize real content. No shipping raster or decorative motion.

STORY: Continue the current or latest note, create a note or daily entry, search through the existing palette, open a collection/tag, or inspect activity and optional analytics.

FIRST VIEWPORT: A compact header and two mode tabs; one featured continuation with a daily-note action beside it; a wide bounded recent-note list with a 30-day activity filter; a narrower collection and topic rail. A day click selects matching recently changed files and Escape/clear restores the list. Empty, loading and error states keep actionable recovery controls.

FORM: Split workdesk, candidate 3 of seven grounded structures; concept seed 7a1c2b96 dealt 3, 5 and 7. Candidates 5 (topic-led) and 7 (maintenance-led) were considered under the user's delegated decision authority. The workdesk was selected for the user's mixed study and warehouse-software vault. The signature interaction is the activity strip filtering the adjacent note list with one click. Standard buttons, tabs, inputs and keyboard focus stay familiar.

QUALITY BAR: The incumbent Synapse system recorded in DESIGN.md and the current Tags interface is the quality reference. No separate catalog world card or approved raster comp was selected: this is a code-led surface in that established system. The reproducible roll output is `overview-concept-roll.txt` in the task artifacts; reproduction uses `--from 7a1c2b96 --candidate-count 7`.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Performance and truth constraints

The opening mode reads metadata only. Keep note/favorite/topic results bounded, share derived collections, and load analytics on demand. Word-count caching must inspect every note id and content timestamp; length plus largest timestamp is insufficient. Activity means files grouped by their last modification date, not an edit log. Word charts show the current text of notes grouped by creation date, not a historical record of writing. Never create a daily note until the user clicks its action. Existing note/source preservation and the app shell remain intact.

## Finish and documentation status

Completed on 2026-10-11 for the reviewed Overview surface. `overview-finish-review.md` recorded the initial findings; `overview-finish-verdict.md` confirmed the type, narrow-target and unavailable-total fixes and identified an axis regression. `overview-finish-verdict-final.md` confirms the sticky opaque Y-axis fix and has `disposition: ship`. That verdict covers the scored fixes, not every possible application state.

The final evidence matrix remains five captures: workdesk at 1440×900, 1280×720 and 390×844; analytics at 1440×900 and 390×844. Controls retain their explicit type hierarchy; date and chart targets have at least 24px width, horizontal scrolling reveals the current period, and the numerical scale remains visible on narrow analytics. Error checks show unavailable word totals after both first-load and refresh failure, with valid totals restored on retry. The single detector pass produced advisories; no detector value was canonized as a system rule. The recorded roll independently confirms seed 7a1c2b96 and dealt structures 3/5/7; structure 3 remains the delegated choice.

[docs/OVERVIEW.md](../../docs/OVERVIEW.md) records the shipped source boundaries, metadata-only workdesk, exact shared word cache, statistical meanings, fixture reproduction and limitations. Evidence checked includes the current Overview components/styles, model/resource/format sources, existing App and CommandPalette integration, tests and saved final logs. All nine Overview regressions passed within the 56-test suite before integration. The delivery branch now combines completed Overview, All Notes and Images implementations; `all-tests-integrated.log` records 71/71 passing, zero failures and zero skips. `overview-app-build-integrated.log` confirms TypeScript/Vite and a completed macOS app bundle. Installation and launch of the installed app are separate verification responsibilities and are not claimed here.

The integrated App bootstrap no longer imports or unconditionally invokes `wordCountsFor(flatNotes)`. It retains `warmIndex(flatNotes)`, which may read Markdown bodies to warm full-text search. Optional Overview word counting begins with the explicit text-volume metric. Metadata-only describes the workdesk model and widgets, not all application startup I/O; the browser fixture's word-request counters do not measure native search warming.

After integration, PRODUCT.md, DESIGN.md and the schema-2 `.impeccable/design.json` are the inherited incumbent from the completed All Notes branch. They were rechecked without modification; the saved pre-integration PRODUCT.md/DESIGN.md snapshots remain in the task's `incumbent-documentation` artifacts. The inherited library extension leaves prior palette entries and global type roles intact, and no global token or `src/index.css` rule was changed by this documentation pass. The Overview composition and its local type sizes remain surface decisions. No shipping raster needs provenance; review captures are local evidence and may contain private vault content. The same five Overview captures and finish verdict remain applicable to the unchanged surface implementation.

Dark-theme captures are the verified visual evidence; light-theme support is not established. Fixture render timings are React Profiler measurements, not native startup, disk latency, FPS or battery measurements. The optional private `overview-vault.json`, review captures and task artifacts must remain outside commits/publication. Existing bundler chunk-size warnings and detector advisories, including incumbent CommandPalette small-type guidance, were recorded without changing unrelated surfaces or turning them into new design rules.
