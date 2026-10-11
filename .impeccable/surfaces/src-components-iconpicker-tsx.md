---
version: 1
slug: src-components-iconpicker-tsx
primary_target: src/components/IconPicker.tsx
related_targets: [src/components/IconizeSettings.tsx, src/components/NoteIcon.tsx, src/components/IconizeMarkdown.tsx, src/components/iconize.css, src/components/NoteHero.tsx, src/components/FolderTree.tsx, src/components/FileBrowser.tsx, src/components/WorkspaceChrome.tsx]
---

# Iconize for local notes and folders

Mode: Operate. The user requested the Iconize functionality and logos from Obsidian in a separate Synapse branch. This scoped extension lives in `codex/iconize-port`, based on `29b805742e5daae99d50488601984c7479170e10`. The job is to recognize, assign and reuse familiar icon IDs while preserving local Markdown.

Build path: code-led, consistent with `.impeccable/config.json`. The precise local-extension exception in Impeccable's `new-work.md` applies: the incumbent shell, palette and typography remain the visual authority. No seed roll, concept choice, AI comp or identity replacement occurred. Seed key: not applicable under that exception. Existing `DESIGN.md`, `PRODUCT.md` and `.impeccable/design.json` remain unchanged.

## Direction contract

THESIS: Familiar local Iconize choices identify notes and folders while their Markdown stays ordinary source text.
OWN-WORLD: Existing Synapse dark semantic surfaces, Inter/system typography, violet selection and visible focus frame the user's chosen glyphs and colors.
STORY: A context menu or title icon opens search, pack, exact ID, color and folder inheritance; Apply saves the assignment. Settings exposes rules, import and custom packs. Its standalone catalog copies an explicit shortcode with success or error feedback.
FIRST VIEWPORT: A compact searchable modal contains icon/emoji tabs, a pack selector, recent glyphs, a bounded catalog and the selected ID. Appearance options and Apply sit beneath the catalog.
FORM: An extension inside the incumbent shell, with virtual glyph rows and existing Settings. No new compositional form or seed is selected for this local extension.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implemented surface

The centered picker has a maximum width of (720px), viewport padding of (16px), and a height bounded by `100dvh`. The scroll region is limited to the smaller of (364px) and (40dvh); cells use (52px) rows. Column count follows the measured available width, with a minimum of four. At viewport widths up to (540px), side insets reduce to (12px), the footer wraps, and folder inheritance can remain on its own line. Narrow captures exercise responsive resilience in the desktop web interface; they do not establish a phone-native application.

The picker reuses semantic background, text, border, accent and link roles from `src/index.css`. Selected glyphs and icon/emoji tabs use accent tint and link text. Hover uses the existing hover surface; focus has a link-colored outline. User-assigned color belongs to the glyph preview, not to the surrounding controls. Local CSS defines compact section headings (18px, weight 600), search text (14px), control text (13px) and summary/ID context (12px). This hierarchy is scoped to Iconize and does not revise the global type ramp.

The modal has gently rounded corners (12px) and a diffuse scrim-backed shadow. Controls use the existing compact corner vocabulary (5–6px). Settings uses ordinary divided rows rather than a second shell: display options, Markdown property names, ordered rules and custom pack controls continue in one scrollable region. Pack names and actions wrap on narrow widths; four margin fields move below their label. No decorative images or motion are added.

## Interaction and local rules

**The Exact ID Rule.** Preserve the selected Iconize identifier, including pack prefixes such as `FabJava`, `SiPostgresql` and `LiWarehouse`. Glyphs are functional content in this catalog, not a replacement navigation-icon style. All 13 shipped packs are local assets; the manifest records 18,530 symbols, 1,852 emoji descriptions and 3,689 Twemoji SVGs. Pack versions and upstream archive hashes stay in `public/iconize/manifest.json`; licenses stay with the assets.

Search matches IDs, names and pack names, including the implemented Russian aliases. The picker exposes icons, emoji, custom packs, recent choices, loading, empty results, load failure and Retry. It mounts windowed rows rather than all catalog items. Search receives opening focus; ArrowDown enters the glyph group, arrows and Home/End reveal the focused glyph, Enter or double-click applies, Tab stays in the dialog, and closing restores the prior focus when possible. Labels use the existing Russian/English translation mechanism.

**The Explicit Save Rule.** Selection remains a draft until Apply. The footer shows the exact selected ID and glyph; folder targets additionally expose inheritance. “Без иконки” stores an explicit null suppression, including automatic rules; “Автоматически” removes the manual override and restores normal resolution. Resolution prioritizes an explicit assignment, note properties, inherited folder assignment, then the first enabled matching rule. The batch action uses the same assignment path for the current Files selection.

Apply awaits assignment or a rule's callback and keeps the picker open with an alert on failure. Rule picking saves both ID and color. Assignment and settings edits use the serialized atomic metadata writer; subscribers receive the new state only after a successful write. The metadata file is `notes/.synapse/iconize.json`. Icon assignment does not rewrite note bodies. Rename, move, trash and restore retain assignment identity through the storage integration.

**The Explicit Copy Rule.** The catalog opened from Settings is a copy flow. Its footer previews the complete configured shortcode and names its action “Скопировать код”; appearance, removal and reset controls are absent there. The action awaits clipboard completion, reports success through status and toast, and retains a retryable error when copying fails. Merely opening the catalog or selecting a glyph does not report a copy.

Settings exposes icon size, global color with an accessible name and default reset, emoji style, title/tab/link/text switches, title position, delimiter, recent limit and margins. Markdown field names are configurable. Rules expose type, path matching, enabled state, order, ID and color. Obsidian import and custom SVG/PNG installation have busy, success and error paths. These remain local file operations; import reads the source vault and preserves existing Synapse assignments on repeat import.

Inline Markdown rendering replaces text nodes only; code, inline code and raw HTML remain literal. The rich editor decorates the original shortcode rather than replacing document content, reveals source text when the cursor enters it, and carries the ordinary text through export. Internal links use the resolved target-note icon. Existing fallback glyphs remain available when an assignment is absent or its surface switch is disabled.

## Source and screenshot evidence

- `src/components/iconize.css` supplies the local geometry, responsive rules, hierarchy and states; `src/index.css` supplies the inherited semantic colors and font family.
- `src/components/IconPicker.tsx` supplies deferred search, local catalog loading, windowed rows, focus, draft appearance and awaited Apply/copy paths. `src/components/IconizeSettings.tsx` supplies labelled settings rows, explicit clipboard feedback, rules, imports and custom packs.
- `src/components/NoteIcon.tsx` renders local SVG sprite references, custom images and emoji. `src/components/IconizeMarkdown.tsx` and `src/lib/iconizeExtension.ts` preserve literal source/code while adding rendered glyphs and target-link icons.
- `src/lib/iconize.ts`, `src/lib/iconizeCatalog.ts`, `src/store/iconize.ts` and the Iconize writer/rebase paths in `src/lib/storage.ts` supply compatible IDs, resolution, catalog assets and persisted operations. `NoteHero`, `FolderTree`, `FileBrowser`, `WorkspaceChrome` and `SettingsView` contain the real entry points. User-facing details are maintained in `README.md` and `docs/ICONIZE.md`.
- `.impeccable/review/iconize-app.png` (1280 × 800): shell, tree, document tabs, title, inline glyphs, link icons and literal code.
- `.impeccable/review/iconize-picker-desktop.png` (1280 × 800): full catalog, recent choices, appearance and explicit Apply. `.impeccable/review/iconize-picker-mobile.png` (390 × 844): narrowed picker with search results and wrapped footer.
- `.impeccable/review/iconize-settings-desktop.png` (1280 × 800) and `.impeccable/review/iconize-settings-mobile.png` (390 × 844): settings hierarchy, success feedback and responsive rows. Rules and custom packs continue below the captured viewport and are evidenced by source and behavioral checks.

All five raster files were inspected during documentation and their dimensions checked. They are captures of the synthetic browser harness, not generated comps or native installation evidence. The bottom “Iconize picker” / “Iconize settings” buttons and the small floating Markdown probe are fixture-only capture controls; they are not shipping product UI and are not canonized here.

## Quality bar and completed review

Acceptance requires exact saved IDs, all 13 offline packs, SVG glyphs that actually paint in WebKit, bounded mounting, Russian/English labels, visible keyboard focus, no horizontal clipping, preserved source files and complete save/copy error paths. The full finish review found four material issues: persisted null suppression, rule-picker color persistence, the global-color accessible name and explicit awaited copy feedback. They were fixed in one batch. The independent targeted verdict is **pass**, disposition **ship**, with all four findings resolved; it is a targeted confirmation, not a second full audit. The specialized profile was unavailable, so the degraded reviewer/documenter contracts were used.

The build owner reports WebKit checks of all catalog symbols and packs, 143 mounted items at the inspected picker viewport, saved ID/color propagation to tree and tabs, Russian/emoji search, rules, literal code and no horizontal overflow. Reported automated validation passed 122/122 JavaScript tests, including 530 copied-vault Markdown notes unchanged, and 12/12 Rust library tests. Reading the actual source Iconize in the native test produced 13 assignments and 3 extracted SVGs. These behavioral checks are distinct from this documentation scan.

The final `npm`/Tauri release build with `--bundles app` completed successfully, producing `src-tauri/target/release/bundle/macos/Synapse.app`; updated local ad-hoc signing passed `codesign --verify --deep --strict`. The toolchain emitted a `rust-objcopy`/`libLLVM` debug-stripping warning, while release build and bundling succeeded. The installed Synapse application and original vault were unchanged. The documentation obligation is discharged by this scoped brief and inheritance of the existing design system; no system refresh was authorized or needed.

Pre-existing drift: Impeccable context reported `design-sidecar-stale`. It is retained and unrepaired because this is a local Iconize extension, not a design-system refresh. The detector's single (19px) heading advisory was corrected to (18px); the advisory value is not canonized.
