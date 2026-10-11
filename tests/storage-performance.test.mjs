import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture } from "./helpers/workspace.mjs";

const flatten = tree => tree.flatMap(node => node.kind === "note" ? [node.note] : flatten(node.children));
const source = title => `\uFEFF---\r\nunknown-key: untouched\r\n---\r\n# ${title}\r\n\r\n#performance [[Peer]]\r\n`;

test("editing one imported note keeps other metadata cached and updates its preview state", async t => {
  let reads = 0;
  const f = await fixture(t, Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Source/n${i}.md`, source(i)])), undefined, false,
    (op, name) => { if ((op === "readFile" || op === "readTextFile") && name.endsWith(".md")) reads++; });
  await f.storage.listTree();
  const note = await f.storage.readNote("Source/n0");
  await f.storage.writeNote({ ...note, favorite: true });
  reads = 0;
  let notes = flatten(await f.storage.listTree());
  assert.equal(reads, 1, "one overlay change must not invalidate the whole vault");
  assert.equal(notes.find(n => n.id === note.id).favorite, true);
  await f.storage.writeNote({ ...note, title: "Renamed display title", favorite: false });
  reads = 0;
  notes = flatten(await f.storage.listTree());
  assert.equal(reads, 1);
  assert.equal(notes.find(n => n.id === note.id).title, "Renamed display title");
  assert.equal(notes.find(n => n.id === note.id).favorite, false);
  assert.equal(await f.read("Source/n0.md"), source(0));
});

test("source note moves reuse unchanged metadata without weakening collision or external-edit checks", async t => {
  let reads = 0;
  const f = await fixture(t, { "Source/same.md": source("one"), "Destination/same.md": source("other"), "Source/unique.md": source("unique") }, undefined, false,
    (op, name) => { if ((op === "readFile" || op === "readTextFile") && name.endsWith(".md")) reads++; });
  await f.storage.listTree();
  const moved = await f.storage.moveNote("Source/unique", "Destination");
  reads = 0;
  let notes = flatten(await f.storage.listTree());
  assert.equal(reads, 0);
  assert.equal(notes.find(n => n.id === moved).folder, "Destination");
  assert.equal(await f.read(`${moved}.md`), source("unique"));
  const collision = await f.storage.moveNote("Source/same", "Destination");
  reads = 0;
  notes = flatten(await f.storage.listTree());
  assert.equal(reads, 1, "a changed basename must recalculate filename fallback title");
  assert.equal(notes.find(n => n.id === collision).title, collision.split("/").pop());
  await fs.appendFile(path.join(f.notes, `${moved}.md`), "\r\n#external-change\r\n");
  reads = 0;
  notes = flatten(await f.storage.listTree());
  assert.equal(reads, 1);
  assert(notes.find(n => n.id === moved).tags.includes("external-change"));
});

test("folder moves keep native and source cache paths correct and leave their bytes intact", async t => {
  let reads = 0;
  const native = '---\nid: Original/native\r\ntitle: Native title\r\n---\r\nNative body [[Peer]]\r\n';
  const f = await fixture(t, { "Original/source.md": source("source"), "Original/native.md": native, "Other/outside.md": source("outside") }, undefined, false,
    (op, name) => { if ((op === "readFile" || op === "readTextFile") && name.endsWith(".md")) reads++; });
  await fs.writeFile(path.join(f.notes, ".synapse/obsidian-metadata.json"), JSON.stringify({ version: 1, notes: { "Original/native": { markdownSource: false } } }));
  await f.storage.listTree();
  await f.storage.createFolder("", "Destination");
  const moved = await f.storage.moveFolder("Original", "Destination");
  reads = 0;
  const notes = flatten(await f.storage.listTree());
  assert.equal(reads, 0);
  assert(notes.some(n => n.id === `${moved}/native` && n.folder === moved && n.title === "Native title"));
  assert.equal(await f.read(`${moved}/native.md`), native);
  assert.equal(await f.read(`${moved}/source.md`), source("source"));
  assert(notes.some(n => n.id === "Other/outside"));
});

test("failed metadata persistence leaves the previous in-memory cache and source intact", async t => {
  let reads = 0;
  const f = await fixture(t, { "a.md": source("a"), "b.md": source("b") }, undefined, false,
    (op, name) => { if ((op === "readFile" || op === "readTextFile") && name.endsWith(".md")) reads++; });
  await f.storage.listTree();
  const note = await f.storage.readNote("a");
  f.interceptWrite((name, text) => { if (name.includes("obsidian-metadata") && text.includes('"favorite": true')) throw new Error("injected disk failure"); });
  await assert.rejects(f.storage.writeNote({ ...note, favorite: true }), /injected disk failure/);
  reads = 0;
  const notes = flatten(await f.storage.listTree());
  assert.equal(reads, 0);
  assert.equal(notes.find(n => n.id === "a").favorite, false);
  assert.equal(await f.read("a.md"), source("a"));
});
