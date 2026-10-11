---
version: 1
slug: src-editor2026-editor2026-tsx
primary_target: src/editor2026/Editor2026.tsx
related_targets: [src/editor2026/blocks/callout.tsx, src/editor2026/blocks/checkList.tsx, src/components/NoteBlockUI.tsx, src/components/noteBlocks.css, src/components/VaultMarkdown.tsx]
---

# Note callouts and task states

Mode: Operate. The user supplied Obsidian reference captures and requested callouts and alternative task markers through slash commands and right-click selection. This extends the incumbent note editor and palette; its user content and surrounding work area remain authoritative.

Callouts use a bounded tonal container, thin stroke, a Lucide icon, editable title and readable body. All thirteen built-in Obsidian types and aliases are recognized. Legacy warn and user-assigned emoji remain readable. Slash search exposes each type; the header button and right click expose one keyboard-operable type menu. Fold metadata is preserved; reading mode uses a native disclosure for foldable callouts. Editing mode exposes their contents.

Task marks follow the supplied semantic colors: neutral todo/progress, green done, rose cancelled, yellow important/key item, orange question, blue forwarded and mint scheduled. A stable 21px mark sits beside ordinary text; completed and cancelled text is struck through. The original BlockNote list parsing, shortcuts and Enter handling remain in use. Each status has a slash item and a right-click menu. Unknown single-character markers survive import/export.

Data boundary: original YAML, BOM, line endings, code, links, unsupported syntax and dirty recovered drafts are preserved. Opening never writes a conversion. Style-only edits patch the original marker bytes; content edits export only changed chunks. Plain quotes remain quotes. Reading and opaque-source blocks render safely without enabling raw HTML, and their explicit marker actions edit only the requested source marker.

Acceptance: verify all nine statuses, callout import, menu keyboard navigation, slash insertion, actual copied-file saves and reopening, source/reading/block transitions, and no same-article split mode. Browser fixtures write only inside their own copied vault. The relevant graph has gaps/stale editor files; current owning-worktree source and source-retention tests provide implementation evidence.
