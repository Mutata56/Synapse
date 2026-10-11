import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const project = path.resolve(import.meta.dirname, "..");
const pureBuild = await build({ entryPoints: [path.join(project, "src/lib/obsidianImport.ts")], bundle: true, write: false, platform: "node", format: "esm" });
const helpers = await import(`data:text/javascript;base64,${Buffer.from(pureBuild.outputFiles[0].text).toString("base64")}`);
const tauriPlugin = { name: "test-tauri-filesystem", setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\// }, (args) => ({ path: args.path, namespace: "fake-tauri" }));
    builder.onLoad({ filter: /.*/, namespace: "fake-tauri" }, (args) => {
      if (args.path === "@tauri-apps/plugin-fs") return { contents: `const fs = globalThis.__synapseTestFs;
        export const BaseDirectory = { AppData: 1 };
        export const { copyFile, exists, mkdir, readDir, readFile, readTextFile, remove, rename, stat, writeFile, writeTextFile } = fs;` };
      if (args.path === "@tauri-apps/api/path") return { contents: `const fs = globalThis.__synapseTestFs;
        export const appDataDir = async () => fs.root;
        export const join = async (...parts) => parts.join('/');` };
      if (args.path === "@tauri-apps/api/core") return { contents: "export const convertFileSrc = path => 'asset:///' + encodeURIComponent(path); export const isTauri = () => Boolean(globalThis.__synapseNativeInventory); export const invoke = async (name) => { if (globalThis.__synapseNativeInventory) return globalThis.__synapseNativeInventory(name); throw new Error('Unexpected invoke: ' + name); };" };
      throw new Error(`Unexpected Tauri dependency: ${args.path}`);
    });
  } };
const buildOptions = { bundle: true, write: false, platform: "node", format: "esm", plugins: [tauriPlugin] };
const storageBuild = await build({ ...buildOptions, entryPoints: [path.join(project, "src/lib/storage.ts")] });
const storeBuild = await build({ ...buildOptions, stdin: { contents: "export * from './src/lib/storage.ts'; export { useNotesStore } from './src/store/notes.ts'; export { useToastStore } from './src/store/toasts.ts';", resolveDir: project } });

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("tag finder keeps multi-tag filters across navigation and preserves legacy single-tag links without file writes", async (t) => {
  const f = await fixture(t, {}, undefined, true);
  const store = f.storage.useNotesStore;
  store.getState().setTagsFilter({ tags: ['#WMS', 'wms', 'WTMS'], match: 'any' });
  store.getState().setView('notes');
  store.getState().setView('tags');
  assert.deepEqual(store.getState().tagsFilter, { tags: ['wms', 'wtms'], match: 'any', untagged: false });
  store.getState().setTagsFilter({ untagged: true });
  assert.deepEqual(store.getState().tagsFilter.tags, []);
  store.getState().setCurrentTag('#WMS/Picking');
  assert.equal(store.getState().currentTag, 'wms/picking');
  assert.deepEqual(store.getState().tagsFilter, { tags: ['wms/picking'], match: 'all', untagged: false });
  store.getState().setCurrentTag(null);
  assert.deepEqual(store.getState().tagsFilter.tags, []);
  assert.deepEqual(f.mutations, []);
});

async function fixture(t, sources = {}, existingVault, withStore = false) {
  globalThis.__synapseNativeInventory = undefined;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-import-test-"));
  const notes = path.join(root, "notes");
  await fs.mkdir(path.join(notes, ".synapse"), { recursive: true });
  if (existingVault) await fs.cp(existingVault, notes, { recursive: true, preserveTimestamps: true });
  else {
    for (const [name, content] of Object.entries(sources)) {
      const file = path.join(notes, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    }
    await fs.writeFile(path.join(notes, ".synapse/obsidian-import.json"), JSON.stringify({
      version: 1, kind: "obsidian", sourceVault: "test-source", importedAt: new Date().toISOString(), notePaths: Object.keys(sources).filter((name) => name.endsWith(".md")),
    }));
  }
  const mutations = [];
  const reads = [];
  const pending = new Set();
  let beforeWrite;
  const bounded = (relative) => {
    const absolute = path.resolve(root, relative);
    assert(absolute.startsWith(root + path.sep), `FS escaped fixture: ${relative}`);
    return absolute;
  };
  const track = (promise) => {
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  globalThis.__synapseTestFs = {
    root,
    copyFile: (from, to) => track(fs.copyFile(bounded(from), bounded(to))),
    exists: async (name) => { try { await fs.access(bounded(name)); return true; } catch { return false; } },
    mkdir: (name, opts) => track(fs.mkdir(bounded(name), { recursive: opts?.recursive })),
    readDir: async (name) => (await fs.readdir(bounded(name), { withFileTypes: true })).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile(), isSymlink: entry.isSymbolicLink() })),
    readFile: async (name) => { reads.push(name); return new Uint8Array(await fs.readFile(bounded(name))); },
    // Match plugin-fs: its default TextDecoder strips the UTF-8 BOM.
    readTextFile: async (name) => { reads.push(name); return new TextDecoder().decode(await fs.readFile(bounded(name))); },
    remove: (name, opts) => track(fs.rm(bounded(name), { recursive: Boolean(opts?.recursive) })),
    rename: (from, to) => { mutations.push(["rename", from, to]); return track(fs.rename(bounded(from), bounded(to))); },
    stat: (name) => fs.stat(bounded(name)),
    writeFile: (name, bytes) => { mutations.push(["write", name]); return track(fs.writeFile(bounded(name), bytes)); },
    writeTextFile: async (name, text) => {
      if (beforeWrite) await beforeWrite(name, text);
      mutations.push(["write", name]);
      return track(fs.writeFile(bounded(name), text));
    },
  };
  globalThis.window ??= { setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout };
  const source = `${(withStore ? storeBuild : storageBuild).outputFiles[0].text}\n// isolated fixture ${randomUUID()}`;
  const modulePath = path.join(root, "storage.mjs");
  await fs.writeFile(modulePath, source);
  const storage = await import(pathToFileURL(modulePath));
  t.after(async () => {
    while (pending.size) await Promise.allSettled([...pending]);
    // listTree flushes its disposable metadata cache in the background.
    await new Promise((resolve) => setTimeout(resolve, 30));
    while (pending.size) await Promise.allSettled([...pending]);
    await fs.rm(root, { recursive: true, force: true });
  });
  return { storage, notes, mutations, reads, read: (name) => fs.readFile(path.join(notes, name), "utf8"),
    interceptWrite: (callback) => { beforeWrite = callback; } };
}

test("image library includes vault attachments, protects history and caches unchanged note references without modifying originals", async (t) => {
  const name = 'b'.repeat(64) + '.png';
  const sources = {
    'Work/note.md': '![[Images/схема.png|300]]\n![local](local.jpg)\n',
    'Images/схема.png': Buffer.from('original png bytes'),
    'Work/local.jpg': Buffer.from('original jpg bytes'),
    ['.assets/'+name]: Buffer.from('managed png bytes'),
    ['.versions/Work/note/1.md']: `![old](.assets/${name})`,
  };
  const f = await fixture(t, sources);
  const before = new Map(await Promise.all(Object.keys(sources).map(async name => [name, sha(await fs.readFile(path.join(f.notes,name)))])));
  const first = await f.storage.listImageLibrary();
  assert.equal(first.complete,true); assert.equal(first.images.length,3);
  assert.deepEqual(first.images.find(image=>image.id==='Images/схема.png').usedBy.map(usage=>usage.id),['Work/note']);
  assert.equal(first.images.find(image=>image.id==='Work/local.jpg').managed,false);
  assert.equal(first.images.find(image=>image.id==='.assets/'+name).usedBy[0].id,'__versions__');
  await assert.rejects(f.storage.deleteUnusedLibraryImages(['Images/схема.png']));
  await assert.rejects(f.storage.deleteUnusedLibraryImages(['.assets/'+name]));
  f.reads.length = 0;
  await f.storage.listImageLibrary();
  assert.equal(f.reads.filter(file=>file.endsWith('.md')).length,0,'a warm scan must not reread unchanged note bodies or immutable versions');
  for(const [file,hash] of before) assert.equal(sha(await fs.readFile(path.join(f.notes,file))),hash);
  await fs.writeFile(path.join(f.notes,'Work/note.md'),'# updated without image references\n');
  f.reads.length = 0;
  const changed = await f.storage.listImageLibrary();
  assert.equal(changed.images.find(image=>image.id==='Images/схема.png').usedBy.length,0);
  assert.deepEqual([...new Set(f.reads.filter(file=>file.endsWith('.md')))],['notes/Work/note.md'],'only the modified note should be read');
});

test("an empty managed asset collection skips all note-body scanning", async (t) => {
  const f = await fixture(t, {'note.md':'# text\n![[file.png]]','file.png':Buffer.from('image')});
  f.reads.length=0;
  assert.deepEqual(await f.storage.listAssets(),[]); assert.equal(f.reads.filter(file=>file.endsWith('.md')).length,0);
});

test("frontmatter bytes survive a body edit, including BOM, CRLF, comments and nested YAML", () => {
  const yaml = '\uFEFF---\r\n# keep this comment\r\ncustom:\r\n  nested: "a: b"\r\naliases:\r\n  - old\r\n---\r\n';
  const raw = yaml + "# before\r\n";
  assert.deepEqual(helpers.splitMarkdownSource(raw), { frontmatter: yaml, body: "# before\r\n" });
  assert.equal(helpers.markdownSourceToWrite(raw, raw, "# after\r\n"), yaml + "# after\r\n");
  assert.equal(helpers.markdownSourceToWrite(raw, "explicit source", "ignored body"), "explicit source");
  assert.equal(helpers.normalizeSourceEdit("# edited\n", raw), "# edited\r\n");
  assert.equal(helpers.markdownSourceToWrite("\uFEFFbefore\n", undefined, "after\n"), "\uFEFFafter\n");
  assert.throws(() => helpers.assertMarkdownSourceUnchanged(raw, raw + "outside"), helpers.MarkdownSourceConflictError);
});

test("preview handles aliases, headings and embeds while leaving fenced, inline and indented code alone", () => {
  const body = "[[Folder/Note#Part|alias]]\n![[pic.png|400]]\n`[[inline]]` and `` ` [[double]] ``\n~~~text\n[[fenced]]\n~~~\n    [[indented]]\n[[visible]]";
  const preview = helpers.obsidianMarkdownPreview(body);
  assert(preview.includes("[alias](synapse-note:Folder%2FNote%23Part)"));
  assert(preview.includes('![400](synapse-embed:pic.png "400")'));
  assert(preview.includes("`[[inline]]` and `` ` [[double]] ``"));
  assert(preview.includes("~~~text\n[[fenced]]\n~~~"));
  assert(preview.includes("    [[indented]]"));
  assert(preview.includes("[visible](synapse-note:visible)"));
});

test("vault paths resolve relative links and unique basenames but reject escapes and ambiguity", () => {
  const files = helpers.indexVaultFiles(["Docs/Note.md", "Docs/image.png", "assets/unique.png", "first/shared.png", "second/shared.png"]);
  assert.equal(helpers.resolveVaultReference("image.png", "Docs/Note", files, { relativeFirst: true }), "Docs/image.png");
  assert.equal(helpers.resolveVaultReference("../assets/unique.png", "Docs/Note", files, { relativeFirst: true }), "assets/unique.png");
  assert.equal(helpers.resolveVaultReference("unique.png", "Docs/Note", files), "assets/unique.png");
  assert.equal(helpers.resolveVaultReference("shared.png", "Docs/Note", files), null);
  for (const bad of ["../../private.png", "/etc/passwd", "file:///etc/passwd", "C:\\private.png", "%2e%2e/%2e%2e/private.png"]) assert.equal(helpers.resolveVaultReference(bad, "Docs/Note", files), null);
  assert.equal(helpers.resolveVaultReference("missing/unique.png", "Docs/Note", files), null);
});

test("opening and reading imported notes never writes them or creates UI overrides", async (t) => {
  const raw = '---\ncustom: untouched\n---\n# body\n';
  const f = await fixture(t, { "Папка/Название.md": raw });
  const before = await fs.stat(path.join(f.notes, "Папка/Название.md"));
  const note = await f.storage.readNote("Папка/Название");
  assert.equal(note.title, "Название");
  assert.equal(note.markdownSource, true);
  assert.equal(note.sourceRevision, raw);
  assert.equal(note.sourceText, raw);
  assert.equal(note.content, "# body\n");
  const tree = await f.storage.listTree();
  assert.equal(tree[0].children[0].note.title, "Название");
  assert.equal(await f.read("Папка/Название.md"), raw);
  assert.equal((await fs.stat(path.join(f.notes, "Папка/Название.md"))).mtimeMs, before.mtimeMs);
  assert(!f.mutations.some((entry) => entry.slice(1).some((name) => name.endsWith("Название.md"))));
  await assert.rejects(fs.access(path.join(f.notes, ".synapse/obsidian-metadata.json")));
});

test("favorite, title, icon and aliases persist in the sidecar without changing unknown YAML or file mtime", async (t) => {
  const raw = '\uFEFF---\r\ntitle: Original\r\ncustom:\r\n  flag: true\r\n# comment\r\n---\r\n[[other]]\r\n';
  const f = await fixture(t, { "Note.md": raw });
  const before = await fs.stat(path.join(f.notes, "Note.md"));
  const note = await f.storage.readNote("Note");
  await f.storage.writeNote({ ...note, favorite: true, title: "Renamed", icon: "📚", aliases: ["alias"], updatedAt: Date.now() });
  assert.equal(await f.read("Note.md"), raw);
  assert.equal((await fs.stat(path.join(f.notes, "Note.md"))).mtimeMs, before.mtimeMs);
  f.storage.resetStorageCaches();
  const reread = await f.storage.readNote("Note");
  assert.equal(reread.favorite, true);
  assert.equal(reread.title, "Renamed");
  assert.equal(reread.icon, "📚");
  assert.deepEqual(reread.aliases, ["alias"]);
  assert.equal(reread.sourceText, raw);
  const sidecar = JSON.parse(await f.read(".synapse/obsidian-metadata.json"));
  assert.equal(sidecar.notes.Note.markdownSource, true);
  assert.equal(sidecar.notes.Note.title, "Renamed");
});

test("body edits preserve original YAML and source edits retain the complete requested text", async (t) => {
  const yaml = '---\ncustom: |\n  keep\n  this\n---\n';
  const f = await fixture(t, { "Note.md": yaml + "before\n" });
  const note = await f.storage.readNote("Note");
  await f.storage.writeNote({ ...note, content: "after\n", updatedAt: Date.now() });
  assert.equal(await f.read("Note.md"), yaml + "after\n");
  const latest = await f.storage.readNote("Note");
  const changed = "---\ntitle: Explicit title\nother: { a: 1 }\n---\n![[image.png]]\n";
  await f.storage.writeNote({ ...latest, sourceText: changed, updatedAt: Date.now() });
  assert.equal(await f.read("Note.md"), changed);
  assert.equal((await f.storage.readNote("Note")).title, "Explicit title");
  assert.equal(latest.createdAt, (await f.storage.readNote("Note")).createdAt);
  assert((await f.storage.listNoteVersions("Note")).length >= 1);
});

test("external edits reject stale source saves; metadata updates cannot clobber externally changed content", async (t) => {
  const f = await fixture(t, { "Note.md": "original\n" });
  const note = await f.storage.readNote("Note");
  await fs.writeFile(path.join(f.notes, "Note.md"), "outside\n");
  await assert.rejects(f.storage.writeNote({ ...note, sourceText: "inside\n" }), /изменён вне Synapse/);
  assert.equal(await f.read("Note.md"), "outside\n");
  await f.storage.writeNote({ ...note, favorite: true, updatedAt: Date.now() });
  assert.equal(await f.read("Note.md"), "outside\n");
  assert.equal((await f.storage.readNote("Note")).favorite, true);
});

test("UTF-8 BOM survives real SDK decoding behavior, body saves and complete-source snapshots", async (t) => {
  const f = await fixture(t, { "Note.md": "\uFEFFbefore\n" });
  const note = await f.storage.readNote("Note");
  assert.equal(note.sourceRevision, "\uFEFFbefore\n");
  await f.storage.writeNote({ ...note, content: "after\n", updatedAt: Date.now() });
  assert.equal(await f.read("Note.md"), "\uFEFFafter\n");
  const versions = await f.storage.listNoteVersions("Note");
  assert.equal((await f.storage.readNoteVersion("Note", versions[0].timestamp)).sourceText, "\uFEFFbefore\n");
});

test("external changes during staging abort the rename and clean up the temporary source", async (t) => {
  const f = await fixture(t, { "Note.md": "original\n" });
  const note = await f.storage.readNote("Note");
  f.interceptWrite(async (name) => { if (name.includes("Note.md.synapse-")) await fs.writeFile(path.join(f.notes, "Note.md"), "outside-during-save\n"); });
  await assert.rejects(f.storage.writeNote({ ...note, sourceText: "inside\n" }), /изменён вне Synapse/);
  assert.equal(await f.read("Note.md"), "outside-during-save\n");
  assert(!(await fs.readdir(f.notes)).some((name) => name.includes(".synapse-") && name.endsWith(".tmp")));
});

test("source mode and UI overrides survive note/folder moves, rename, trash and collision restore", async (t) => {
  const raw = "---\ncustom: preserved\n---\n# Original\n";
  const f = await fixture(t, { "Folder/Note.md": raw });
  const original = await f.storage.readNote("Folder/Note");
  await f.storage.writeNote({ ...original, favorite: true, title: "UI title", updatedAt: Date.now() });
  const moved = await f.storage.moveNote("Folder/Note", "Other");
  assert.equal(await f.read(`${moved}.md`), raw);
  assert.equal((await f.storage.readNote(moved)).markdownSource, true);
  const folder = await f.storage.renameFolder("Other", "Renamed");
  const nextId = `${folder}/Note`;
  assert.equal((await f.storage.readNote(nextId)).favorite, true);
  const trashId = await f.storage.trashNote(nextId);
  const trashTree = await f.storage.listTrashTree();
  assert.equal(trashTree[0].children[0].note.title, "UI title");
  await fs.writeFile(path.join(f.notes, `${nextId}.md`), "unrelated new file");
  const restored = await f.storage.restoreFromTrash(trashId);
  assert.notEqual(restored.path, nextId);
  f.storage.resetStorageCaches();
  const final = await f.storage.readNote(restored.path);
  assert.equal(final.markdownSource, true);
  assert.equal(final.favorite, true);
  assert.equal(final.title, "UI title");
  assert.equal(final.sourceRevision, raw);
  assert.equal((await f.storage.readNote(nextId)).markdownSource, undefined);
  const trashedFolder = await f.storage.trashFolder("Renamed");
  const restoredFolder = await f.storage.restoreFromTrash(trashedFolder);
  assert.equal((await f.storage.readNote(`${restoredFolder.path}/${path.basename(restored.path)}`)).sourceRevision, raw);
});

test("attachments keep arbitrary original names; symlinks are excluded from inventory", async (t) => {
  const f = await fixture(t, { "Note.md": "![[pictures/Фото 1.png]]", "pictures/Фото 1.png": Buffer.from([1, 2, 3]) });
  await fs.symlink("/etc/passwd", path.join(f.notes, "outside.txt"));
  const inventory = await f.storage.listVaultFiles();
  assert(inventory.includes("pictures/Фото 1.png"));
  assert(!inventory.includes("outside.txt"));
  assert.equal(helpers.resolveVaultReference("Фото%201.png", "Note", helpers.indexVaultFiles(inventory)), "pictures/Фото 1.png");
});

test("a failed post-move metadata commit leaves the moved file safely marked as source after restart", async (t) => {
  const f = await fixture(t, { "Note.md": "original\n" });
  let sidecarWrites = 0;
  f.interceptWrite(async (name) => {
    if (name === "notes/.synapse/obsidian-metadata.json.tmp" && ++sidecarWrites === 2) throw new Error("Simulated disk error after move");
  });
  await assert.rejects(f.storage.trashNote("Note"), /Simulated disk error/);
  assert.equal(await f.read(".trash/Note.md"), "original\n");
  f.storage.resetStorageCaches();
  assert.equal((await f.storage.listTrashTree())[0].note.markdownSource, true);
  const sidecar = JSON.parse(await f.read(".synapse/obsidian-metadata.json"));
  assert.equal(sidecar.notes.Note.markdownSource, true);
  assert.equal(sidecar.notes[".trash/Note"].markdownSource, true);
});

const vault = process.env.SYNAPSE_IMPORT_NOTES_DIR;
test("full copied vault: every manifest note loads through the store in source mode, filename titles are usable, and no original bytes change", { skip: !vault }, async (t) => {
  const f = await fixture(t, {}, vault, true);
  const manifest = JSON.parse(await f.read(".synapse/obsidian-import.json"));
  const initialHashes = new Map();
  for (const notePath of manifest.notePaths) initialHashes.set(notePath, sha(await fs.readFile(path.join(f.notes, notePath))));
  const store = f.storage.useNotesStore;
  await store.getState().refreshTree();
  const tree = store.getState().tree;
  const flat = [];
  const walk = (nodes) => { for (const node of nodes) node.kind === "folder" ? walk(node.children) : flat.push(node.note); };
  walk(tree);
  assert.equal(flat.length, manifest.notePaths.length);
  for (const meta of flat) {
    assert.equal(meta.markdownSource, true, meta.id);
    assert(meta.title.trim(), `empty title: ${meta.id}`);
    await store.getState().selectNote(meta.id);
    const note = store.getState().activeNote;
    assert.equal(note.sourceText, await f.read(`${meta.id}.md`));
    assert.equal(note.sourceRevision, note.sourceText);
    assert.equal(note.content, helpers.splitMarkdownSource(note.sourceText).body);
  }
  assert(!f.mutations.some((entry) => entry.slice(1).some((name) => name.endsWith(".md"))));
  await store.getState().toggleFavorite(flat[0].id);
  await store.getState().saveNote({ title: "Metadata-only test title" });
  assert.equal(store.getState().activeNote.title, "Metadata-only test title");
  for (const [name, hash] of initialHashes) assert.equal(sha(await fs.readFile(path.join(f.notes, name))), hash, name);
  assert(!f.mutations.some((entry) => entry.slice(1).some((name) => name.endsWith(".md"))));
  console.log(`Verified ${flat.length} copied Markdown notes without source mutations`);
});


test("native image metadata matches the filesystem fallback, stays fresh and cannot hide incomplete scans", async (t) => {
  const managed='c'.repeat(64)+'.png';
  const f=await fixture(t,{'note.md':'![[picture.png]]','picture.png':'original',['.assets/'+managed]:'managed','.versions/note/1.md':`![[.assets/${managed}]]`});
  const before=await f.storage.listImageLibrary();
  let complete=true;let calls=0;
  globalThis.__synapseNativeInventory=async command=>{
    assert.equal(command,'image_inventory');calls++;
    const item=async name=>{const info=await fs.stat(path.join(f.notes,name));return {path:name,mtime:info.mtime.getTime(),size:info.size};};
    return {images:await Promise.all(['picture.png','.assets/'+managed].map(item)),notes:await Promise.all(['note.md','.versions/note/1.md'].map(item)),complete};
  };
  f.reads.length=0;
  const bulk=await f.storage.listImageLibrary();
  assert.equal(calls,1);assert.deepEqual(bulk,before);
  assert.equal(f.reads.filter(name=>name.endsWith('.md')).length,0);
  await fs.writeFile(path.join(f.notes,'note.md'),'Reference removed from this changed note.');
  const fresh=await f.storage.listImageLibrary();
  assert.equal(fresh.images.find(image=>image.id==='picture.png').usedBy.length,0);
  assert.equal(fresh.images.find(image=>image.id==='.assets/'+managed).usedBy[0].id,'__versions__');
  complete=false;assert.equal((await f.storage.listImageLibrary()).complete,false);
  await assert.rejects(f.storage.deleteUnusedLibraryImages(['.assets/'+managed]));
  globalThis.__synapseNativeInventory=async()=>{throw Error('Command image_inventory not found');};
  const fallback=await f.storage.listImageLibrary();assert.equal(fallback.complete,true);
  assert.equal(fallback.images.find(image=>image.id==='picture.png').usedBy.length,0);
  assert.equal(await f.read('picture.png'),'original');
});

test("imported rich blocks survive restart and moves while metadata stays light and Markdown keeps its original YAML", async (t) => {
  const raw='---\n# user comment\ncustom: {nested: true}\n---\n\nOriginal.\n';
  const f=await fixture(t,{"Note.md":raw});
  const note=await f.storage.readNote('Note');
  const source=raw.replace('Original.','Edited.');
  const blocknote=JSON.stringify([{id:'table',type:'dataTable',props:{data:'{"rows":["user data"]}'}}]);
  const sourceMap=JSON.stringify({version:1,source,prefix:source,suffix:'',chunks:[]});
  await f.storage.writeNote({...note,sourceText:source,sourceMap,blocknote});
  assert.equal(await f.read('Note.md'),source);
  f.storage.resetStorageCaches();
  const saved=await f.storage.readNote('Note');
  assert.equal(saved.blocknote,blocknote);
  assert.equal(saved.sourceMap,sourceMap);
  const tree=await f.storage.listTree();
  const meta=tree.find(n=>n.kind==='note').note;
  assert.equal(meta.editor,undefined);
  assert.equal(meta.blocknote,undefined);
  assert.equal(meta.sourceMap,undefined);
  await f.storage.writeNote({...saved,title:'New title'});
  assert.equal(await f.read('Note.md'),source);
  const moved=await f.storage.moveNote('Note','Folder');
  f.storage.resetStorageCaches();
  assert.equal((await f.storage.readNote(moved)).blocknote,blocknote);
  assert.equal(await f.read(moved+'.md'),source);
});

test("editing imported Markdown directly clears stale block state and an external conflict cannot replace it", async(t)=>{
  const f=await fixture(t,{'Note.md':'Original.\n'});
  const note=await f.storage.readNote('Note');
  await f.storage.writeNote({...note,blocknote:'[{"id":"b","type":"paragraph"}]',sourceMap:JSON.stringify({source:note.sourceRevision})});
  const cached=await f.storage.readNote('Note');
  await f.storage.writeNote({...cached,sourceText:'Direct Markdown.\n'});
  f.storage.resetStorageCaches();
  const direct=await f.storage.readNote('Note');
  assert.equal(direct.sourceText,'Direct Markdown.\n');
  assert.equal(direct.blocknote,null);
  assert.equal(direct.sourceMap,null);
  await fs.writeFile(path.join(f.notes,'Note.md'),'External.\n');
  await assert.rejects(f.storage.writeNote({...direct,sourceText:'Stale blocks.\n',blocknote:'[]',sourceMap:JSON.stringify({source:'Stale blocks.\n'})}),/Файл изменён/);
  assert.equal(await f.read('Note.md'),'External.\n');
});
