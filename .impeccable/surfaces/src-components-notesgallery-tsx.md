---
version: 1
slug: "src-components-notesgallery-tsx"
primary_target: "src/components/NotesGallery.tsx"
related_targets: ["src/components/NotesGallery.css","src/components/LibraryNoteCard.tsx","src/lib/noteLibrary.ts","src/components/useLibraryWindow.ts","src/components/TagReadingPane.tsx"]
---

# All notes library

Mode: Operate. The user wants a visual library with large cards and grouping. They requested a separate branch, chose working prototypes over image comps, and then delegated the layout choice and completion while they sleep.

## Direction contract

THESIS: A browsable library of note shelves, with visible sections, large useful excerpts and quick reading before opening the editor. Cards without covers use their content instead of a blank image block.

OWN-WORLD: Preserve Synapse’s dark semantic surfaces, Inter/system typography, violet focus and selection, mint tags, Lucide outline icons and thin dividers. No new brand or generated artwork.

STORY: Browse all notes or a collection, search titles/folders/tags, change sorting and grouping, glance at one note in a reading drawer, then open it. Favorite and recoverable bulk trash remain available.

FIRST VIEWPORT: A compact title/action row and searchable filter toolbar above section shelves. Three large excerpt cards fit a wide workspace, fewer at narrow widths. A reading drawer overlays the right work area and closes back to the same card.

FORM: Grouped shelves, grounded candidate 7 of 7, dealt lead under surface seed 96c2e7e2. A normal card click enters the editor; a separate eye button opens the reading preview without navigation. A viewport window renders only nearby card rows and section headings.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Performance and content constraints

The current vault has 530 notes, 65 note folders and no note covers or favorites. Metadata is indexed once per tree revision. Full bodies load only for the selected reading preview, and local/remote cover work occurs only for mounted visible cards. Keep Markdown and imported source untouched during browsing. Verify 50,000-note filtering/layout and bounded DOM mounting.


## Implemented surface and acceptance

Completed on branch `codex/all-notes-redesign`. The shelves direction remains candidate 7 with seed `96c2e7e2`. The finish coordinator reports the independent review disposition **ship** after its single fix pass: seed corroboration, visible viewport focus and measured-width scroll restoration were resolved. The review matched TYPE / MATERIAL / GROUND, accepted the captures and required no rebuild. The branch remains separate; native installation and smoke checks are recorded below.

- Card activation opens the existing editor. The separate eye button opens the bounded reading drawer; closing restores the connected trigger or viewport focus.
- Search, folder, tag and favorite filters combine with updated/created/title sorting. Grouping supports sections, exact folders or no groups; density supports large and compact cards.
- Keyboard navigation reveals and focuses windowed cards. Filtered bulk selection uses the existing recoverable trash action and confirmation.
- View preferences persist locally. Session search/filter/scroll context survives the editor round trip; restoration waits until measured content width and column layout agree.
- Metadata is indexed per tree revision, card rows and headings share one viewport window, and cover resolution is lazy for mounted visible cards. Card excerpts are cleaned for display without rewriting source content.

The actual visual roles are in the `library-` entries of `DESIGN.md` and the corresponding schemaVersion 2 sidecar extensions. The global palette/font/corner records and existing Tags extension remain intact. The detector ran once; its title/radius advisories were resolved to the observed title/card steps. Remaining local context steps and the reading-overlay shadow are intentional scoped choices, not additions to a global scale.

### Recorded verification

The final build and 54 tests passed. The documentation pass read the finished source and the following artifacts; it did not rerun the application tests. Browser QA uses a read-only copy of real metadata and synthetic preview bodies, so body-read counters below describe that fixture. The 530-note / 65-folder / no-cover / no-favorite inventory is a dated source snapshot, not a lasting product limit.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Desktop browsing | 1280 × 720 capture; 9 mounted cards; 0 body reads before preview and 1 after one preview | `all-notes-desktop.png`, `all-notes-preview.png`, `all-notes-qa.json` |
| Large vault | 50,000 notes; 9 mounted cards; last-record query returned 1 match; 0 body reads while browsing | `all-notes-qa.json` |
| Narrow work area | 390px width and scroll width; one column | `all-notes-narrow.png`, `all-notes-qa.json` |
| Keyboard / visible focus | Home and End reached their target cards; viewport has a visible focus outline | `all-notes-qa.json`, `all-notes-focus.png`, independent fix-pass result |
| Editor return / filters | `coalesce` search and 4 results restored; favorite filter returned one fixture-only favorite | `all-notes-qa.json` |
| Deep narrow return | One column remained 354px wide; scroll offset remained deep (157749 → 157769.5), rather than resetting to the top | `all-notes-scroll-regression.json` |
| Regression checks | 54 / 54 tests passed | `all-notes-qa.json`, `all-notes-tests.log` |
| Installed native app | Real 530-note library and read-only preview opened; repeat launch and window-close/reopen retained the same single process | `all-notes-installed.png`, `all-notes-installed-preview.png`, `all-notes-native-qa.json` |
| Source integrity after native verification | All 534 original Markdown file hashes remained unchanged | `all-notes-original-markdown.json`, `all-notes-native-qa.json` |

All filenames in this table resolve under `/Users/kirill/.codex/visualizations/2026/10/11/01a1284c-b380-7e01-8e7d-e59edb6bc9ba/`. The desktop, narrow, preview and focus captures were visually inspected in the documentation pass. The independent review and single fix-pass verdict are coordinator-provided evidence; no extra review report was fabricated.

### Raster provenance and content boundary

This extension adds no generated or custom production raster. The listed PNG files are QA captures of the implemented interface. Optional note covers are runtime user content served through the existing cover pipeline, not shipped design assets. Existing surrounding application assets and source Markdown remain outside this redesign's write scope.

### Verification context

The global codebase-memory index points to `/Users/kirill/projects/Synapse` on the concurrent Images branch, rather than this All Notes worktree; the new library files have no indexed freshness record. Verification therefore read the exact worktree source directly, including the reported Tags CSS parse ranges. `PRODUCT.md` retains the earlier product context and now includes the user's confirmed All Notes brief. The Images checkout and main branch were left unchanged.

### Native integration

The installed app at `/Users/kirill/Applications/Synapse.app` was updated after the successful release build. The previous main build is backed up under the artifact directory. Window closure still flushes pending editor saves, then hides the main webview to match the existing tray and single-instance activation behavior. The installed release was closed and reopened with the same process and the library visible. This is a window-lifecycle integration fix; the library's design review remained scoped to the three resolved finish-review items.
