import { createRoot } from "react-dom/client";
import { useState } from "react";
import { FileBrowser } from "../../src/components/FileBrowser";
import { Sidebar } from "../../src/components/Sidebar";
import { LanguageProvider } from "../../src/components/LanguageProvider";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { Toaster } from "../../src/components/Toaster";
import { useNotesStore } from "../../src/store/notes";
import { entryTarget, extractFileTargets, getFileIndex, movableFileTargets, normalizeFileTargets, targetPath, type FileTarget } from "../../src/lib/fileBrowser";
import type { NoteMeta, TreeNode } from "../../src/lib/storage";
import "../../src/index.css";
import "./files-bench.css";

// In-memory demonstration data. No connector or filesystem call is allowed.
const params = new URLSearchParams(location.search);
const leaf = "Ascend/RoadMaps/DBA RoadMap/Этап 02 SELECT";
const titles = ["2.03 WHERE и предикаты", "2.04 NULL и трёхзначная логика", "2.05 LIKE и поиск по шаблону", "2.06 ORDER BY DISTINCT и дедупликация", "2.10 Преобразование типов", "2.10.1 CAST общие основы преобразования", "2.10.2 CAST в PostgreSQL", "2.10.3 CAST в SQL Server", "2.04.1 ISNULL в SQL Server", "2.04.3 SET ANSI_NULLS поведение", "Заметки к занятию", "Практические задания", "Источники и ссылки"];
const count = Math.max(1, Math.min(50000, Number(params.get("nodes") || titles.length)));
localStorage.setItem("sidebar-width", params.get("sidebar") || "295");
localStorage.setItem("i18n-lang", params.get("lang") || "ru");
document.documentElement.dataset.theme = params.get("theme") || "dark";
const bodies = new Map<string, string>();
const metrics = { reads: 0, moves: 0, trashed: 0, restored: 0, deleted: 0, opened: "" };
function note(id: string, title: string): NoteMeta {
  bodies.set(id, `# ${title}\n\nЭто синтетическая заметка для проверки файлового интерфейса.\n\n- Поиск и выделение\n- Перемещение и восстановление\n\nНикаких файлов на диске этот стенд не изменяет.\n`);
  return { id, title, folder: id.slice(0, id.lastIndexOf("/")), updatedAt: Date.UTC(2026, 9, title.startsWith("2.0") ? 5 : 4), createdAt: Date.UTC(2026, 9, 1), preview: "Синтетическая запись", icon: null, cover: null, favorite: false, tags: ["dba", "sql", "этап2"], links: [], mood: null };
}
function insert(tree: TreeNode[], node: TreeNode, parent: string): TreeNode[] {
  if (!parent) return [...tree, node];
  const parts = parent.split("/");
  const add = (items: TreeNode[], level: number): TreeNode[] => {
    const path = parts.slice(0, level + 1).join("/");
    const found = items.find(item => item.kind === "folder" && item.path === path);
    const folder = found?.kind === "folder" ? found : { kind: "folder" as const, path, name: parts[level], children: [] };
    const children = level === parts.length - 1 ? [...folder.children, node] : add(folder.children, level + 1);
    return [...items.filter(item => item !== found), { ...folder, children }];
  };
  return add(tree, 0);
}
function rebase(node: TreeNode, from: string, to: string): TreeNode {
  if (node.kind === "note") { const id = to + node.note.id.slice(from.length); const body = bodies.get(node.note.id); if (body) bodies.set(id, body); return { kind: "note", note: { ...node.note, id, folder: id.slice(0, Math.max(0, id.lastIndexOf("/"))) } }; }
  const path = to + node.path.slice(from.length);
  return { ...node, path, name: path.split("/").pop()!, children: node.children.map(child => rebase(child, from, to)) };
}
let tree: TreeNode[] = [];
for (const path of ["ВУЗ", "Работа", leaf, `${leaf}/Архив`, "Z_Мусорка"]) tree = insert(tree, { kind: "folder", name: path.split("/").pop()!, path, children: [] }, path.slice(0, Math.max(0, path.lastIndexOf("/"))));
const generated: TreeNode[] = Array.from({ length: count }, (_, i) => ({ kind: "note", note: note(`${leaf}/n-${i}`, count <= titles.length ? titles[i] : `Заметка ${String(i).padStart(5, "0")}`) }));
const populate = (nodes: TreeNode[]): TreeNode[] => nodes.map(node => node.kind !== "folder" ? node : node.path === leaf ? { ...node, children: [...node.children, ...generated] } : { ...node, children: populate(node.children) });
tree = populate(tree);
let trashTree: TreeNode[] = [];
for (let i = 0; i < 4; i++) trashTree = insert(trashTree, { kind: "note", note: note(`Удалённое/Запись ${i}`, `Удалённая заметка ${i}`) }, "Удалённое");
const delay = async () => { await new Promise(resolve => setTimeout(resolve, 80)); };
const typed = (items: (string | FileTarget)[], source: TreeNode[]) => items.map(item => typeof item === "string" ? getFileIndex(source).byKey.get(`note:${item}`) ? { kind: "note" as const, id: item } : { kind: "folder" as const, path: item } : item);
useNotesStore.setState({ tree, trashTree, currentFolder: leaf, currentTrashFolder: "", expandedFolders: new Set(), view: params.has("trash") ? "trash" : "files",
  refreshTree: async () => {}, refreshTrash: async () => {},
  selectNote: async id => { metrics.opened = id; useNotesStore.setState({ activeId: id, view: "notes" }); },
  batchMove: async (source, destination) => {
    await delay(); const state = useNotesStore.getState(), items = movableFileTargets(source, destination);
    const extracted = extractFileTargets(state.tree, items); let next = extracted.tree;
    for (const item of items) { const node = extracted.captured.get(`${item.kind}:${targetPath(item)}`); if (!node) continue; const basename = targetPath(item).split("/").pop()!; const to = destination ? `${destination}/${basename}` : basename; next = insert(next, rebase(node, targetPath(item), to), destination); }
    metrics.moves += items.length; useNotesStore.setState({ tree: next }); return { moved: items.length, failed: [] };
  },
  batchTrash: async (notes, folders) => {
    await delay(); const state = useNotesStore.getState(), items = normalizeFileTargets([...notes.map(id => ({ kind: "note" as const, id })), ...folders.map(path => ({ kind: "folder" as const, path }))]);
    const extracted = extractFileTargets(state.tree, items); let trash = state.trashTree;
    for (const node of extracted.captured.values()) { const path = node.kind === "note" ? node.note.id : node.path; trash = insert(trash, node, path.slice(0, Math.max(0, path.lastIndexOf("/")))); }
    metrics.trashed += items.length; useNotesStore.setState({ tree: extracted.tree, trashTree: trash });
  },
  batchRestoreTrash: async source => {
    await delay(); const state = useNotesStore.getState(), items = typed(source, state.trashTree), extracted = extractFileTargets(state.trashTree, items); let next = state.tree;
    for (const node of extracted.captured.values()) { const path = node.kind === "note" ? node.note.id : node.path; next = insert(next, node, path.slice(0, Math.max(0, path.lastIndexOf("/")))); }
    metrics.restored += items.length; useNotesStore.setState({ tree: next, trashTree: extracted.tree });
  },
  batchDeleteForever: async source => { await delay(); const state = useNotesStore.getState(), items = typed(source, state.trashTree); metrics.deleted += items.length; useNotesStore.setState({ trashTree: extractFileTargets(state.trashTree, items).tree }); },
  emptyTrash: async () => { await delay(); useNotesStore.setState({ trashTree: [] }); },
  createNote: async (folder, title) => { const id = `${folder}/${title}`; useNotesStore.setState({ tree: insert(useNotesStore.getState().tree, { kind: "note", note: note(id, title) }, folder) }); },
  createFolder: async (parent, name) => { const path = parent ? `${parent}/${name}` : name; useNotesStore.setState({ tree: insert(useNotesStore.getState().tree, { kind: "folder", path, name, children: [] }, parent) }); },
  renameNote: async (id, title) => { const state = useNotesStore.getState(), removed = extractFileTargets(state.tree, [{ kind: "note", id }]), node = removed.captured.get(`note:${id}`); if (node?.kind === "note") useNotesStore.setState({ tree: insert(removed.tree, { ...node, note: { ...node.note, title } }, node.note.folder) }); },
  renameFolder: async (path, name) => { const state = useNotesStore.getState(), removed = extractFileTargets(state.tree, [{ kind: "folder", path }]), node = removed.captured.get(`folder:${path}`); if (node) { const parent = path.slice(0, Math.max(0, path.lastIndexOf("/"))); useNotesStore.setState({ tree: insert(removed.tree, rebase(node, path, parent ? `${parent}/${name}` : name), parent) }); } },
});
function App() {
  const view = useNotesStore(state => state.view);
  const [initial] = useState([`note:${leaf}/n-0`, `note:${leaf}/n-1`]);
  return <LanguageProvider><main className="files-bench-shell"><Sidebar />{view === "files" || view === "trash" ? <FileBrowser key={view} mode={view} initialSelected={params.has("unselected") || view === "trash" ? [] : initial} readBody={async id => { metrics.reads++; const output = document.getElementById("files-bench-metrics"); if (output) output.textContent = JSON.stringify(metrics); return bodies.get(id) || "Синтетический пример"; }} /> : <section className="files-bench-note"><h1>Локальная заметка</h1><button onClick={() => useNotesStore.setState({ view: "files" })}>Вернуться к файлам</button></section>}<ConfirmDialog /><Toaster /><output id="files-bench-metrics" hidden>{JSON.stringify(metrics)}</output></main></LanguageProvider>;
}
useNotesStore.subscribe(() => { const output = document.getElementById("files-bench-metrics"); if (output) output.textContent = JSON.stringify(metrics); });
createRoot(document.getElementById("root")!).render(<App />);
