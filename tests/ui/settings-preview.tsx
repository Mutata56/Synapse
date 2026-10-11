import { createRoot } from "react-dom/client";
import { Profiler } from "react";
import App from "../../src/App";
import { applyAppearance, coerceSettings} from "../../src/lib/settings";
import { LanguageProvider } from "../../src/components/LanguageProvider";
import { useNotesStore, registerFlusher } from "../../src/store/notes";
import { useWorkspaceStore } from "../../src/store/workspace";
import type { Note, TreeNode } from "../../src/lib/storage";
import "@mantine/core/styles.css";
import "@blocknote/mantine/style.css";
import "../../src/index.css";

// Isolated in-memory notes: browser checks never touch the user's vault.
const bodies = new Map<string, Note>();
const makeNote = (id: string, title: string, folder = "", favorite = false): Note => {
  const content = `# ${title}\n\nЭто синтетическая заметка для проверки вкладок и сохранения.\n\n## Проверка\n\nТекст можно редактировать в этом локальном примере.\n\n### Хранилище и операции\n\nПривычная тема для чтения заметок. **Выделение** и *связи*.\n\n#### Ссылки и код\n\n[Ссылка на документацию](https://example.test/docs) и \`select * from notes\`.\n\n##### Таблица\n\n| Поле | Значение |\n| --- | --- |\n| Тема | AnuPpuccin |\n\n###### Пример\n\n> Это блок цитаты на синтетическом стенде.\n\n- [x] Проверить палитру\n- [ ] Продолжить работу`;
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
const benchCount = Math.min(10000, Math.max(0, Number(new URLSearchParams(location.search).get("nodes")) || 0));
for (let index = 0; index < benchCount; index++) tree.push({ kind: "note", note: makeNote(`bench-${index}`, `Тест ${String(index).padStart(5, "0")}`) });
Object.assign(window, { settingsPreviewDocuments: [...bodies.values()].map(note => ({ note, body: note.content, bodyLower: note.content.toLowerCase(), titleLower: note.title.toLowerCase() })) });
let count = 1;
useNotesStore.setState({ tree, folderColors: new URLSearchParams(location.search).has("rainbow") ? {} : {"ВУЗ":"#ee6363","Работа":"#ee6363","Ascend":"#d9a253","Z_Мусорка":"#a9b963"},
  selectNote: async id => { useNotesStore.setState({activeId:id,activeNote:bodies.get(id) ?? null}); },
  closeActiveNote: async () => { useNotesStore.setState({activeId:null,activeNote:null}); },
  createNote: async (folder = "", title = "") => {
    const note = makeNote(`test-${count++}`, title || "Без названия", folder);
    // New Synapse documents use the block editor, unlike imported Markdown files.
    Object.assign(note, { content: "", markdownSource: false, sourceText: undefined, sourceRevision: undefined });
    useNotesStore.setState(s => ({ tree:[...s.tree,{kind:"note",note}],activeId:note.id,activeNote:note })); return note.id;
  },
  saveNote: async patch => {
    const active = useNotesStore.getState().activeNote;
    if (!active) return;
    const next = {...active,...patch,content:patch.sourceText ?? patch.content ?? active.content,sourceRevision:patch.sourceText ?? active.sourceRevision};
    bodies.set(next.id,next); useNotesStore.setState({activeNote:next});
  },
});
useNotesStore.setState({
  settings: coerceSettings(JSON.parse(localStorage.getItem('synapse-settings-preview') ?? 'null')),
  updateSettings: async patch => {
    const settings = coerceSettings({...useNotesStore.getState().settings, ...patch});
    useNotesStore.setState({settings,settingsSaveState:"saved"});
    localStorage.setItem('synapse-settings-preview', JSON.stringify(settings));
    applyAppearance(settings);
  },
});
applyAppearance(useNotesStore.getState().settings);
registerFlusher(() => Promise.resolve());
await useWorkspaceStore.getState().openView("settings");
const timings: Array<{ phase: string; duration: number }> = [];
const report = document.createElement("output");
report.id = "workspace-bench-metrics";
report.hidden = true;
report.style.cssText = "position:fixed;bottom:0;right:0;z-index:9999;font:10px monospace;max-width:430px;color:#ddd;background:#222;padding:4px;pointer-events:none";
document.body.append(report);
createRoot(document.getElementById("root")!).render(<Profiler id="workspace" onRender={(_id, phase, duration) => {
  timings.push({ phase, duration });
  requestAnimationFrame(() => { report.textContent = JSON.stringify({ nodes: benchCount, mountedRows: document.querySelectorAll(".workspace-tree-row").length, mountMs: timings.find(t => t.phase === "mount")?.duration, commits: timings.length, lastMs: duration }); });
}}><LanguageProvider><App bootstrap={false} /></LanguageProvider></Profiler>);
