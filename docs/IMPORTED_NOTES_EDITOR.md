# Imported Markdown editing

Imported Obsidian notes now open in **Blocks**, using the same Editor2026, formatting toolbar and slash menu as other Synapse notes. Reading, Markdown and split views remain available.

The imported source flag continues to describe provenance and preservation; it no longer disables BlockNote. `importedMarkdown.ts` splits the original body into Markdown AST chunks. Unchanged chunks retain their exact bytes, including whitespace, wiki links, comments and line endings. Only edited or newly inserted chunks use BlockNote export. Original YAML and BOM stay outside the block document. Whole-file Markdown editing still uses the existing revision check, snapshots and atomic replacement.

Unsupported syntax (Obsidian callouts/embeds, Mermaid, HTML and reference definitions) stays in a `sourceMarkdown` block with a rendered preview and an **Изменить Markdown** action. It can be moved, deleted or edited without silently dropping the syntax. Markdown source mode remains the way to edit full YAML and resolve source conflicts.

Rich document state, including data-table types and whiteboard models, is saved in the existing `.synapse/obsidian-metadata.json` sidecar. `editor.blocknote` contains the document; `editor.sourceMap` binds it to the exact source revision. External edits invalidate that binding and rebuild from current Markdown. Editor fields are excluded from the lightweight note metadata tree. Existing move/rename/trash rebasing also moves this state. Keep the `.synapse` directory when backing up the vault. Existing Markdown version snapshots preserve source; they do not independently snapshot every historical rich model.

Block drafts are saved locally before the debounce. Mode switches and note navigation flush the block serializer and then the file write. A conflict retains the draft and reports it visibly; opening/closing untouched notes does not rewrite source or create a rich cache.

Tags use the same restrained green chip style in blocks and reading mode. Reading-mode tags are keyboard-accessible buttons that open the existing tag filter; code and links are not rewritten into tag buttons.

## Validation

- 124 Node tests passed with `SYNAPSE_IMPORT_NOTES_DIR` pointing at a copy of the 530-note vault; all source bytes remained unchanged during the read-only full-vault test.
- Tests cover unchanged bytes, edited chunks, CRLF/BOM/YAML, unsupported fragments, moving/deleting blocks, rich state after restart/moves, direct source invalidation and external conflicts.
- In-app Chromium browser checks on a separate filesystem copy: text edit and immediate note navigation; slash-menu data-table insertion and cell editing; reading/source/block mode switches; table recovery after page restart; unsaved block draft recovery after immediate reload; raw callout editing; and an external-edit conflict. The conflict left the external disk text intact.
- Visual inspection at 1280×720 and 720×900: editable content, compact tag chips, no page-width overflow. The review screenshot uses a copy of the user's WMS Driver article.

The browser fixture is `.impeccable/preview/editor.html`, with `editor.config.mjs` serving only `/private/tmp/synapse-imported-editor-review`. Its filesystem endpoints are bounded to that test copy; production builds use the normal Tauri APIs. Prepare the fixture with `python3 tests/ui/prepare-imported-editor-review.py /path/to/copied/notes`, then run Vite with that config and open its localhost URL.
