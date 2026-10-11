import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fixture } from "../helpers/workspace.mjs";

const cleanup = [];
const t = { after: fn => cleanup.push(fn) };
const count = Number(process.argv[3] || 500);
let reads = 0, stats = 0;
const sources = Object.fromEntries(Array.from({ length: count }, (_, i) => [
  `Source/n-${String(i).padStart(5, "0")}.md`,
  `\uFEFF---\r\ntags: [performance]\r\nprivate-key: preserved\r\n---\r\n# Note ${i}\r\n\r\n[[Other]]\r\n`,
]));
try {
  const f = await fixture(t, sources, undefined, true, (op, path) => {
    if ((op === "readFile" || op === "readTextFile") && path.endsWith(".md")) reads++;
    if (op === "stat") stats++;
  });
  const { storage } = f;
  const started = performance.now(); let tree = await storage.listTree();
  const cold = { ms: performance.now() - started, reads, stats };
  const note = await storage.readNote("Source/n-00000");
  await storage.writeNote({ ...note, favorite: true });
  reads = 0; stats = 0;
  const refreshStart = performance.now(); tree = await storage.listTree();
  const edited = { ms: performance.now() - refreshStart, reads, stats };
  await storage.createFolder("", "Destination");
  tree = await storage.listTree();
  storage.useNotesStore.setState({ tree, currentFolder: "Source", undoStack: [], redoStack: [], _undoRedoBusy: false });
  reads = 0; stats = 0;
  const moveStart = performance.now();
  const result = await storage.useNotesStore.getState().batchMove(Object.keys(sources).map(name => ({ kind: "note", id: name.slice(0, -3) })), "Destination");
  const moved = { ms: performance.now() - moveStart, reads, stats, ...result };
  const flat = storage.useNotesStore.getState().tree.find(n => n.kind === "folder" && n.path === "Destination");
  const preserved = await f.read("Destination/n-00001.md") === sources["Source/n-00001.md"];
  const compare = Array.from({ length: 5000 }, (_, i) => ({ kind: "note", note: { title: `Note ${5000 - i}` } }));
  const sortStart = performance.now(); compare.sort(storage.compareTreeNodes);
  const report = { engine: "Node with real disposable filesystem and Tauri adapter", count, cold, edited, moved, destinationCount: flat.children.length, sourceBytesPreserved: preserved, sort5000Ms: performance.now() - sortStart };
  console.log(JSON.stringify(report));
  if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2));
} finally { for (const fn of cleanup.reverse()) await fn(); }
