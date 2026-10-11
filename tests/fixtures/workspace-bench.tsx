import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { LanguageProvider } from "../../src/components/LanguageProvider";
import { useNotesStore, registerFlusher } from "../../src/store/notes";
import type { Note, TreeNode } from "../../src/lib/storage";
import "@mantine/core/styles.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../src/index.css";

// Isolated in-memory notes: browser checks never touch the user's vault.
const bodies = new Map<string, Note>();
const makeNote = (id: string, title: string, folder = "", favorite = false): Note => {
  const content = `# ${title}\n\nЭто синтетическая заметка для проверки вкладок и сохранения.\n\n## Проверка\n\nТекст можно редактировать в этом локальном примере.`;
  const note: Note = { id, title, folder, createdAt: 1, updatedAt: 1, icon: null, cover: null, favorite, tags: [], links: [], mood: null, preview: "Заметка для проверки", content, markdownSource: true, sourceText: content, sourceRevision: content };
  bodies.set(id, note); return note;
};
const tree: TreeNode[] = [
  { kind: "folder", name: "ВУЗ", path: "ВУЗ", children: [{kind:"note",note:makeNote("ВУЗ/конспект", "Конспект", "ВУЗ")}] },
  { kind: "folder", name: "Работа", path: "Работа", children: [{kind:"note",note:makeNote("Работа/обзор", "Обзор", "Работа")}] },
  { kind: "folder", name: "Ascend", path: "Ascend", children: [] },
  { kind: "folder", name: "Z_Мусорка", path: "Z_Мусорка", children: [] },
  { kind: "note", note: makeNote("security", "17.66 Security-конфигурация от руки") },
  { kind: "note", note: makeNote("note", "Заметка", "", true) },
  { kind: "note", note: makeNote("guide", "Инструкция по заметкам") },
];
let count = 1;
useNotesStore.setState({ tree, folderColors: {"ВУЗ":"#ee6363","Работа":"#ee6363","Ascend":"#d9a253","Z_Мусорка":"#a9b963"},
  selectNote: async id => { useNotesStore.setState({activeId:id,activeNote:bodies.get(id) ?? null}); },
  closeActiveNote: async () => { useNotesStore.setState({activeId:null,activeNote:null}); },
  createNote: async (folder = "", title = "") => {
    const note = makeNote(`test-${count++}`, title || "Без названия", folder);
    useNotesStore.setState(s => ({ tree:[...s.tree,{kind:"note",note}],activeId:note.id,activeNote:note })); return note.id;
  },
  saveNote: async patch => {
    const active = useNotesStore.getState().activeNote;
    if (!active) return;
    const next = {...active,...patch,content:patch.sourceText ?? patch.content ?? active.content};
    bodies.set(next.id,next); useNotesStore.setState({activeNote:next});
  },
});
registerFlusher(() => Promise.resolve());
createRoot(document.getElementById("root")!).render(<LanguageProvider><App bootstrap={false} /></LanguageProvider>);
