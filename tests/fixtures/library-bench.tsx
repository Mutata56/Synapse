// Local browser verification: every mutation below affects this fixture only.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { NotesGallery } from "../../src/components/NotesGallery";
import { Sidebar } from "../../src/components/Sidebar";
import { LanguageProvider } from "../../src/components/LanguageProvider";
import { useNotesStore } from "../../src/store/notes";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import type { NoteMeta, Note, TreeNode } from "../../src/lib/storage";

import "../../src/index.css";

const params = new URLSearchParams(location.search);
const source: NoteMeta[] = params.has("vault") ? await fetch("/tests/fixtures/library-vault.json").then(response => response.json()) : [];
const workWidth = params.has("width") ? Math.max(320, Math.min(1800, Number(params.get("width")))) : undefined;
const count = Math.max(0, Math.min(50000, Number(params.get("nodes") ?? (source.length || 1000))));
let notes: NoteMeta[] = source.length && !params.has("nodes") ? source : Array.from({ length: count }, (_, i) => ({ id: `section-${Math.floor(i / 100)}/note-${i}`, title: `Заметка ${i}`, folder: `Раздел ${Math.floor(i / 100)}`, createdAt: 1700000000000 + i, updatedAt: 1791650000000 - i * 1000, icon: null, cover: i % 9 === 0 ? "gradient:purple" : null, preview: "Локальная заметка для проверки библиотеки: связи, задачи и идеи проекта. Поиск и группировки используют только метаданные.", favorite: i % 19 === 0, tags: [i % 2 ? "sql" : "wms", "обучение"], links: [] }));
const treeFor = (): TreeNode[] => {
  const root: TreeNode[] = [], folders = new Map<string, Extract<TreeNode, { kind: "folder" }>>();
  for (const note of notes) {
    let branch = root, path = "";
    for (const part of note.folder.split("/").filter(Boolean)) {
      path = path ? path + "/" + part : part;
      let folder = folders.get(path);
      if (!folder) { folder = { kind: "folder", name: part, path, children: [] }; folders.set(path, folder); branch.push(folder); }
      branch = folder.children;
    }
    branch.push({ kind: "note", note });
  }
  return root;
};
let reads = 0, opened = "";
const read = async (id: string): Promise<Note | null> => {
  document.documentElement.dataset.libraryReads = String(++reads);
  if (params.has("error")) return null;
  const note = notes.find(note => note.id === id);
  return note ? { ...note, content: `# ${note.title}\n\n${note.preview}\n\n## Проверка чтения\n\nЭто локальная проверка компонента. Исходные файлы остаются неизменными.\n\n- Markdown\n- Быстрый просмотр\n- Возврат к библиотеке\n\n![Вложение](https://invalid.example/never-request.png)` } : null;
};
useNotesStore.setState({ tree: treeFor(), view: "notes", activeId: null, selectNote: async id => { opened = id; useNotesStore.setState({ activeId: id }); }, createNote: async () => { const note = { icon: null, cover: null, links: [], ...notes[0], id: `new-${Date.now()}`, title: "Новая заметка", folder: "", preview: "", createdAt: Date.now(), updatedAt: Date.now(), tags: [], favorite: false }; notes = [note, ...notes]; useNotesStore.setState({ tree: treeFor() }); }, toggleFavorite: async id => { notes = notes.map(note => note.id === id ? { ...note, favorite: !note.favorite } : note); useNotesStore.setState({ tree: treeFor() }); }, trashNote: async id => { notes = notes.filter(note => note.id !== id); useNotesStore.setState({ tree: treeFor() }); }, batchTrashNotes: async ids => { const selected = new Set(ids); notes = notes.filter(note => !selected.has(note.id)); useNotesStore.setState({ tree: treeFor() }); } });
function Bench() {
  const active = useNotesStore(state => state.activeId), [showSidebar] = useState(!params.has("narrow"));
  return <div style={{ display: "flex", width: workWidth ?? "100vw", height: "100vh", overflow: "hidden" }}>{showSidebar && <Sidebar />}<main style={{ display: "flex", minWidth: 0, flex: 1 }}>{active ? <section style={{ padding: 32 }}><h1>Открыта заметка</h1><p data-opened-note={opened}>{notes.find(note => note.id === active)?.title}</p><button onClick={() => useNotesStore.setState({ activeId: null })}>Вернуться к библиотеке</button></section> : <NotesGallery loadNote={read} />}</main><ConfirmDialog /></div>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<LanguageProvider><Bench /></LanguageProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
