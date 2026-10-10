import { createRoot } from "react-dom/client";
import { GraphView } from "../../src/components/GraphView";
import { useNotesStore } from "../../src/store/notes";
import type { SearchDoc } from "../../src/lib/fullTextSearch";
import type { NoteMeta, TreeNode } from "../../src/lib/storage";
import "../../src/index.css";

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
      const note: NoteMeta = { id: `folder-${group}/note-${i}`, title: `Заметка ${i}`, folder: `folder-${group}`, createdAt: 1700000000000 + i * 1000, updatedAt: 1700000000000, icon: null, cover: null, preview: "Локальная запись для проверки графа", favorite: false, tags: [`тег-${i % 8}`], links: [`Заметка ${(i + 1) % count}`, `Заметка ${(i + 17) % count}`], mood: null };
      documents.push({ note, body: `[[Заметка ${(i + 1) % count}]] [[Заметка ${(i + 17) % count}]]`, bodyLower: "", titleLower: note.title.toLowerCase() });
      children.push({ kind: "note", note });
    }
    tree.push({ kind: "folder", name: `Папка ${group}`, path: `folder-${group}`, children });
  }
}
// This local fixture has no filesystem. Opening a point records selection only.
useNotesStore.setState({ tree, view: "graph", selectNote: async (activeId) => {
  useNotesStore.setState({ activeId });
  const metrics = document.getElementById("bench-metrics");
  if (metrics) { metrics.dataset.openedNote = activeId; metrics.dataset.openCount = String(Number(metrics.dataset.openCount ?? 0) + 1); }
} });
createRoot(document.getElementById("root")!).render(<main style={{ display: "flex", height: "100vh", width: "100vw" }}><GraphView documents={documents} obsidianSettings={obsidianSettings} /><output id="bench-metrics" hidden /></main>);
let lastTime = performance.now(), lastCount = 0, lastMs = 0;
setInterval(() => {
  const host = document.querySelector<HTMLElement>(".graph-render-host"), output = document.getElementById("bench-metrics");
  if (!host || !output) return;
  const count = Number(host.dataset.graphPaintCount ?? 0), totalMs = Number(host.dataset.graphPaintMsTotal ?? 0), now = performance.now();
  const frames = Math.max(0, count - lastCount), work = Math.max(0, totalMs - lastMs);
  output.textContent = JSON.stringify({ fps: frames * 1000 / (now - lastTime), frames, renderSubmissionMs: frames ? work / frames : 0, moving: host.dataset.graphMoving === "true", mode: host.dataset.graphMode, sampleMs: now - lastTime, scene: host.dataset.graphMetrics ? JSON.parse(host.dataset.graphMetrics) : null });
  lastCount = count; lastMs = totalMs; lastTime = now;
}, 1000);
