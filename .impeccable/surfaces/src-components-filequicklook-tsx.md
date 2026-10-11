---
version: 1
slug: "src-components-filequicklook-tsx"
primary_target: "src/components/FileQuickLook.tsx"
related_targets: ["src/components/FileBrowser.tsx", "src/components/FileProperties.tsx", "src/components/fileQuickLook.css"]
---

# Files and Trash Quick Look

Mode: Read. This is a precise extension of the existing Files/Trash workspace. The user requested macOS-like modal previews on Space for both notes and folders and removal of preview controls from the right properties pane, in a separate branch.

## Direction contract

THESIS: An explicit Space gesture opens a focused read-only window above the file list.
OWN-WORLD: Keep Synapse's dark semantic surfaces, Inter/system typography, violet keyboard focus and Lucide icons. Use the existing 12px dialog corner and restrained chrome.
STORY: Select a note or folder, press Space, inspect it, switch nearby entries with the arrow controls, and dismiss with Space or Escape to return to the same list.
FIRST VIEWPORT: A centered window has a close button at the upper left, the entry title and source path, a large scrolling reading area, and a quiet keyboard/navigation footer. Folders show actual cached counts and a bounded child list. The right pane contains properties and existing actions only.
FORM: User-specified modal extension; code-led. Seed not applicable to this precisely specified local request. No new visual world or replacement comp.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Acceptance

Space and Escape dismiss without changing content; the native modal contains focus and restores it to the list. Text inputs keep normal Space behavior. Files and Trash use their own readers. Folder previews read metadata only; Markdown parsing is deferred until a note is previewed. Preview keeps the existing bounded five-note cache, text limit and remote-media protection. Long names and narrow desktop windows remain usable. Existing double-click editing in Files and folder navigation remain intact; double-clicking a Trash note opens this modal.


## Implementation record

The implementation uses a native HTML `dialog` in a document-body portal, with an explicit Tab/Shift+Tab cycle for WebKit and explicit return to the connected grid. Space in the grid or the context menu opens the selected note or folder; opening the properties pane does not read a body. Escape, the close control, backdrop interaction and Space from the reader dismiss. Space retains normal activation on buttons. Left/right keys and footer controls browse the current visible results, synchronize list selection and reveal the active row. Files retains editor/folder opening; Trash notes open this preview on double click and have no editor Open action.

Notes reuse the unchanged lazy `FileQuickPreview`: at most five cached entries keyed by mode/path/revision and 18,000 rendered characters, with loading, retry and truncation in the modal. Links and images remain inert text/attachment labels. Folders show actual cached subtree counts and at most 40 immediate children without body reads.

The current CSS retains semantic dark surfaces, violet focus and the incumbent 12px dialog corner. The desktop window is bounded by 960×780px and viewport margins; its reader has a 72ch measure, 15px prose at 1.75 line height and Markdown headings at 28/23/18px. The toolbar title is 14px and path/footer context is 11px. At 640px and below the window uses 12px horizontal and 16px vertical viewport margins, 14px reader prose and a 24px first Markdown heading; folder titles step from 23px to 19px. These are local implementation observations, not new global tokens or a new visual world.

## Validation and reproduction

Recorded verification: 156 Node tests passed, one copied-vault test skipped without its prepared vault, and the production TypeScript/Vite build passed. Six WebKit scenarios passed on the synthetic in-memory `files-bench` fixture at 1400×900 and 480×800. Coverage includes explicit reads/cache reuse, focus containment, Files/Trash note and folder sources, error retry, truncation, the virtualized 50,000-row case, English controls and existing editor opening. The final six-scenario rerun also passed context-menu → Escape → grid focus → ArrowDown, with no browser errors. This evidence does not claim installed-native-app verification or whole-surface comp certification.

Reproduce from this worktree with Vite on port 1475, then `playwright-cli -s=synapse-quicklook open 'http://127.0.0.1:1475/files-bench.html?unselected' --browser=webkit` and `playwright-cli -s=synapse-quicklook --raw run-code --filename=tests/ui/files-quick-look.mjs`. The script captures `quicklook-note-desktop.png`, `quicklook-folder-desktop.png`, `quicklook-trash-desktop.png` and `quicklook-note-narrow.png` in `.impeccable/review/`; all four are browser validation captures of synthetic data, not replacement comps or source-vault content.
