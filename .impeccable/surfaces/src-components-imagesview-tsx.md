---
version: 1
slug: "src-components-imagesview-tsx"
primary_target: "src/components/ImagesView.tsx"
related_targets: ["src/components/ImagesView.css", "src/components/LibraryImageViewer.tsx", "src/lib/imageLibrary.ts", "src/lib/imagePreviews.ts", "src/store/imageLibrary.ts", "src/lib/storage.ts", "src-tauri/src/image_previews.rs"]
---

# Image library

Mode: Operate. The user asked for a separate branch, a complete Images UI/UX redesign and optimization. They confirmed both jobs: browse a media library by folders/types and find/view images with their associated notes. They then delegated all app decisions while asleep. Branch: codex/images-redesign.

## Direction contract

THESIS: A local media library and note context share one workspace; source attachments participate alongside managed uploads.

OWN-WORLD: Inherit Synapse's dark semantic surfaces, Inter/system type, quiet borders, violet selection and outline icons. Preserve the surrounding app and its existing Tags work.

STORY: Search filename/folder/note, narrow by format or association, switch between contact sheet and list, inspect metadata and related notes, then deliberately open the original or reveal the file.

FIRST VIEWPORT: Compact title and utility controls, one search, association scopes, a dominant image grid and a fixed-width inspector. On narrow work areas show the gallery or details with a deliberate back action. Images are contained, never cropped to decorate a tile.

FORM: Gallery plus inspector, chosen autonomously under the user's delegation. This is a code-led implementation using the established app world and actual local content; there is no approved raster comp or new identity. Inspection covers the running interface and behavior.

FORM authority: The direct user instruction was “я пошел спать - если нужна будет от меня помощь - реши сам. то бишь я даю тебе все разрешения по поводу данного приложения”. This overrides the skill's user choice/approval round: composition decisions are delegated to the implementer. No user-locked seed is claimed. A prior unscoped degraded seed (`c56c947f`, generated accidentally while seeking CLI help) did not choose this composition and is not approval evidence. The code-led direction keeps the established world under new-work.md section 1; its gallery/inspector composition serves the confirmed two workflows. This is an explicit user override of the interaction requirement, rather than a skill-defined exemption or a retroactive claim of a pre-build concept round.

FINISH: The bounded finish review is complete with a ship verdict and all three material findings resolved. Record the finished Images decisions here and in `.impeccable/review/images/design-documentation.md`; verify the incumbent DESIGN.md and sidecar without replacing the global world. No generated shipping raster was added.

## Constraints and evidence

Original Markdown and image bytes stay intact. Imported attachments remain read-only in the library. Managed uploads are removable only when fresh scanning finds no reference, including trash and versions. Cached reference tokens are keyed by file mtime/size; unchanged versions avoid rereading. Raster thumbnails decode in two bounded native jobs, resize to at most 480×360, and cache separately from notes. SVG files up to 256 KiB display their original vector source as an isolated image resource; larger SVGs and unsupported raster formats show a placeholder until the user explicitly opens the original. Offscreen queued requests cancel; hidden documents pause new work; fullscreen viewing pauses gallery thumbnail work. Full raster originals load into the renderer only on an explicit full-view action. The fixture's zero-original-endpoint-request check concerns its full-view route; small SVG preview requests still carry original vector bytes.

The copied vault contains 39 images, 31 with detected associations. SHA-256 checks cover 598 original visible source files; no source bytes changed. Native previews total 2,125,705 bytes compared with 21,299,713 bytes of source images. Repeated scans read zero unchanged note bodies. These are local fixture/CPU measurements, not battery or live renderer-memory measurements.

Required captures: `.impeccable/review/images/desktop.jpg`, `list.jpg`, `mobile.jpg`, and `mobile-details.jpg`. They show real copied content rendered by current production components. Validation fixtures and captures do not ship as production assets. Runtime thumbnails derive from the user's original files; no generated brand raster is added.

## Finished surface decisions

These decisions describe Images only. `DESIGN.md`, `.impeccable/design.json`, the global tokens in `src/index.css`, and the Tags documentation retain their incumbent authority.

### Composition and responsive layout

The fixed work header groups the view title and inventory with Refresh, then filename/folder/note search, folder, format, sorting and the grid/list switch. The next row offers All / With links / Without links, a live result count and conditional Reset or Select unused actions. The default sort is modified time. One search indexes the confirmed media and note-context jobs together.

On wide work areas, the gallery shares a grid with a (320px) inspector. The gallery, inspector body and related-note list scroll in their own bounds. Grid columns and row heights follow the available gallery width; list mode uses a fixed (76px) row pitch with a contained (68 × 47px) image frame. The contact sheet contains the complete attachment within its frame, including tall diagrams and portrait scans; it does not crop content into a cover. Captions show filename or a related-note title for a managed hash name, bytes and association count. The inspector retains the full filename.

At an Images container width of (950px) or less, selection opens details as the single visible work region, and the Images back action returns to the gallery. At (540px) or less, header spacing and controls compact further; search stays on its own row, association scopes occupy a row, and the title becomes (22px). These breakpoints respond to the work area, including the surrounding rail width. The narrow QA captures are container adaptations of the desktop surface, not a separate mobile product.

### Material, type and state

Images inherits the near-black ground, quiet raised surfaces, foreground roles, thin borders, violet selection and Lucide outlines. Its local secondary-context color mixes the existing text and background (70% text); it leaves the global muted role intact. Selected images use the existing accent fill and border; active grid/list controls use the same accent family. Association scopes use a quiet tonal active state. Ordinary work regions have no new shadow or decorative animation.

The desktop title is (24px, weight 650, line-height 30px); the inspector filename is (14px, weight 600). Tile/list titles and working controls use the existing compact interface range (12–13px), with tabular numerals for inventory, bytes, dates and counts. Smaller context labels retain their subordinate role. The format badge (9px), empty-state heading (16px), and narrow title (22px) are observed local choices, not additions to the global type ramp.

The store retains search/filter/sort, grid/list mode and focused image across leaving Images for a related note and returning within the running app. Inspection selection and deletion checks are separate states. Delete checks are offered only for managed files with no detected references and a complete scan; removal is confirmed, freshly checked by storage, and followed by refresh. Imported source attachments remain read-only. Loading skeletons, incomplete/error banners with Retry, no-images and no-results states, clear-filter actions, unavailable previews with Retry, and a deletion-in-progress label make recovery explicit.

### Focus and explicit viewing

The windowed gallery is one keyboard listbox with a mounted-only active descendant. Arrow keys, Home/End and Page Up/Down select and reveal an image. Enter opens the original; Space toggles an eligible unused managed file. A click selects details; double-click opens the original. Controls retain meaningful translated labels and the established link-colored focus outline.

When a narrow detail transition hides the gallery, focus moves after visibility commits to the details region. Back reveals the selected row and returns focus to the gallery. Full viewing uses the existing Modal, initially focuses Close, loops keyboard focus among its enabled buttons and restores focus to a visible gallery or details region on close. Left/right navigate the filtered results; +/−, 0, wheel, Fit, 1:1 and pointer drag provide deliberate viewing controls. The inspector also exposes Show file and individual related-note actions; protected version/unindexed references are context, rather than editable note actions.

### Preview and asset boundary

Grid/list and inspector images use the same bounded preview path; the inspector prioritizes its request. A thumbnail error has a placeholder, and the inspector supplies Retry and explicit original viewing. Gallery work pauses while the original viewer is open; hidden documents pause new queued work, and unmounted/offscreen requests release their queued clients. The native (480 × 360px) raster cache is derived runtime data, not a shipped identity asset. SVGs no larger than (256 KiB) are the documented original-vector exception and render as isolated image resources. Full raster originals enter the viewer only after an explicit action. The four JPEG captures are QA evidence only.

## Finish evidence and documentation boundary

The documenter directly read `ImagesView.tsx`, `ImagesView.css`, `LibraryImageViewer.tsx`, `store/imageLibrary.ts`, `imagePreviews.ts`, the relevant native preview clauses, PRODUCT.md, DESIGN.md and the incumbent sidecar; it opened all four required captures. `desktop.jpg` and `list.jpg` show the wide (1440 × 901px) composition. `mobile.jpg` and `mobile-details.jpg` show the single-region (390 × 844px) adaptation. The tall SVG's final blocks and portrait scan remain inside their frames.

The bounded reviewer report at `.impeccable/review/images/finish-review.md` records **ship**, resolving gallery containment, FORM delegation authority and the small-SVG original-vector exception. Its verdict covers those three fixes. `checks.json` records focus restoration, related-note return with the linked scope preserved, state recovery and bounded rendering for a synthetic 50,000-file inventory. `scan-report.json` and `preview-report.json` support the copied-vault/source-preservation and preview measurements above. The zero-original-request field is restricted to the fixture's full-view endpoint and does not exclude direct small-SVG bytes.

The implementation pass supplied a completed native macOS bundle build, 55 passing node tests with zero skipped, and four passing native image-preview tests. Documentation did not rerun these checks or measure live battery use or renderer memory. The finish report's earlier “native bundle pending” sentence is a historical status; its three-fix verdict is unchanged.

No global system or Tags file is rewritten for this extension. The detector's three type-size advisories remain local, nonmaterial observations; their values are not canonized to suppress the detector. `impeccable context` also reports an older sidecar generation timestamp and an unset project buildPath. Those pre-existing context advisories are recorded without an unsolicited sidecar/config refresh.
