// Run after `npm run build -- --manifest`; checks the built static dependency graph.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const manifestPath = resolve(process.argv[2] ?? "dist/.vite/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const dist = resolve(dirname(manifestPath), "..");
const entry = Object.keys(manifest).find(key => manifest[key].isEntry && manifest[key].src === "index.html");
assert(entry, "Application entry is missing");
const chunk = name => {
  const key = Object.keys(manifest).find(key => manifest[key].isDynamicEntry && basename(manifest[key].file).startsWith(name + "-") && manifest[key].file.endsWith(".js"));
  assert(key, `Missing on-demand ${name} chunk`);
  return key;
};
const reachable = seeds => {
  const found = new Set();
  const visit = key => { if (found.has(key)) return; found.add(key); for (const dependency of manifest[key].imports ?? []) visit(dependency); };
  seeds.forEach(visit); return found;
};
const app = chunk("App"), capture = chunk("CaptureWindow"), editor = chunk("Editor2026"), source = chunk("MarkdownSourceEditor");
const library = reachable([entry, app]), quickCapture = reachable([entry, capture]);
assert(!library.has(editor) && !library.has(source), "The library loads an editor before a note is opened");
assert(!quickCapture.has(app) && !quickCapture.has(editor), "Quick capture loads the main application/editor");
const bytes = async graph => (await Promise.all([...graph].map(async key => (await readFile(resolve(dist, manifest[key].file))).byteLength))).reduce((sum, value) => sum + value, 0);
const libraryBytes = await bytes(library), captureBytes = await bytes(quickCapture);
assert(libraryBytes < 1_500_000, "Library startup JavaScript exceeds its 1.5 MB budget");
assert(captureBytes < 350_000, "Capture startup JavaScript exceeds its 350 KB budget");
console.log(JSON.stringify({ libraryBytes, captureBytes, editorDeferred: true, sourceEditorDeferred: true, captureIsolated: true }));
