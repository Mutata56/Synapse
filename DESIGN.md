---
name: Synapse
description: Existing desktop note interface extracted from repository components and CSS
colors:
  primary: "#6366f1"
  link: "#818cf8"
  neutral-bg: "#0a0a0b"
  surface-low: "#0e0e10"
  surface-high: "#16161b"
  foreground: "#e4e4e7"
  foreground-strong: "#f4f4f5"
  foreground-secondary: "#d4d4d8"
  foreground-muted: "#71717a"
  tag-accent: "#5fb89a"
  border: "rgba(255, 255, 255, 0.06)"
  tags-muted: "#9a9aa6"
  tags-control: "#24242d"
  library-muted: "color-mix(in srgb, var(--color-text) 70%, var(--color-bg))"
typography:
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  tags-page-title:
    fontSize: "24px"
    fontWeight: 650
    lineHeight: "30px"
    letterSpacing: "-0.025em"
  tags-reader-title:
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  tags-pane-title:
    fontSize: "17px"
    fontWeight: 600
  tags-result-title:
    fontSize: "15px"
    fontWeight: 550
    lineHeight: 1.4
  tags-reader-body:
    fontSize: "14px"
    lineHeight: 1.75
  tags-row-label:
    fontSize: "13px"
  tags-control-label:
    fontSize: "12px"
  tags-context:
    fontSize: "11px"
  tags-result-tag:
    fontSize: "10px"
    lineHeight: 1.4
  library-page-title:
    fontSize: "24px"
    fontWeight: 650
    lineHeight: "32px"
    letterSpacing: "-0.025em"
  library-shelf-title:
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-0.015em"
  library-card-title:
    fontSize: "17px"
    fontWeight: 580
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  library-card-excerpt:
    fontSize: "12px"
    lineHeight: 1.6
  library-control-label:
    fontSize: "12px"
  library-context:
    fontSize: "11px"
  library-reader-title:
    fontSize: "23px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  library-reader-body:
    fontSize: "13px"
    lineHeight: 1.75
rounded:
  control: "6px"
  card: "12px"
  chip: "999px"
  tags-detail: "3px"
  tags-segment: "4px"
  tags-row: "5px"
  tags-popover: "7px"
  library-control: "7px"
  library-detail: "5px"
  library-tag: "4px"
spacing:
  tight: "6px"
  control: "12px"
  group: "16px"
  region: "24px"
  page-inset: "40px"
  library-inset: "28px"
  library-inset-narrow: "18px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.surface-low}"
    rounded: "{rounded.card}"
    padding: "16px"
  chip-selected:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.chip}"
    padding: "6px 12px"
  tags-filter:
    backgroundColor: "color-mix(in srgb, var(--tag-accent) 8%, transparent)"
    textColor: "{colors.tag-accent}"
    typography: "{typography.tags-control-label}"
    rounded: "{rounded.tags-row}"
    padding: "0 4px 0 8px"
    height: "28px"
  tags-inline-tag:
    backgroundColor: "color-mix(in srgb, var(--tag-accent) 20%, transparent)"
    textColor: "{colors.tag-accent}"
    typography: "{typography.tags-control-label}"
    rounded: "{rounded.tags-row}"
    padding: "4px 7px"
  tags-result-row:
    rounded: "{rounded.tags-row}"
    padding: "11px 12px 9px 46px"
    height: "88px"
  tags-tree-row:
    textColor: "{colors.foreground-secondary}"
    typography: "{typography.tags-row-label}"
    rounded: "{rounded.tags-row}"
    height: "40px"
  tags-open-note:
    backgroundColor: "transparent"
    textColor: "{colors.foreground-secondary}"
    typography: "{typography.tags-control-label}"
    rounded: "{rounded.tags-segment}"
    padding: "0 7px"
    height: "28px"
  tags-filter-more:
    textColor: "{colors.tags-muted}"
    typography: "{typography.tags-control-label}"
    rounded: "{rounded.tags-row}"
    padding: "0 7px"
    height: "28px"
  library-note-card:
    backgroundColor: "{colors.surface-low}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    height: "282px"
  library-note-card-compact:
    backgroundColor: "{colors.surface-low}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    height: "230px"
  library-new-note:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.library-control}"
    padding: "9px 12px"
---

# Design System: Synapse

## Overview

**Creative North Star: "Existing Synapse desktop interface"**

This records the incumbent visual system, rather than a new identity. The authority is `src/index.css`, the existing Sidebar, TagsView, NoteCard, and the running desktop interface. New local surfaces inherit this shell; their own layout decisions stay in surface briefs.

The implemented Tags finder supplies a scoped extension, evidenced by `src/components/TagsView.css` and the approved actual viewport. Its dense rows, mint tag markers and quiet reading area use the incumbent shell and semantic tokens. The `tags-` entries below describe this surface; they do not replace the global type or shape vocabulary.

The implemented All Notes library supplies a second scoped extension, evidenced by `src/components/NotesGallery.css` and the finished desktop, narrow and reading captures. Its `library-` entries retain the incumbent palette and font family while recording the library's content cards, context contrast and compact controls. Surface composition and acceptance evidence stay in `.impeccable/surfaces/src-components-notesgallery-tsx.md`.

**Key Characteristics:**

- Dark tonal surfaces
- Violet selection
- Compact readable controls

## Colors

Near-black background, two quiet raised surfaces, violet active states and links, and a restrained mint tag accent. Existing CSS variables are the implementation source of truth. Text uses foreground roles; muted text is secondary context and must meet the contrast needed for its final rendered use.

### Tags extension

Tags secondary context uses the local `tags-muted` role for folders, dates, counts, descriptions and control labels. `tags-control` supplies the thin strokes around dark search fields, checks and grouped controls. Both values are scoped to the finder; the incumbent global muted token is preserved.

**The Semantic Accent Rule.** Within Tags, mint identifies tag membership and tag filters; violet identifies the selected note, active pane, match mode, links and focus. Keep those meanings distinct.

### All Notes extension

The local `library-muted` role mixes the existing text and background in the source color space. It carries excerpts, folders, dates, counts and secondary controls; it also supplies the inherited reading context color inside the library. The shared foreground, surface, violet and mint values remain unchanged.

**The Library Accent Rule.** Within All Notes, mint identifies tags; violet identifies focus, selection, the previewed card and the primary New note action.

## Typography

The existing Inter and system fallback stack supplies the interface. Section titles are compact and semibold; controls and note rows use a smaller workhorse scale. Monospace is reserved for source/code values.

### Tags hierarchy

The scoped title roles distinguish the view, the selected note and the results pane. Result titles are slightly emphasized; tree labels and search fields use the smaller row role. Context labels and mint tag summaries use the two smallest steps. Preview prose has the body size with a more generous reading line height and a maximum measure (72ch). Its Markdown subheadings follow the rendered document hierarchy (23px, 20px and 17px).

At the narrow container breakpoint, the view title becomes (22px), the reading title becomes (24px), and header inventory/result counts use the context step. Filter/match labels and the quiet Open action use the compact control step at both sizes. These are responsive adaptations of Tags, not a replacement global headline scale.

**The Dense Context Rule.** Small type carries metadata and compact tag summaries; note titles, search and primary actions remain visually stronger. Preserve the observed small interface steps instead of enlarging every row or flattening the hierarchy.

### All Notes hierarchy

The `library-` title roles distinguish the view, shelf, card and reading title. Excerpts use their own compact prose role; controls and dates stay subordinate. Cards without covers show a two-line title and up to four excerpt lines. Compact cards use the smaller title step (15px) and up to three excerpt lines; cards with covers use that smaller title step and two excerpt lines. Folders and footer tag summaries use the small context step (10px).

At library container widths of (680px) and below the view title becomes (23px) and the normal uncovered card title becomes (16px); at (450px) and below the view title becomes (22px). The reading prose inherits the Tags reader line height and measure (72ch), with the library's smaller body role. These observations belong to All Notes and do not revise the global or Tags type ramp.

## Layout

The persistent navigation rail sits to the left of the work area. View headers and independently scrolling content regions fill the available desktop height. Current views use roughly 24–40 px outer spacing and smaller spacing within a control group.

### Tags finder

The finder fills the available work area with a fixed header/filter strip and three independently scrolling panes: searchable tag catalog, compact result list and reading preview. The wide grid assigns the catalog (20.3%, minimum 210px), results (34.2%, minimum 280px) and the remaining width to reading. Quiet vertical rules separate work regions; they are not a card gallery.

The compact header puts title and tag inventory on the left, result count and an accessible icon-only Reset on the right, then a bounded selected-tag summary beside the all/any control. Its observed height is (101px) on desktop and (97px) at the narrow breakpoint. The single search field stays in the tag catalog; there is no separate note-search field in the header.

Responsive decisions follow the Tags container width, including the user's chosen navigation-rail width. At (1050px) and below, the catalog remains beside either results or reading; pane controls switch the second region. At (640px) and below, one pane is visible at a time and the Tags / Notes / Reading controls expose all three. The filter summary shows up to two chips on wide layouts, one on narrow layouts, and a +N control for the rest. Header horizontal insets reduce from (22px) to (16px); selected tags do not expand its height.

Both indexes use fixed-height windowed rows: tags (40px), notes (88px), with a small overscan. Keep title, folder, date and short tag summaries inside these bounds so a large vault does not multiply mounted rows or shift the scroll model. Hierarchy indentation advances by (14px) per real path level.

### All Notes library

The header, search/filter row and view controls remain above one independently scrolling card region. Horizontal insets use the library roles; shelf/card gaps reuse the existing group rhythm. The normal layout fits up to three card columns and the compact layout up to four, chosen from the measured content width. A card row has a fixed content height from its component variant, with a (16px) row gap; shelf headings occupy (56px) and grouped shelves add (12px). Nearby headings and card rows share one viewport window with (320px) overscan.

Library container queries, rather than the whole window, govern wrapping. At (1000px) and below controls wrap and the reading drawer can occupy (65%) of the work area. At (680px) and below search spans a row, insets reduce, and reading fills the work area. At (450px) and below title/count stack and the controls tighten. The drawer otherwise occupies the smaller of (560px) or (55%) of the work area. It overlays the card region without changing the shelf's column calculation.

## Elevation & Depth

Tonal surfaces and thin low-contrast borders establish depth. Floating menus use the existing `--shadow-float` token; ordinary work regions need no additional decorative elevation.

Tags remains flat at rest. The tag catalog uses the low surface, selected results use a violet tone and a thin selection outline, and active tag rows use a faint mint tone. Its floating note-action menu uses a diffuse shadow (`0 8px 24px rgba(0,0,0,.45)`); the selected-tag popover uses a quieter version (`0 8px 24px rgba(0,0,0,.3)`).

All Notes cards use tonal fill and a thin border at rest, with no card shadow. Hover changes the surface and border; selection and the previewed card use violet fill and stroke. The reading drawer alone uses a soft directional shadow (`-16px 0 40px rgba(0,0,0,.22)`) to separate an overlapping reading region. This is a local overlay treatment, not a new global elevation scale. Card color/border transitions last (140ms); checkbox/star visibility transitions last (120ms). The reduced-motion preference removes both.

## Shapes

Controls are gently rounded, note cards have the existing card radius, and the recorded pill primitive remains available to incumbent surfaces. Lucide outline icons carry a consistent stroke.

Tags uses a nested compact corner vocabulary: small checks, dismiss controls and inline code use `tags-detail`; segmented buttons, result tag summaries and the Open action use `tags-segment`; tree/result rows, inline tag actions, active filter chips, pane controls and attachments use `tags-row`. Search fields and the note-action menu retain the control radius; the selected-tag popover uses `tags-popover`. These local steps keep dense controls distinct from the broader note-card and pill shapes.

All Notes reuses the established card radius. Its search, filters and primary action use `library-control`; checkbox/favorite controls use `library-detail`; footer tags and the eye action use `library-tag`. Rounded corners bound useful note content, with no empty decorative cover panel for a note that has no cover.

## Components

Buttons, inputs, navigation rows, chips and note content retain familiar web semantics inside Tauri. Active navigation uses violet tone and a clear label. Focus must remain visible. Inline image covers are optional content, not mandatory chrome for every note representation.

### Tags filters and hierarchy

Active filter chips are mint, lightly filled, stroked and individually removable. Each visible chip is bounded in height and width (28px high, maximum 180px wide). The +N control exposes all selected tags in a popover whose width is bounded by the work area (maximum 320px); its list scrolls within the smaller of (280px) or (45dvh). Escape, outside interaction and a known focus exit close it. Sequential removals keep the list open down to its last tag, even after the selection fits in the header. Removing a focused tag restores focus to the next row, or the previous row at the end; removing the last selected tag closes the list, moves focus to Any and preserves the current reading pane.

The adjacent all/any control uses violet for the active match mode. All selected requires at least one selected tag; with no selected tags, including the untagged scope, it is disabled and Any is the effective active mode. Reset clears catalog search and tag/untagged filters. Actual slash-delimited tag paths provide hierarchy, including virtual ancestors that count unique notes in their descendant branches. Disclosure opens a branch; tag selection changes the filter. Do not invent imported groups or rewrite note tags from this surface.

One metadata index per tree revision supplies tag membership and all/any filtering without reading every Markdown body. Catalog search reveals matching tag paths with their actual ancestors; it is the only search exposed by this view. Tree and note-list keyboard navigation reveal the focused windowed row and reference only a mounted active descendant.

### Tags result row and reading preview

A result row combines an outline note icon, single-line title and folder, update date, two short mint tag summaries and an overflow count. Violet fill and outline identify the selected note. Clicking selects a read-only preview; double-click or the explicit Open note action enters the existing editor. The preview stays on the selected note while it remains in the filtered results.

Open is a quiet text action with a small outline external-link icon (13px) and a bounded control height. Its width follows the translated label; its accessible name remains Open note. It stays subordinate to the selected-note title and gains a tonal background on hover.

Only the selected note is loaded for reading. Preview bodies are bounded to (24,000 characters) and cached in at most five entries; the full note remains available through Open note. Images render as attachment actions, with no covers or remote image requests in the finder. Loading, missing-note/retry, empty results and long-preview states carry explicit text and a recovery action where applicable.

### Tags pane navigation and focus

Narrow pane controls preserve the current reading context while switching visible work regions. Transfer keyboard focus after pane visibility has committed, into tag search, the visible result list or the reading region as appropriate. When all three panes remain visible, result navigation keeps its focus. Focus uses the existing link token with an inset outline; active rows also receive a focused-row outline.

### All Notes cards and reading

A library card presents update context, a title, a useful metadata excerpt, its folder and up to two tag summaries with an overflow count. The content button opens the existing editor. The separate outline eye action opens a bounded read-only drawer; the card remains visible and gains the preview state. Optional user covers resolve only after their mounted cover enters view; a failed cover falls back to the content card. Note content, filenames and source Markdown are preserved during browsing.

Selection and favorite controls reveal on hover or keyboard focus, with selected/favorite states remaining visible. The viewport and controls have an explicit violet focus outline; card opening uses an inset outline. Arrow keys and Home/End reveal and focus the destination card after its window mounts. Closing the drawer returns focus to its connected eye trigger, or to the viewport when the trigger is no longer mounted. Session filters and scroll survive an editor visit; scroll restoration waits for the measured-width column layout.

Search uses the metadata index, including title, folder, cached excerpt, tags and aliases. Folder, tag and favorite filters combine with sorting and grouping. Bulk selection operates on filtered results and routes trash through the existing recoverable action with confirmation. Reading lazily reuses `TagReadingPane`; only the selected note body loads, preview text is bounded to (24,000 characters), and the reader cache is bounded to five entries. Images in the reading body remain attachment actions. Empty, loading, missing-note/retry and long-preview states retain explicit recovery actions.

## Do's and Don'ts

- Do use the semantic CSS variables and the existing icon family.
- Do preserve the application shell while improving a local view.
- Do theme focus, selection, scrolling and selected filters with established tokens.
- Do keep the Tags extension scoped and use its readable context color for dense secondary labels.
- Do preserve fixed row bounds, real tag-path hierarchy and explicit read-only preview actions in Tags.
- Do keep selected-tag summaries bounded and expose the full removable selection through +N.
- Do move focus into the visible pane after a narrow-layout pane switch.
- Do keep All Notes type, context and corner roles scoped to the library.
- Do use actual note excerpts when covers are absent, and keep editor and quick-reading actions explicit.
- Do preserve measured-width windowing, visible focus and the return context in All Notes.
- Don't let a local feature silently change the global palette or typography.
- Don't impose decorative image covers or motion on dense note indexes.
- Don't turn preview tag actions into note edits or load image covers while filtering Tags.
