import { createRoot } from "react-dom/client";
import { useState } from "react";
import { GraphView } from "../../src/components/GraphView";
import { useNotesStore } from "../../src/store/notes";
import type { SearchDoc } from "../../src/lib/fullTextSearch";
import type { NoteMeta, TreeNode } from "../../src/lib/storage";
import "../../src/index.css";
import { getGraphDiagnostics } from "../../src/lib/graphDiagnostics";
import { recordGraphDiagnostic } from "../../src/lib/graphDiagnostics";
import { Application } from "pixi.js";
import { LocalGraphWebGL } from "../../src/editor2026/LocalGraphWebGL";
const originalRender = Application.prototype.render;
Application.prototype.render = function () { recordGraphDiagnostic("pixiRenders"); originalRender.call(this); };

const query = new URLSearchParams(location.search);
let documents: SearchDoc[] = [], tree: TreeNode[] = [], obsidianSettings: unknown;
if (query.has("vault")) {
  const response = await fetch("/tests/fixtures/graph-vault.json");
  if (!response.ok) throw new Error("Run scripts/export-graph-fixture.mjs with a copied vault first");
  ({ documents, tree, obsidianSettings } = await response.json());
} else {
  const rawCount = Number(query.get("nodes") ?? 1000);
  const count = Math.max(1, Math.min(20000, Math.floor(Number.isFinite(rawCount) ? rawCount : 1000)));
  for (let group = 0; group < Math.ceil(count / 20); group++) {
    const children: TreeNode[] = [];
    for (let i = group * 20; i < Math.min(count, (group + 1) * 20); i++) {
      const note: NoteMeta = { id: `folder-${group}/note-${i}`, title: `Заметка ${i}`, folder: `folder-${group}`, createdAt: 1700000000000 + i * 1000, updatedAt: 1700000000000, icon: null, cover: null, preview: "Локальная запись для проверки графа", favorite: false, tags: [`тег-${i % 8}`], links: [`заметка ${(i + 1) % count}`, `заметка ${(i + 17) % count}`], mood: null };
      documents.push({ note, body: `[[Заметка ${(i + 1) % count}]] [[Заметка ${(i + 17) % count}]]`, bodyLower: "", titleLower: note.title.toLowerCase() });
      children.push({ kind: "note", note });
    }
    tree.push({ kind: "folder", name: `Папка ${group}`, path: `folder-${group}`, children });
  }
}
// This local fixture has no filesystem. Opening a point records selection only.
useNotesStore.setState({ tree, view: query.has("local") ? "notes" : "graph", activeId: documents[0]?.note.id, selectNote: async (activeId) => {
  useNotesStore.setState({ activeId });
  const metrics = document.getElementById("bench-metrics");
  if (metrics) { metrics.dataset.openedNote = activeId; metrics.dataset.openCount = String(Number(metrics.dataset.openCount ?? 0) + 1); }
} });
function BenchApp() {
  const view = useNotesStore((state) => state.view);
  const [source, setSource] = useState(documents);
  const edit = (body: boolean) => {
    const first = source[0]; if (!first) return;
    const note = { ...first.note, favorite: !first.note.favorite, updatedAt: first.note.updatedAt + (body ? 1 : 0) };
    const next = source.map((document, index) => index ? document : { ...document, note, body: body ? `[[${source[Math.min(2, source.length - 1)].note.title}]]` : document.body });
    const update = (items: TreeNode[]): TreeNode[] => items.map((item) => item.kind === "folder" ? { ...item, children: update(item.children) } : item.note.id === note.id ? { ...item, note } : item);
    useNotesStore.setState({ tree: update(useNotesStore.getState().tree) }); setSource(next);
  };
  const resize = (add: boolean) => {
    const id = "__bench_added__";
    const note: NoteMeta = { ...source[0].note, id, folder: "", title: "Новый узел", links: [], updatedAt: Date.now() };
    const next = add ? [...source, { note, body: `[[${source[0].note.title}]]`, bodyLower: "", titleLower: note.title.toLowerCase() }] : source.filter((document) => document.note.id !== id);
    const remove = (items: TreeNode[]): TreeNode[] => items.filter((item) => item.kind === "folder" || item.note.id !== id).map((item) => item.kind === "folder" ? { ...item, children: remove(item.children) } : item);
    useNotesStore.setState({ tree: [...remove(useNotesStore.getState().tree), ...(add ? [{kind:"note" as const,note}] : [])] }); setSource(next);
  };
  return <main style={{ display: "flex", height: "100vh", width: "100vw" }}>
    {view === "graph" ? <GraphView documents={source} obsidianSettings={obsidianSettings} /> : <section style={{padding:40,width:500}}><h1>Локальная заметка</h1><button onClick={() => useNotesStore.getState().setView("graph")}>Вернуться к графу</button>{query.has("local") ? <LocalGraphWebGL compact /> : null}</section>}
    {query.has("controls") ? <div style={{position:"fixed",right:12,top:12,zIndex:99,display:"flex",gap:8}}>
      <button onClick={() => edit(false)}>Обновить метаданные</button><button onClick={() => edit(true)}>Изменить одну связь</button>
      <button onClick={() => useNotesStore.getState().setView("notes")}>Открыть заметку</button>
      <button onClick={() => resize(true)}>Добавить узел</button><button onClick={() => resize(false)}>Удалить узел</button>
    </div> : null}<output id="bench-metrics" hidden />
  </main>;
}
createRoot(document.getElementById("root")!).render(<BenchApp />);
let lastTime = performance.now(), lastCount = 0, lastMs = 0;
setInterval(() => {
  const host = document.querySelector<HTMLElement>(".graph-render-host"), output = document.getElementById("bench-metrics");
  if (!output) return;
  const count = Number(host?.dataset.graphPaintCount ?? 0), totalMs = Number(host?.dataset.graphPaintMsTotal ?? 0), now = performance.now();
  const frames = Math.max(0, count - lastCount), work = Math.max(0, totalMs - lastMs);
  output.textContent = JSON.stringify({ fps: frames * 1000 / (now - lastTime), frames, renderSubmissionMs: frames ? work / frames : 0, moving: host?.dataset.graphMoving === "true", mode: host?.dataset.graphMode, sampleMs: now - lastTime, scene: host?.dataset.graphMetrics ? JSON.parse(host.dataset.graphMetrics) : null, diagnostics: getGraphDiagnostics() });
  lastCount = count; lastMs = totalMs; lastTime = now;
}, 1000);
