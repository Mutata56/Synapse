import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "note-library-"));
const entry = join(temporary, "library.mjs");
await build({ entryPoints: ["src/lib/noteLibrary.ts"], bundle: true, platform: "node", format: "esm", outfile: entry });
const { buildLibraryIndex, queryLibrary, layoutLibrary, libraryWindow, libraryExcerpt, libraryColumns } = await import(pathToFileURL(entry));
after(() => rm(temporary, { recursive: true, force: true }));
const note = (id, options = {}) => ({ id, title: id, folder: "", createdAt: 1, updatedAt: 1, icon: null, cover: null, preview: "", favorite: false, tags: [], links: [], ...options });
const filter = options => ({ query: "", folder: "", favorite: false, tag: "", sort: "updated", ...options });

test("metadata index deduplicates ids and counts each ancestor without changing source metadata", () => {
  const a = note("a", { folder: "Работа/WMS", tags: ["#SQL", "sql", "ＷＭＳ"], favorite: true });
  const b = note("b", { folder: "Работа/WMS/Driver" });
  const original = JSON.stringify([a, b]);
  const index = buildLibraryIndex([a, a, b]);
  assert.equal(index.entries.length, 2); assert.equal(index.favoriteCount, 1);
  assert.deepEqual(index.roots, [{ path: "Работа", count: 2 }]);
  assert.equal(index.folders.find(folder => folder.path === "Работа/WMS").count, 2);
  assert.deepEqual(index.tags, ["sql", "wms"]); assert.equal(JSON.stringify([a, b]), original);
});

test("search combines case-normalized title, alias, folder, preview and tags; filters have intersection semantics", () => {
  const notes = [note("a", { title: "План Driver", aliases: ["WTMS"], folder: "Работа/WMS", preview: "Приёмка товаров", tags: ["SQL"], favorite: true }), note("b", { folder: "Работа/WMS2", title: "Driver" }), note("c", { folder: "Работа/WMS/Code", tags: ["sql"] })];
  const index = buildLibraryIndex(notes);
  assert.deepEqual(queryLibrary(index, filter({ query: "wtms приёмка #sql" })).map(note => note.id), ["a"]);
  assert.deepEqual(queryLibrary(index, filter({ query: "wtms приёмка sql", folder: "Работа/WMS", favorite: true, tag: "#SQL" })).map(note => note.id), ["a"]);
  assert.deepEqual(queryLibrary(index, filter({ folder: "Работа/WMS" })).map(note => note.id).sort(), ["a", "c"]);
  assert.equal(queryLibrary(index, filter({ query: "not found" })).length, 0);
});

test("natural sorting stays deterministic and does not reorder the source array", () => {
  const notes = [note("a", { title: "Тема 10", updatedAt: 5, createdAt: 1 }), note("b", { title: "Тема 2", updatedAt: 3, createdAt: 9 })];
  const index = buildLibraryIndex(notes);
  assert.deepEqual(queryLibrary(index, filter()).map(note => note.id), ["a", "b"]);
  assert.deepEqual(queryLibrary(index, filter({ sort: "created" })).map(note => note.id), ["b", "a"]);
  assert.deepEqual(queryLibrary(index, filter({ sort: "title" })).map(note => note.id), ["b", "a"]);
  assert.deepEqual(notes.map(note => note.id), ["a", "b"]);
});

test("card excerpts remove leading tag noise and wiki markup without changing source text", () => {
  const original = { title: "0. Карта проекта", preview: "#WMS #обучение Карта проекта [!tip] Задача приходит через [[Inbox|входящую очередь]]." };
  const text = original.preview;
  assert.equal(libraryExcerpt(original), "Задача приходит через входящую очередь.");
  assert.equal(original.preview, text);
  assert.equal(libraryExcerpt({ title: "Нода", preview: "В тексте #тег остаётся на месте" }), "В тексте #тег остаётся на месте");
});

test("shelves include all notes exactly once, including root notes and sparse groups", () => {
  const notes = [note("root"), note("a", { folder: "Учёба/SQL" }), note("b", { folder: "Учёба/Java" }), note("c", { folder: "Работа/WMS" })];
  for (const grouping of ["section", "folder", "none"]) {
    const layout = layoutLibrary(notes, 3, 282, grouping);
    assert.deepEqual(layout.rows.flatMap(row => row.kind === "cards" ? row.notes.map(note => note.id) : []).sort(), ["a", "b", "c", "root"]);
    assert(layout.rows.every((row, i) => !i || row.top >= layout.rows[i - 1].top + layout.rows[i - 1].height));
  }
  const scoped = layoutLibrary(notes.filter(note => note.folder.startsWith("Учёба/")), 3, 282, "section", "Учёба");
  assert.deepEqual(scoped.rows.filter(row => row.kind === "heading").map(row => row.label), ["SQL", "Java"]);
  assert.deepEqual(libraryWindow(layoutLibrary([], 3, 282, "section"), 0, 600).rows, []);
});

test("card columns follow measured work width, including narrow and compact layouts", () => {
  assert.equal(libraryColumns(354), 1);
  assert.equal(libraryColumns(700), 2);
  assert.equal(libraryColumns(1100), 3);
  assert.equal(libraryColumns(1100, true), 4);
  assert.equal(libraryColumns(0), 1);
});

test("50,000-note windows stay bounded and reach the first and last records", () => {
  const notes = Array.from({ length: 50000 }, (_, i) => note(String(i), { folder: `Раздел ${Math.floor(i / 1000)}`, title: `Тема ${i}`, updatedAt: 50000 - i }));
  const started = performance.now(), index = buildLibraryIndex(notes);
  const result = queryLibrary(index, filter()), layout = layoutLibrary(result, 3, 282, "section");
  const first = libraryWindow(layout, 0, 900), middle = libraryWindow(layout, layout.height / 2, 900), last = libraryWindow(layout, layout.height - 900, 900);
  const mounted = window => window.rows.reduce((count, row) => count + (row.kind === "cards" ? row.notes.length : 0), 0);
  assert(first.rows.some(row => row.kind === "cards" && row.notes.some(note => note.id === "0")));
  assert(last.rows.some(row => row.kind === "cards" && row.notes.some(note => note.id === "49999")));
  assert(mounted(first) <= 24 && mounted(middle) <= 24 && mounted(last) <= 24);
  const sorted = index.sorted.get("updated"); queryLibrary(index, filter({ query: "тема 49" }));
  assert.equal(index.sorted.get("updated"), sorted, "typing reuses the sorted metadata index");
  console.log(JSON.stringify({ notes: notes.length, indexQueryLayoutMs: Math.round(performance.now() - started), mountedFirst: mounted(first), mountedMiddle: mounted(middle), mountedLast: mounted(last) }));
});
