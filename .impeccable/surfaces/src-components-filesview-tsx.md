---
version: 1
slug: "src-components-filesview-tsx"
primary_target: "src/components/FilesView.tsx"
related_targets: ["src/components/TrashView.tsx"]
---

# Files and Trash workspace

Mode: Operate. Manage the local vault through folders, batch moves, search and selection. Trash stays a separate navigation item and uses the same browser with restore and permanent-delete actions. Work occurs in codex/files-redesign, isolated from the images agent.

## Direction contract

THESIS: The current folder route and a dense work table make selection and destination clear; replace the card gallery with a file-management workspace.
OWN-WORLD: Preserve Synapse's dark surfaces, Inter/system typography, violet selection, fine Lucide icons and semantic folder colors; mint labels identify note tags.
STORY: Navigate the folder route, select individual or ranged items, inspect their location, then move or trash the batch; recover items through the same gestures in Trash.
FIRST VIEWPORT: Existing app navigation remains on the left. A compact Files title and create/search actions sit over the folder route, a selection toolbar, aligned rows and a collapsible right properties pane.
FORM: Route and work table, candidate 6; seed 59d4dea1. The route also accepts folder drops. The user explicitly delegated all app decisions while going to sleep; files-route.png is the delegated choice.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Approved comp: .impeccable/mocks/files-route.png. The other two concepts are comparison material. Demonstration filenames, counts and ordering do not alter the vault. Slight image-generation noise is not a shipping texture; all app controls are semantic. Real rows remain single-line and sortable; unsupported sizes are shown as unknown, and Trash dates retain their actual modification meaning.

Preserve source Markdown and its unknown frontmatter, attachments inside moved folders, undo and keyboard use. File and folder identities stay distinct. No scans per rendered row, no background polling, no remote covers. Virtualized rows, an in-memory folder index and one refresh per batch bound the cost. Tests and destructive operations use synthetic or copied data.

## QUALITY BAR — delegated surface choice

This card records the quality ceiling for candidate 6 rather than a new visual world. The existing Synapse shell remains the reference: Inter typography, dark semantic surfaces, violet focus/selection and Lucide outlines.

- Named desktop actions, a current folder route and a stable selection toolbar establish the work sequence without card-gallery decoration.
- Natural, folders-first ordering and real counts take precedence over illustrative sample ordering in the generated comp.
- Selection, range selection, keyboard reveal and explicit quick look must keep work on the same screen.
- Properties collapse on demand; narrow windows retain the route and primary batch actions.
- Trash is recognizably separate, with its own name and restoration/permanent-delete actions in the same engine.
- Metadata-only browsing, bounded mounted rows and one final refresh per batch are required. No remote preview images or perpetual animation.

The user delegated all application decisions while asleep. This card is an agent-selected implementation contract under that delegation, not evidence of a human visually accepting a screenshot.

## Final review scope

Independent reviewer verdict: the named desktop actions, real-folder color precedence, accurate Trash context and scoped documentation are resolved. No material visual regressions were found in the reviewed desktop, narrow-window and installed-app captures. Specialized reviewer/documenter roles were unavailable; independent general agents used the degraded contracts.

Formal comp-led certification remains open: hero 71.3%, final desktop comparison 67.6%; neither is a passing numeric result. The tool refused a delegated-authority force because the user did not explicitly downgrade the comp in words. No human visual approval or closed build phase is claimed. Generated illustrative ordering, existing shell typography and real metadata adaptation are recorded in the final comparison and review. The application feature is delivered with this visual-fidelity limitation explicitly retained.
