# Images library

The Images view combines a searchable media library with file details and associated notes. It inventories attachments throughout the vault, including imported attachments with their original filenames, alongside managed uploads in `.assets`. The previous view listed only managed uploads.

## Interface

- One search matches filenames, folders and associated note titles. Folder, format, association and sort controls combine independently.
- Grid and list modes window their rows. The inspector shows the complete image, metadata, file location and related notes. Images use `contain`, including portraits and tall diagrams.
- Narrow work areas show either the library or details, with an explicit back action. Keyboard navigation reveals the selected row and restores focus to a visible region.
- Opening an original loads the viewer on demand, with fit, zoom, pan and previous/next navigation. Opening a related note uses the existing editor; returning preserves filters and selection.
- Imported attachments remain read-only. Cleanup is limited to unused managed uploads and rechecks references, trash and history before removal. Incomplete scans disable cleanup.

## Resource use

`storage.listImageLibrary` scans local file metadata with bounded I/O and caches reference syntax by note modification time and size. Resolving cached syntax against the current image inventory keeps newly added attachments discoverable. Unchanged scans reuse image records and do not reread unchanged Markdown bodies.

The renderer requests previews only for mounted rows and the visible inspector. Requests for the same image coalesce; at most two native preview jobs run concurrently. Queued offscreen jobs cancel, hidden documents pause new jobs, and original viewing pauses gallery previews. There is no polling loop.

Raster previews decode outside the webview, respect EXIF orientation and transparency, and fit within 480 × 360 without upscaling. The native decoder bounds source size, dimensions and allocation. Derived WebP files live separately under application data in `image-previews/v1`; source files are never rewritten. Pruning runs every 32 new cache writes toward 384 files / 128 MiB, so the bound is a periodic pruning target rather than an absolute cap.

Small SVGs up to 256 KiB use their isolated original vector image resource. Larger SVGs and unsupported raster formats show a placeholder with explicit original viewing. Full raster originals enter the renderer only when the user opens them.

## Verification on 2026-10-11

| Evidence | Result |
| --- | --- |
| Copied vault inventory | 39 images, 31 with detected associations |
| Source image bytes / preview bytes | 21,299,713 / 2,125,705 |
| Raster source pixels / preview pixels | 52,012,901 / 3,276,360 |
| Native preview generation with an empty derived cache | 263.94 ms for 39 images |
| Repeated native preview requests | 0.97 ms, 39 cache hits |
| Filesystem scans with an existing reference cache | 34.94 / 32.07 ms; zero Markdown body reads |
| Browser fixture with 50,000 image records | 32 mounted grid tiles or 14 list rows at the inspected desktop viewport |
| Node regression suite, including the complete 530-note copy | 55 passed, none skipped |
| Native image preview tests | 4 passed |
| TypeScript, production web build, macOS bundle and local signature verification | Passed |
| Installed application | Inventory, search, original view, related-note opening and retained filters verified |
| SHA-256 source checks after installed-app verification | 598 files checked, zero changes |

These timings are fixture filesystem/CPU measurements. They do not establish battery savings or live renderer memory consumption. The zero full-original-route request check excludes small SVG preview requests, which carry original vector bytes.

The finish reviewer scored its three material fixes resolved (`ship`): contained gallery images, explicit autonomous composition authority, and accurate SVG preview wording. The established Synapse design system and Tags changes were preserved. Captures and local verification records are under `.impeccable/review/images/`; copied user content stays outside Git under `/private/tmp/synapse-images-review`.

## Reproduce

Run `node --test tests/*.test.mjs`. For the complete source-preservation test, set `SYNAPSE_IMPORT_NOTES_DIR` to a disposable copy of the notes directory. Run `cargo test --offline --release --manifest-path src-tauri/Cargo.toml image_previews --lib`; setting `SYNAPSE_IMAGES_REVIEW_ROOT` to the local review copy also runs the real-image benchmark.

`node tests/ui/prepare-images-review.mjs` creates the local copy if absent and builds the filesystem fixture from current production storage code. Its report records whether a reference cache already existed. After generating native previews with the benchmark, start `npx vite --config .impeccable/preview/images.config.mjs` and inspect `/.impeccable/preview/images.html`. Query modes `stress`, `managed`, `error`, `broken`, `empty` and `partial` exercise bounded rendering and recovery. Managed deletion in this fixture changes only its in-memory collection.


## Second performance pass

The shared image index is now cached by the immutable image-array revision in a WeakMap. Returning to Images no longer normalizes and sorts the same inventory again. Superseded revisions remain collectible; changed filenames, sizes and note associations build a fresh index. Unfiltered results reuse the pre-sorted array through a readonly API. The original viewer also reuses its image-position lookup while zoom changes.

A 50,000-record metadata helper benchmark measured approximately 60 ms for rebuilding on every return and below 1 ms for retrieving the unchanged index. The first build remains approximately 75 ms. This measures Node CPU work in the indexing helper, not total native tab-open latency. Reproduce with `node tests/ui/benchmark-image-index.mjs /path/to/library.json` after preparing the review fixture.

The browser fixture passed 20 open/zoom/close cycles and associated-note return. At its 1280 × 720 viewport it retained 21 grid tiles or 12 list rows; closed viewers left no viewer node. The browser-reported JavaScript heap estimates were about 42–49 MB after warm-up, with observed collection between samples. This fixture shares 39 actual source images across synthetic metadata and uses a preview adapter: it is neither a WKWebView memory measurement nor proof that all native leaks are excluded.

The second pass's full regression suite passed 82 tests with zero skips, including the 530-note copy and changed-revision index invalidation. No source files were modified by the copy-based checks. TypeScript passed. The UI design and native preview pipeline are unchanged.

Native replay was completed on an isolated release copy after the user authorized AppleScript. A unique test executable name avoids macOS accessibility resolving multiple `synapse` processes to the wrong instance. Pilot records affected by lock state or ambiguous app references are excluded.

The actual native bottleneck was hundreds of metadata IPC requests, including a second note-tree traversal. The `image_inventory` command now walks file metadata once outside the webview. Images uses that fresh snapshot to validate cached note metadata and reference tokens; changed notes retain the original metadata reader. The normal tree APIs and original file bytes are preserved. Directory/read failures keep `complete=false`, so partial data cannot enable cleanup. Older hosts and browser fixtures retain the filesystem adapter.

With 39 actual images and 530 live notes, the old warm scans were 576, 570, 616, 569 and 589 ms (median 576 ms). The final scans were 22, 22, 21, 21 and 12 ms (median 21 ms); first final scan was 31 ms. These measure library loading, including associations, in the native release renderer, not a generic claim about every application interaction.

A controlled resource run of the intermediate optimized release recorded approximately 0.09% of one CPU core during a 12-second idle interval and 0.62% during 15 seconds minimized. It included the owned WebKit/GPU/network/capture processes; median physical footprint was roughly 361–394 MiB across those states. These are short observations, not a battery-savings figure or a proof that every native leak is excluded. The final metadata shortcut adds no timer or background loop.

After merging the current workspace/runtime changes from main, all 112 Node tests passed with zero skips. Native library tests and local signature verification also pass; the local verification record stores exact counts and bundle hashes. Test fixtures preserve the 530-note copy and cover native/fallback equivalence, changed references, version protection and incomplete-scan refusal.
