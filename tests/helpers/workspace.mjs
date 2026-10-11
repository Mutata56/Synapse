import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const project = path.resolve(import.meta.dirname, "../..");
const tauriPlugin = { name: "test-tauri-filesystem", setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\// }, (args) => ({ path: args.path, namespace: "fake-tauri" }));
    builder.onLoad({ filter: /.*/, namespace: "fake-tauri" }, (args) => {
      if (args.path === "@tauri-apps/plugin-fs") return { contents: `const fs = globalThis.__synapseTestFs;
        export const BaseDirectory = { AppData: 1 };
        export const { copyFile, exists, mkdir, readDir, readFile, readTextFile, remove, rename, stat, writeFile, writeTextFile } = fs;` };
      if (args.path === "@tauri-apps/api/path") return { contents: `const fs = globalThis.__synapseTestFs;
        export const appDataDir = async () => fs.root;
        export const join = async (...parts) => parts.join('/');` };
      if (args.path === "@tauri-apps/api/core") return { contents: "export const isTauri = () => false; export const convertFileSrc = path => 'asset:///' + encodeURIComponent(path); export const invoke = async (name) => { throw new Error('Unexpected invoke: ' + name); };" };
      throw new Error(`Unexpected Tauri dependency: ${args.path}`);
    });
  } };
const buildOptions = { bundle: true, write: false, platform: "node", format: "esm", plugins: [tauriPlugin] };
const storageBuild = await build({ ...buildOptions, entryPoints: [path.join(project, "src/lib/storage.ts")] });
const storeBuild = await build({ ...buildOptions, stdin: { contents: "export * from './src/lib/storage.ts'; export { useNotesStore, registerFlusher, flushAllPending } from './src/store/notes.ts'; export { useToastStore } from './src/store/toasts.ts';", resolveDir: project } });

export async function fixture(t, sources = {}, existingVault, withStore = false, trace = () => {}) {
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
    readFile: async (name) => { trace("readFile", name); return new Uint8Array(await fs.readFile(bounded(name))); },
    // Match plugin-fs: its default TextDecoder strips the UTF-8 BOM.
    readTextFile: async (name) => { trace("readTextFile", name); return new TextDecoder().decode(await fs.readFile(bounded(name))); },
    remove: (name, opts) => track(fs.rm(bounded(name), { recursive: Boolean(opts?.recursive) })),
    rename: (from, to) => { mutations.push(["rename", from, to]); return track(fs.rename(bounded(from), bounded(to))); },
    stat: (name) => { trace("stat", name); return fs.stat(bounded(name)); },
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
  return { storage, notes, mutations, read: (name) => fs.readFile(path.join(notes, name), "utf8"),
    interceptWrite: (callback) => { beforeWrite = callback; } };
}
