---
version: 1
slug: src-components-settingsview-tsx
primary_target: src/components/SettingsView.tsx
related_targets: [src/components/SettingsView.css, src/lib/modules.ts, src/lib/settings.ts, src/store/notes.ts, src/store/workspace.ts]
---

# Settings and modularity

Mode: Operate. The user's task is to configure the available workspace features, find a preference and understand whether it saved. The confirmed default is notes, files, search and note creation. The redesign inherits `DESIGN.md`, its `.impeccable/design.json` sidecar, the near-black Synapse background, Inter and semantic surface/border/accent roles. It introduces a Settings composition within that system.

Build path: code-led, task-directed form. No seed, concept round or approved comp was used. The documenter reused the parent session's context result and checked owning source directly; this pass did not run a browser, server or detector.

## Direction contract

THESIS: a searchable control center with flat, divided setting rows makes feature availability and persistence explicit.

OWN-WORLD: inherit Synapse's Inter type, dark tonal surfaces, semantic accents and Lucide outline icons. Local context and divider roles support dense settings; controls keep the established small radius.

STORY: choose a category, enable the modules needed for work, tune graph behavior independently and see the save outcome. Settings stays reachable for recovery.

FIRST VIEWPORT: a page heading and automatic-save state sit above category navigation and one scrolling content pane. Modules opens with the enabled count, Minimal / All modules actions, a data-preservation explanation and labeled switches.

FORM: a task-directed two-pane form on desktop with horizontal category navigation on narrow containers. No ranked concept list or seed key applies to this inherited-world build.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Behavior and states

- Categories are Modules, Graph, Appearance, Behavior, Connections and Data. The last chosen category is retained for the current runtime. Selecting a category clears search and resets the content scroll.
- Search matches translated section titles, descriptions and keywords. Matching Modules content filters its rows; other matching sections show their full forms. An empty result explains the state and provides Clear search. Category controls keep their translated labels and current-page state.
- The navigation group contains `notes`, `files`, `search`, `inbox`, `graph`, `calendar`, `tags`, `images`, `overview` and `trash`. Tools and panels contains `home`, `newNote`, `canvas`, `database`, `bookmarks`, `context` and `help`. The presets and individual switches change functional availability. Disabled routes, commands and panels are gated; existing editing and Settings remain available. Disabling `home` prevents additional tabs and keeps existing ones. Rich Canvas/Database blocks retain their properties behind a disabled-module placeholder.
- Graph defaults are Obsidian on, Volume/minimap/breathing/local graph off. A disabled graph module shows an Enable module recovery action and disables its settings fieldset. The last configured renderer cannot be switched off. Breathing requires Volume. The whole graph module may be disabled independently of its retained configuration.
- The header announces automatic, saving, saved and failed-save states through a polite live status. Module presets, module switches and graph configuration wait while a save is pending. Complete AppSettings writes to `notes/.settings.json` are serialized; invalid old fields coerce independently and failed writes do not activate an unsaved configuration. Language uses the existing i18n mechanism. Pending rich-block state flushes before document persistence on navigation.
- Appearance exposes Russian/English, accent presets/custom HEX and animations. Invalid HEX has a labeled error. Shortcut capture requires a modifier combination and Escape cancels recording. Behavior and Connections show an enable-module recovery notice when their relevant module is off; daily-note startup requires Calendar. Connections retains iCal/CalDAV loading, result and error states. Data retains the local path, backup and explicitly confirmed restore flow, with busy actions disabled.

## Layout and interaction

Settings temporarily hides workspace file/context panes without changing their saved visibility. The inherited ribbon and document tabs remain around the full-width Settings work region.

| Container | Implemented structure |
| --- | --- |
| Above 760px | Category pane 214px wide; header padding 28px 32px 24px; content padding 30px 36px 48px; content measure capped at 760px. |
| 760px and below | Category pane 178px; header padding 23px 24px 20px; content padding 26px 24px 40px; decorative row icons disappear. |
| 580px and below | Search and horizontally scrolling categories sit above content; navigation padding 12px 16px 0; header padding 20px; content padding 22px 20px 32px; preset/actions may wrap. |

The content pane scrolls independently and contains overscroll. Native buttons, selects and labeled checkbox switches support keyboard operation. The switch target is 44 × 36px around a 32 × 19px track and 13px thumb. Focus uses the existing accent/link roles: visible 2px outlines, with a 4px offset on switch tracks. Switch and button state responses last 150ms; the inherited motion settings and system reduced-motion preference govern interface motion.

## Scoped visual roles

`SettingsView.css` owns these values. They are Settings roles, not replacements for the global system. Local context is `color-mix(in srgb, var(--color-text) 68%, var(--color-bg))`; structural dividers use `--color-border-strong`, row dividers use `--color-border`, and save/HEX errors use the local `#f28e94` role. Active categories use the established accent background and link icon color. Search, inputs and buttons use a 6px radius; module recovery notices use 8px. Rows are flat with 15px vertical padding, becoming 13px at the narrow breakpoint.

| Role | Source value | Narrow adaptation |
| --- | --- | --- |
| Page heading | 26px, weight 650, line-height 1.3, tracking −.025em | 23px |
| Section heading | 22px, weight 600, line-height 1.35, tracking −.02em | 20px |
| Header / section description | 13px; section line-height 1.65 | Header 12px |
| Group heading | 13px, weight 600 | Same |
| Row label | 13px, weight 500, line-height 1.5 | Same |
| Row description | 12px, line-height 1.55 | 11px |
| Category / search / button / input | 13px / 12px / 12px / 13px | Category 12px |
| Save status / context / footnote | 11px; footnote line-height 1.6 | Save status 10px |

## Evidence and limits

Inspected source: `SettingsView.tsx`, `SettingsView.css`, `modules.ts` and bounded inherited token/motion declarations in `src/index.css`. Existing PRODUCT, DESIGN and sidecar were checked. Both DESIGN files remain the inherited authority; no system refresh or drift repair was performed.

The supplied `settings-review/desktop.jpg` (1440 × 900) and `settings-review/mobile.jpg` (390 × 844), under `/Users/kirill/.codex/visualizations/2026/10/11/01a12b55-554f-7601-9b07-aa757210c73f/`, were inspected. They show the synthetic preview fixture with the minimal preset. All preview notes and screenshots are synthetic. These are implementation captures, not design comps or evidence of a phone-native application.

Parent execution reports: production build with `--manifest` passed; the Node suite ran 125 tests, with 124 passed and one intended copied-vault skip; the static bundle graph check passed. Browser coverage included 1440 × 900, 390 × 844 and 482 × 800, graph renderers/minimap on and off, all modules off and recovery, language and search. The independent full finish review accepted layout/fidelity and found one board debounce preservation issue. The corrected batch passed regression checks, and the targeted follow-up returned disposition `ship` for that correction. This is the reported web evidence and scoped review verdict; Cargo is absent and native compilation is unverified. The documenter did not rerun these checks.
