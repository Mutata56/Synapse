---
version: 1
slug: "src-editor2026-blocks-whiteboard-drawiocanvas-tsx"
primary_target: "src/editor2026/blocks/whiteboard/DrawioCanvas.tsx"
related_targets: ["src/editor2026/blocks/whiteboard/whiteboardBlock.tsx", "src/editor2026/blocks/whiteboard/drawioDocument.ts", "src/editor2026/blocks/whiteboard/drawio.css", "src/lib/drawioBridge.ts", "src/lib/drawioFiles.ts", "src-tauri/src/canvas_pdf.rs", "scripts/vendor-drawio.mjs"]
---
# Холст с draw.io

Mode: Operate. Build path: code-led extension.

User request: перенести всю логику draw.io в существующий Холст Synapse и доработать интеграцию.

Direction: use the complete local draw.io 32.4.1 browser editor as the drawing engine inside the existing fullscreen whiteboard flow. Preserve Synapse host tokens, Inter UI typography, existing whiteboard block type and note persistence. User's active AnuPpuccin palette remains authoritative for the host. The dark upstream drawing UI retains its native menu, shape palettes, page bar and inspector. No new brand world or approval comp.

Quality bar: real editable legacy shapes and connections; exact original backup; local loading only when opened; durable note save before closing; original undo/redo, pages, layers and diagrams engine; actionable load/import/export errors; labelled host controls, visible focus and compact toolbar at 800 px. SQL remains editable shape data; migration recovery metadata stays out of ordinary properties and tooltips.

Required captures: desktop 1400×900, narrow desktop 800×900, macOS validation window 1200×800. Synthetic fixtures only.

Boundary: local browser editor core is vendored with source manifests and license notices. Electron shell, remote/cloud storage and public conversion services are replaced by Synapse adapters. macOS vector PDF uses detached WebKit rendering. Cross-platform vector PDF is explicitly unsupported.

## Direction contract landed in the build

- **THESIS:** a locally editable diagram remains part of the user's note, with explicit file replacement, durable saving and recoverable prior content.
- **OWN-WORLD:** ordinary code-led extension of the incumbent Synapse desktop system. The host retains semantic theme colors and Inter. The iframe retains its scoped dark upstream editor chrome, menu, palette, page bar and inspector; it does not replace the global theme.
- **STORY:** open the existing card → edit with the original draw.io engine → save to the note or export → close after save. File selection leads to Replace/Cancel and a persisted one-document recovery action.
- **FIRST VIEWPORT:** a quiet bounded host toolbar above the actual diagram workspace, with original shapes/navigation immediately available. At 800 px the host compresses spacing and hides secondary status while keeping actions reachable.
- **FORM:** full-height local iframe within the existing modal; a 48px minimum host bar, 13px control/title roles, 12px context, 6px existing control corners, Lucide outlines and semantic focus/hover. No new palette or display font.

## Completion evidence and scoped verdict

Finishing reviewer disposition: **ship at the scored browser and source-fix scope only**. This records resolution of the three named fixes below; it is not full native or cross-platform approval.

1. **Import replacement and persisted bounded recovery — resolved.** The actual UI fixture required Replace/Cancel, saved the single previous-document slot, then imported/saved/closed/reloaded/restored and recovered the prior scheme. `importBackup` swaps rather than growing a nested history. A failed import reloads the previous model.
2. **Exact portable HTML viewer and page navigation — resolved.** Host HTML embeds the pinned official viewer from `drawio/js/viewer-static.min.js` and the complete XML. The fixture displayed PageTwo and `2 / 2`; `toolbar: "pages zoom layers lightbox"` and `toolbar-nohide: 1` preserve the page controls. The embed-mode `html2` redirect is not used as the portable viewer. External user media, fonts, mathematics and special resource assets can still require additional resources.
3. **Modal focus and background containment — resolved.** Source marks background siblings inert, locks body scrolling and contains host focus. The actual Shift+Tab check stayed in iframe/dialog with the background inert; successful close restores the opening control. The fixture supports this bounded check, not every nested upstream dialog and platform keyboard path.

The accepted browser captures are `.impeccable/review/drawio/desktop.png` (1400×900) and `.impeccable/review/drawio/narrow.png` (800×900), with synthetic content. The ordinary documenter visually inspected both. The complete Node suite reported 233 tests: 232 passed and one existing fixture skipped. The final build after the last JSON option change passed TypeScript/Vite and native release/bundle. The current toolbar-nohide build is covered by the reported full suite. No startup benchmark is claimed.

Native validation profile evidence: a changed label, exact legacy backup, SQL and preview were saved to its note. The macOS vector PDF path reached the system Save dialog, but the final native file write remains unverified: the Save control was also disabled in a clean plain AppKit `NSSavePanel`. macOS subsequently locked; manual unlock, final native relaunch and its capture are not certified. The required 1200×800 native acceptance is still open. The signed package was installed atomically at `/Users/kirill/Applications/Synapse.app`, with rollback retained at artifact-root `drawio-canvas/Synapse-before-drawio-2026-10-12.app`. Local ad-hoc signing was regenerated and `--deep --strict` signature verification passed. The installed binary matches the freshly built binary SHA-256 `32f32a29a466d64de1bc4355e084d7b3529a530b5174b827d9ba821231a260db`. All 598 user Markdown hashes remained unchanged; settings were not modified (Canvas was already enabled and AnuPpuccin already selected). The existing user instance stayed running because macOS was locked; installation does not certify the new binary has been relaunched. Main-branch publication is not established by this review.

## Sources and design record

The ordinary-agent documenter substituted for the unavailable specialized harness role. It checked `DrawioCanvas.tsx`, `whiteboardBlock.tsx`, `drawioDocument.ts`, `drawio.css`, `drawioBridge.ts`, `drawioFiles.ts`, `canvas_pdf.rs`, `scripts/vendor-drawio.mjs`, `public/drawio/NOTICE`, `embed-contract.json`, `vendor-manifest.json`, incumbent `PRODUCT.md`, `DESIGN.md` and `.impeccable/design.json`. No UI or vendor files were edited by this pass.

Graph project `SynapseQuickLook` reported generation `2026-10-11T15:42:58Z`; exact-path coverage showed new integration paths untracked, the block metadata changed and the vendor script subtree excluded. Current source reads supply the evidence for this extension. Vendor verification passed for 2765 files / 59,486,476 bytes; this is local core-resource size, not initial main JavaScript or a startup-time measurement.

The block type and string props stay incumbent. Conversion keeps all supported old shapes/connections/SQL/geometry editable and retains the exact raw source; unreadable data stays intact. PNG/SVG/PDF carriers retain editable XML with model recovery metadata. HTML carries pinned viewer and full XML. macOS PDF uses a dedicated nonpersistent WebKit page renderer with page scripts blocked, followed by PDFLib merge and attachment; other platforms return an explicit unsupported error.

`DESIGN.md` and the sidecar gained only scoped drawio title/control/context roles, the reused host-action pattern, the 800px breakpoint and Canvas rules. The existing palette, typography, font assets, world, other surface records and `PRODUCT.md` remain incumbent. Pre-existing Quick Look wording drift between the sidecar rule (properties-region preview) and DESIGN.md (separate modal) was recorded but not repaired outside this Canvas task.
