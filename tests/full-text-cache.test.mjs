import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "synapse-search-cache-"));
const entry = join(temporary, "search.mjs");
await build({ entryPoints: ["src/lib/fullTextSearch.ts"], bundle: true, platform: "node", format: "esm", outfile: entry, plugins: [{
  name: "memory-reader",
  setup(builder) {
    builder.onResolve({ filter: /^\.\/storage$/ }, args => args.importer === resolve("src/lib/fullTextSearch.ts") ? { path: "storage", namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const readNote = id => globalThis.__synapseSearchReader(id);" }));
  },
}] });
let scenario = 0;
const fresh = reader => { globalThis.__synapseSearchReader = reader; return import(`${pathToFileURL(entry).href}?case=${scenario++}`); };
const note = (id, extra = {}) => ({ id, title: id, folder: "", createdAt: 1, updatedAt: 1, icon: null, cover: null, preview: "", favorite: false, tags: [], links: [], ...extra });
after(async () => { delete globalThis.__synapseSearchReader; await rm(temporary, { recursive: true, force: true }); });

test("cold overlapping searches and word statistics share every disk read and still find body-only matches", async () => {
  let reads = 0;
  const { buildSearchDocs, searchFullText, wordCountsFor } = await fresh(async () => { reads++; await new Promise(resolve => setTimeout(resolve, 3)); return { content: "ordinary hiddenphrase body" }; });
  const notes = Array.from({ length: 40 }, (_, i) => note(`note-${i}`));
  const [first, second, words] = await Promise.all([buildSearchDocs(notes), buildSearchDocs(notes), wordCountsFor(notes)]);
  assert.equal(reads, 40);
  assert.equal(searchFullText(first, "hiddenphrase").length, 40);
  assert.equal(searchFullText(second, "HIDDENPHRASE").length, 40);
  assert(words.every(entry => entry.words === 3));
  await buildSearchDocs(notes); await wordCountsFor(notes);
  assert.equal(reads, 40);
});

test("a slow previous revision cannot replace a newer cached body", async () => {
  const pending = [];
  const { buildSearchDocs } = await fresh(() => new Promise(resolve => pending.push(resolve)));
  const older = buildSearchDocs([note("same")]);
  const newer = buildSearchDocs([note("same", { updatedAt: 2 })]);
  await Promise.resolve(); // shared reads begin after the flight is installed
  assert.equal(pending.length, 2);
  pending[1]({ content: "newest body" }); assert.equal((await newer)[0].body, "newest body");
  pending[0]({ content: "older body" }); assert.equal((await older)[0].body, "older body");
  assert.equal((await buildSearchDocs([note("same", { updatedAt: 2 })]))[0].body, "newest body");
  assert.equal(pending.length, 2);
});

test("temporary missing reads retry for search and word counts instead of caching empty content", async () => {
  const attempts = new Map();
  const { buildSearchDocs, wordCountsFor } = await fresh(async id => {
    const count = (attempts.get(id) ?? 0) + 1; attempts.set(id, count);
    return count === 1 ? null : { content: "recovered body" };
  });
  assert.equal((await buildSearchDocs([note("search")]))[0].body, "");
  assert.equal((await buildSearchDocs([note("search")]))[0].body, "recovered body");
  assert.equal((await wordCountsFor([note("words")]))[0].words, 0);
  assert.equal((await wordCountsFor([note("words")]))[0].words, 2);
  assert.equal(attempts.get("search"), 2); assert.equal(attempts.get("words"), 2);
});

test("failed reads release the shared flight and the next request can recover", async () => {
  let reads = 0;
  const { buildSearchDocs } = await fresh(async () => { if (++reads === 1) throw new Error("temporary read failure"); return { content: "recovered" }; });
  await assert.rejects(buildSearchDocs([note("retry")]), /temporary read failure/);
  assert.equal((await buildSearchDocs([note("retry")]))[0].body, "recovered");
  assert.equal(reads, 2);
});

test("a cold scan keeps bounded read concurrency and reuses bodies after metadata-only changes", async () => {
  let active = 0, peak = 0, reads = 0;
  const { buildSearchDocs } = await fresh(async () => { reads++; peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return { content: "body" }; });
  const notes = Array.from({ length: 100 }, (_, i) => note(String(i)));
  assert.equal((await buildSearchDocs(notes)).length, 100);
  assert(peak <= 8); assert.equal(reads, 100);
  const changed = notes.map(note => ({ ...note, title: `renamed ${note.id}`, favorite: true }));
  const docs = await buildSearchDocs(changed);
  assert(docs.every(doc => doc.titleLower.startsWith("renamed ") && doc.note.favorite));
  assert.equal(reads, 100);
});
