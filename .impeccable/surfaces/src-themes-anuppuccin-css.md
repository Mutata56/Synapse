---
version: 1
slug: "src-themes-anuppuccin-css"
primary_target: "src/themes/anuppuccin.css"
related_targets: ["src/lib/settings.ts", "src/lib/folderTheme.ts", "src/components/SettingsView.tsx", "src/components/FolderTree.tsx", "src/components/FileBrowser.tsx", "src/components/CaptureWindow.tsx", "src/store/notes.ts", "src/index.css"]
---
# AnuPpuccin appearance

Mode: Operate / Read. User requested their existing AnuPpuccin theme and Obsidian coloring in Synapse, and application installation. Reference is the live Obsidian profile, AnuPpuccin1.5.0 with extended Dracula, theme-controlled Flamingo accent, simple rainbow folders, colored headings and h1/h2 dividers. Appearance.json's red accent is overridden by the enabled theme accent class; actual visible accent is #f5bda6.

## Direction contract

THESIS: Bring the user's familiar Obsidian palette and reading hierarchy into the current Synapse workspace.
OWN-WORLD: Dracula crust/mantle/base, cream text, Flamingo selection and focus, rainbow folders and the profile's six heading colors. Preserve installed Inter / JetBrains Mono and matched type scale.
STORY: Choose AnuPpuccin in Appearance, read/edit/navigate normally, retain explicit icon/folder colors, and reopen the app with the same preset.
FIRST VIEWPORT: Existing ribbon, tree and tabs stay in place, with dark blue-gray surfaces, warm active controls and colored folder names/icons. Notes use the profile's text, links, code surfaces and heading colors.
FORM: User-pinned existing theme, code-led adaptation. No concept lottery or replacement composition; source colors and current UI are authority.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Boundaries

Settings remain workspace-owned. Old workspaces keep Synapse until explicitly selecting AnuPpuccin. Preserve all unrelated settings, including private calendar connection values; do not log or publish them. No source Markdown rewrites, no editor recreation to switch colors, no background polling. Color is paired with existing labels and icons. CSS-only palette switching plus bounded cached folder metadata; preserve explicit user colors and existing navigation/Quick Look/modules. Complete browser/source review and build, then update the installed app with rollback and verify the selected native theme.

## Implemented system

The second palette is scoped to the selected color-theme attribute. It carries the exact 26 imported colors, semantic surface/text/border bindings, a customizable warm accent with readable active-control ink, six heading tones, scoped H1/H2 dividers and code/quote/table roles. The half-opacity Crust quote surface is an intentional implemented role, recorded with its source color function in DESIGN.md and the sidecar.

Automatic folder tones follow sibling-folder order at every level and reuse a cached map for each tree identity. Explicit folder colors and resolved icon colors retain precedence. Settings writes merge the latest complete state, preserve unrelated connection/module values, apply appearance only after a successful write and retain the previous state on failure. The capture window reapplies persisted appearance on focus. The preset changes rendering without recreating editors or rewriting Markdown.

## Verification scope · 2026-10-11

The independent source/capture finish review returned **ship**, with no material fixes. Required captures were validated: settings desktop and editor desktop (1400×900), settings narrow (800×900) and the live Obsidian reference at its native 2× scale. The browser fixture confirmed the six heading tones and first four folder tones; computed shell/panel/text/accent values matched the selected profile. Returning to Synapse restored its original background, reloading retained AnuPpuccin, and narrow Appearance controls fitted without overflow.

The final full Node suite completed with 197 tests: 196 passed and one copied-vault fixture was skipped. The four appearance tests passed. Production/native builds completed and the macOS application was locally installed with a rollback copy. After installation, SHA256 verification found all 532 active Markdown files unchanged, with no added, missing or changed files. With the installed app confirmed closed, its workspace appearance choice was then written atomically as `colorTheme: "anuppuccin"` and `accentColor: "#f5bda6"`. There was no prior settings file; the new file contains only these two fields, and `coerceSettings` supplies the existing defaults for the remaining fields. Launch/restart and UI confirmation remain pending because the Mac is locked; the stored choice and source/capture **ship** disposition do not certify the installed-app UI.

The ordinary documenter fallback recorded the alternate tokens and rules while preserving incumbent system entries. Pre-existing sidecar Quick Look prose still mentions the properties region, while the current DESIGN.md describes its modal; that unrelated drift was neither repaired nor promoted into the AnuPpuccin rules. No shipping raster artwork was created for this palette adaptation.
