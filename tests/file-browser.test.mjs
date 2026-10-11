import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { fixture } from "./helpers/workspace.mjs";
const temporary = await mkdtemp(join(tmpdir(), "file-browser-"));
const entry = join(temporary, "pure.mjs");
await build({ stdin: { contents: "export * from './src/lib/fileBrowser.ts'; export * from './src/lib/treeKeys.ts'; export { windowRange } from './src/lib/tagExplorer.ts';", resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", outfile: entry });
const { getFileIndex, fileRows, closestFileFolder, normalizeFileTargets, movableFileTargets, extractFileTargets, fileRangeSelection, stableKey, rebaseKeys, windowRange } = await import(pathToFileURL(entry));
after(() => rm(temporary, { recursive: true, force: true }));
const note = (id, title = id, updatedAt = 1) => ({ kind: "note", note: { id, title, folder: id.slice(0, Math.max(0, id.lastIndexOf("/"))), tags: [], updatedAt } });
const folder = (path, children = []) => ({ kind: "folder", name: path.split("/").at(-1), path, children });

test("file and folder identities, cached counts and stale navigation remain distinct", () => {
  const tree = [folder("foo", [note("foo/a"), folder("foo/inner", [note("foo/inner/b")])]), note("foo")];
  const index = getFileIndex(tree);
  assert.equal(getFileIndex(tree), index);
  assert.equal(index.byKey.get("note:foo").kind, "note");
  assert.equal(index.byKey.get("folder:foo").notes, 2);
  assert.equal(index.byKey.get("folder:foo").folders, 1);
  assert.equal(index.notes, 3);
  assert.equal(closestFileFolder(index, "foo/inner/missing"), "foo/inner");
  assert.equal(closestFileFolder(index, "removed/path"), "");
  assert.notEqual(getFileIndex([...tree]), index);
});

test("folder browsing and descendant searches sort naturally without mutating the tree", () => {
  const tree = [folder("A", [note("A/n10", "Запись 10", 4), note("A/n2", "Запись 2", 8), folder("A/child", [note("A/child/deep", "Глубокая запись")])])];
  const index = getFileIndex(tree);
  assert.deepEqual(fileRows(index, "A", "", false, "all", "name", false).map(row => row.name), ["child", "Запись 2", "Запись 10"]);
  assert.equal(fileRows(index, "A", "глубокая", false, "all", "name", false).length, 0);
  assert.equal(fileRows(index, "A", "ГЛУБОКАЯ", true, "note", "name", false)[0].path, "A/child/deep");
  assert.equal(fileRows(index, "A", "", false, "note", "modified", true)[0].path, "A/n2");
  assert.equal(tree[0].children[0].note.id, "A/n10");
});

test("ancestor selection removes duplicate work while preserving a same-name sibling note", () => {
  const targets = [{ kind: "folder", path: "foo" }, { kind: "note", id: "foo" }, { kind: "note", id: "foo/a" }, { kind: "folder", path: "foo/child" }, { kind: "folder", path: "foo" }];
  assert.deepEqual(normalizeFileTargets(targets), targets.slice(0, 2));
  assert.deepEqual(movableFileTargets(targets, "foo/child"), [{ kind: "note", id: "foo" }]);
  const tree = [folder("foo", [note("foo/a")]), note("foo"), folder("untouched")];
  const result = extractFileTargets(tree, [{ kind: "folder", path: "foo" }]);
  assert.equal(result.tree[0].note.id, "foo"); assert.equal(result.tree[1], tree[2]);
  assert.equal(result.captured.get("folder:foo"), tree[0]);
  assert.equal(extractFileTargets(tree, []).tree, tree);
});

test("range and additive selection handle mixed entries and remain bounded at 50,000 rows", () => {
  const keys = ["folder:a", "note:a", "note:b", "folder:c"];
  assert.deepEqual([...fileRangeSelection(keys, new Set(), 2, 0, false, true)], keys.slice(0, 3));
  assert.deepEqual([...fileRangeSelection(keys, new Set([keys[0]]), 2, 2, true, false)], [keys[0], keys[2]]);
  const tree = [folder("large", Array.from({ length: 50000 }, (_, i) => note(`large/${i}`, `Заметка ${i}`)))];
  const index = getFileIndex(tree); assert.equal(index.folders.get("large").notes, 50000);
  const range = windowRange(50000, 1000000, 700, 49);
  assert(range.end - range.start <= 40);
  assert.equal(getFileIndex(tree), index);
});

test("stable sidebar keys rebase only the correct file or folder subtree", () => {
  const file = stableKey("same", "note"), dir = stableKey("same", "folder"), child = stableKey("same/a", "note");
  assert.notEqual(file, dir);
  rebaseKeys("same", "target/same", "folder");
  assert.equal(stableKey("same", "note"), file);
  assert.equal(stableKey("target/same", "folder"), dir);
  assert.equal(stableKey("target/same/a", "note"), child);
});

test("batch move scans once, preserves same-name source files and groups undo/redo", async t => {
  const rawA = '\uFEFF---\r\ncustom: keep-a\r\n---\r\n# A\r\n', rawB = '---\ncustom: keep-b\n---\n# B\n';
  const f = await fixture(t, { "A/shared.md": rawA, "B/shared.md": rawB, "Destination/keep.md": "# keep" }, undefined, true);
  const store = f.storage.useNotesStore;
  await store.getState().refreshTree();
  let refreshes = 0; const refresh = store.getState().refreshTree;
  store.setState({ refreshTree: async () => { refreshes++; await refresh(); } });
  const result = await store.getState().batchMove([{ kind: "note", id: "A/shared" }, { kind: "note", id: "B/shared" }], "Destination");
  assert.equal(result.moved, 2); assert.deepEqual(result.failed, []); assert.equal(refreshes, 1);
  const files = (await readdir(join(f.notes, "Destination"))).filter(name => name.endsWith(".md") && name !== "keep.md");
  assert.equal(files.length, 2);
  const contents = await Promise.all(files.map(name => readFile(join(f.notes, "Destination", name), "utf8")));
  assert(contents.includes(rawA)); assert(contents.includes(rawB));
  assert.equal(store.getState()._undoStack.length, 1);
  await store.getState().undo(); assert.equal(refreshes, 2);
  assert.equal(await f.read("A/shared.md"), rawA); assert.equal(await f.read("B/shared.md"), rawB);
  await store.getState().redo(); assert.equal(refreshes, 3);
  assert.equal(store.getState()._undoRedoBusy, false);
});

test("moving and trashing a folder cannot take its same-name Markdown neighbor's identity", async t => {
  const f = await fixture(t, { "foo.md": "---\ncustom: outside\n---\n# outside", "foo/child.md": "# child", "Destination/keep.md": "# keep" }, undefined, true);
  await f.storage.writeNote({ ...await f.storage.readNote("foo"), favorite: true });
  const store = f.storage.useNotesStore; await store.getState().refreshTree();
  store.setState({ activeId: "foo", activeNote: await f.storage.readNote("foo"), backStack: ["foo", "foo/child"] });
  await store.getState().batchMove([{ kind: "folder", path: "foo" }], "Destination");
  assert.equal(store.getState().activeId, "foo");
  assert.deepEqual(store.getState().backStack, ["foo", "Destination/foo/child"]);
  assert.equal((await f.storage.readNote("foo")).markdownSource, true);
  assert.equal((await f.storage.readNote("foo")).favorite, true);
  assert.equal((await f.storage.readNote("Destination/foo/child")).markdownSource, true);
  await store.getState().batchTrash(["foo"], ["Destination/foo"]);
  await store.getState().refreshTrash();
  assert.equal(getFileIndex(store.getState().trashTree).byKey.get("note:foo").kind, "note");
});

test("typed restore and permanent delete keep same-name trash file and folder separate", async t => {
  const f = await fixture(t, { "foo.md": "# outside", "foo/child.md": "# child" }, undefined, true);
  const store = f.storage.useNotesStore; await store.getState().refreshTree();
  await store.getState().batchTrash(["foo"], ["foo"]); await store.getState().refreshTrash();
  assert.equal(getFileIndex(store.getState().trashTree).entries.length, 3);
  await store.getState().batchRestoreTrash([{ kind: "folder", path: "foo" }]);
  assert.equal((await f.storage.readNote("foo/child")).content, "# child");
  assert.equal(await f.storage.readNote("foo"), null);
  assert.equal(getFileIndex(store.getState().trashTree).byKey.get("note:foo").kind, "note");
  await store.getState().batchDeleteForever([{ kind: "note", id: "foo" }]);
  assert.equal((await f.storage.readNote("foo/child")).markdownSource, true);
});

test("batch folder collisions undo to original names and preserve embedded attachments", async t => {
  const f = await fixture(t, { "A/same/a.md": "# A", "B/same/b.md": "# B", "B/same/asset.png": Buffer.from([0, 255, 13, 7]), "Destination/keep.md": "# keep" }, undefined, true);
  const store = f.storage.useNotesStore; await store.getState().refreshTree();
  const result = await store.getState().batchMove([{ kind: "folder", path: "A/same" }, { kind: "folder", path: "B/same" }, { kind: "note", id: "A/same/a" }], "Destination");
  assert.equal(result.moved, 2);
  assert.equal(store.getState()._undoStack.length, 1);
  await store.getState().undo();
  assert.equal(await f.read("A/same/a.md"), "# A"); assert.equal(await f.read("B/same/b.md"), "# B");
  assert.deepEqual(await readFile(join(f.notes, "B/same/asset.png")), Buffer.from([0, 255, 13, 7]));
  await store.getState().redo();
  const moved = [...getFileIndex(store.getState().tree).folders.keys()].filter(path => path.startsWith("Destination/same"));
  assert.equal(moved.length, 2);
});

test("in-flight duplicate batch requests cannot overwrite or create a second undo operation", async t => {
  const f = await fixture(t, { "A/source.md": "# unchanged", "Destination/keep.md": "# keep" }, undefined, true);
  const store = f.storage.useNotesStore; await store.getState().refreshTree();
  const targets = [{ kind: "note", id: "A/source" }];
  const results = await Promise.all([store.getState().batchMove(targets, "Destination"), store.getState().batchMove(targets, "Destination")]);
  assert.deepEqual(results.map(result => result.moved), [1, 0]);
  assert.equal(store.getState()._undoStack.length, 1);
  assert.equal(await f.read("Destination/source.md"), "# unchanged");
});
