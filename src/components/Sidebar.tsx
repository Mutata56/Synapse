import { Bookmark, Check, ChevronsDownUp, ChevronsUpDown, FilePlus2, FileText, Folder, FolderPlus, HelpCircle, PanelLeft, PanelTop, Search, Settings2, SortAsc, type LucideIcon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { buildSearchDocs, searchFullText, type SearchDoc } from "../lib/fullTextSearch";
import { t } from "../lib/i18n";
import type { NoteMeta, TreeNode } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { sortWorkspaceTree } from "../lib/workspaceTree";
import { WORKSPACE_REVEAL_NOTE_EVENT } from "../lib/workspaceCommands";
import { useNotesStore } from "../store/notes";
import { promptDialog } from "../store/confirm";
import { clampSidebarWidth, defaultSidebarWidth, useWorkspaceStore } from "../store/workspace";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FolderTree } from "./FolderTree";
import { WorkspaceIconButton } from "./WorkspaceChrome";

export function Sidebar() {
  const visible = useWorkspaceStore(state => state.sidebarVisible);
  const width = useWorkspaceStore(state => state.sidebarWidth);
  const requestedPane = useWorkspaceStore(state => state.sidebarPane);
  const modules = useNotesStore(state => state.settings.modules);
  const pane = modules[requestedPane] ? requestedPane : (["files", "search", "bookmarks"] as const).find(key => modules[key]) ?? "files";
  const label = useWorkspaceStore(state => state.vaultLabel);
  const sort = useWorkspaceStore(state => state.fileSort);
  const tree = useNotesStore(state => state.tree);
  const ordered = useMemo(() => sortWorkspaceTree(tree, sort), [tree, sort]);
  const root = useRef<HTMLElement>(null), dragging = useRef(false), dragWidth = useRef(width);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const showPane = useWorkspaceStore(state => state.showSidebar);
  useEffect(() => () => {
    if (dragging.current) { dragging.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; }
  }, [visible]);
  const paneTabs: Array<{ id: "files" | "search" | "bookmarks"; icon: LucideIcon; title: string }> = [{ id: "files", icon: Folder, title: "Файлы" }, { id: "search", icon: Search, title: "Поиск" }, { id: "bookmarks", icon: Bookmark, title: "Закладки" }];
  if (!visible || !modules.files && !modules.search && !modules.bookmarks) return null;
  const collapseAll = () => {
    const notes = useNotesStore.getState();
    const expandedFolders = new Set<string>();
    if (!notes.expandedFolders.size) {
      const visit = (nodes: TreeNode[]) => { for (const node of nodes) if (node.kind === "folder") { expandedFolders.add(node.path); visit(node.children); } };
      visit(notes.tree);
    }
    useNotesStore.setState({ expandedFolders });
  };
  const sortMenu = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 6, items: [["name", "По имени"], ["modified", "По дате обновления"], ["created", "По дате создания"]].map(([order, title]) => ({ kind: "item" as const, label: t(title), icon: sort === order ? Check : undefined, onClick: () => useWorkspaceStore.getState().setFileSort(order as typeof sort) })) });
  };
  return <aside className="workspace-sidebar" ref={root} style={{ width }} aria-label={t("Левая панель")}>
    <header className="workspace-sidebar-header" data-tauri-drag-region>
      <div className="workspace-sidebar-tabs" role="tablist" aria-label={t("Панели хранилища")}>
        {paneTabs.filter(tab => modules[tab.id]).map(tab => <WorkspaceIconButton key={tab.id} icon={tab.icon} label={t(tab.title)} active={pane === tab.id} role="tab" aria-selected={pane === tab.id} aria-controls={`workspace-side-${tab.id}`} onClick={() => showPane(tab.id)} />)}
      </div>
      <WorkspaceIconButton icon={PanelLeft} label={t("Свернуть левую панель")} onClick={() => useWorkspaceStore.getState().toggleSidebar()} />
    </header>
    <div className="workspace-sidebar-body" id={`workspace-side-${pane}`} role="tabpanel" aria-label={t(paneTabs.find(tab => tab.id === pane)!.title)}>
      {pane === "files" ? <>
        <div className="workspace-file-actions" aria-label={t("Действия с файлами")}>
          {modules.newNote ? <WorkspaceIconButton icon={FilePlus2} label={t("Новая заметка")} onClick={() => useNotesStore.getState().startCreateNote(useNotesStore.getState().currentFolder)} /> : null}
          <WorkspaceIconButton icon={FolderPlus} label={t("Новая папка")} onClick={() => useNotesStore.getState().startCreateFolder(useNotesStore.getState().currentFolder)} />
          <WorkspaceIconButton icon={SortAsc} label={t("Порядок файлов")} onClick={event => sortMenu(event.currentTarget)} />
          <WorkspaceIconButton icon={PanelTop} label={t("Показать активный файл")} onClick={() => {
            const note = useNotesStore.getState().activeNote; if (!note) return;
            if (note.folder) useNotesStore.getState().expandFolder(note.folder);
            requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(WORKSPACE_REVEAL_NOTE_EVENT, { detail: note.id })));
          }} />
          <WorkspaceIconButton icon={ChevronsDownUp} label={t("Свернуть или развернуть все папки")} onClick={collapseAll} />
        </div>
        <FolderTree compact orderedTree={ordered} />
      </> : pane === "search" ? <WorkspaceSearch /> : <WorkspaceBookmarks />}
    </div>
    <footer className="workspace-vault-footer">
      <button className="workspace-vault-name" type="button" title={t("Переименовать хранилище")} onClick={() => {
        void promptDialog(t("Название хранилища"), { defaultValue: label }).then(value => { if (value !== null) useWorkspaceStore.getState().setVaultLabel(value); });
      }}><ChevronsUpDown size={15} aria-hidden="true" /><span>{label}</span></button>
      {modules.help ? <WorkspaceIconButton icon={HelpCircle} label={t("Помощь и сочетания клавиш")} onClick={() => useWorkspaceStore.getState().showHelp(true)} /> : null}
      <WorkspaceIconButton icon={Settings2} label={t("Настройки")} onClick={() => void useWorkspaceStore.getState().openView("settings")} />
    </footer>
    <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t("Изменить ширину панели")} aria-valuenow={Math.round(width)} aria-valuemin={220} aria-valuemax={Math.max(240, window.innerWidth - 368)} className="workspace-sidebar-resize" title={t("Потяните, чтобы изменить ширину (двойной клик , сброс)")}
      onPointerDown={event => { event.preventDefault(); dragging.current = true; dragWidth.current = width; event.currentTarget.setPointerCapture(event.pointerId); document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; }}
      onPointerMove={event => { if (dragging.current) { const left = root.current?.getBoundingClientRect().left ?? 48; dragWidth.current = clampSidebarWidth(event.clientX - left); if (root.current) root.current.style.width = `${dragWidth.current}px`; } }}
      onPointerUp={event => { if (!dragging.current) return; dragging.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); useWorkspaceStore.getState().setSidebarWidth(dragWidth.current); }}
      onPointerCancel={() => { dragging.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; if (root.current) root.current.style.width = `${width}px`; }}
      onDoubleClick={() => useWorkspaceStore.getState().setSidebarWidth(defaultSidebarWidth())}
      onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); useWorkspaceStore.getState().setSidebarWidth(event.key === "Home" ? defaultSidebarWidth() : width + (event.key === "ArrowRight" ? 16 : -16)); } }} />
    <ContextMenu open={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0} items={menu?.items ?? []} onClose={() => setMenu(null)} />
  </aside>;
}

function WorkspaceNoteResult({ note, snippet }: { note: NoteMeta; snippet?: string | null }) {
  const active = useNotesStore(state => state.view === "notes" && state.activeId === note.id);
  return <button type="button" className={`workspace-note-result${active ? " is-active" : ""}`} onClick={() => void useWorkspaceStore.getState().openNote(note.id)} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void useWorkspaceStore.getState().openNote(note.id, true); } }} title={note.folder ? `${note.folder}/${note.title}` : note.title}>
    <FileText size={15} aria-hidden="true" /><span><strong>{note.title || t("Без названия")}</strong>{snippet ? <small>{snippet}</small> : note.folder ? <small>{note.folder}</small> : null}</span>
  </button>;
}

function WorkspaceSearch() {
  const tree = useNotesStore(state => state.tree);
  const notes = useMemo(() => flattenNotes(tree), [tree]);
  const [query, setQuery] = useState(""), [documents, setDocuments] = useState<SearchDoc[]>([]), [loading, setLoading] = useState(true);
  const deferred = useDeferredValue(query);
  useEffect(() => {
    let stale = false; setLoading(true);
    void buildSearchDocs(notes).then(docs => { if (!stale) { setDocuments(docs); setLoading(false); } }).catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [notes]);
  const results = useMemo(() => searchFullText(documents, deferred, 150), [documents, deferred]);
  return <div className="workspace-side-search"><div className="workspace-search-field"><Search size={15} aria-hidden="true" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Поиск по заметкам…")} aria-label={t("Поиск по заметкам")} /></div>
    {query.trim() ? <><p className="workspace-side-count">{loading ? t("Загрузка…") : t("Найдено: {n}", { n: results.length })}</p><div className="workspace-side-results">{results.map(hit => <WorkspaceNoteResult key={hit.note.id} note={hit.note} snippet={hit.snippet ? `${hit.snippet.before}${hit.snippet.text}${hit.snippet.after}` : null} />)}{!loading && !results.length ? <p className="workspace-side-empty">{t("Ничего не найдено")}</p> : null}</div></> : <p className="workspace-side-empty">{t("Введи текст, чтобы найти заметку или её содержимое.")}</p>}
  </div>;
}

function WorkspaceBookmarks() {
  const tree = useNotesStore(state => state.tree);
  const notes = useMemo(() => flattenNotes(tree).filter(note => note.favorite).sort((a, b) => b.updatedAt - a.updatedAt), [tree]);
  return <section className="workspace-bookmarks"><h2>{t("Закладки")}</h2>{notes.length ? notes.map(note => <WorkspaceNoteResult key={note.id} note={note} />) : <div className="workspace-side-empty"><Bookmark size={20} aria-hidden="true" /><p>{t("Добавляй заметки в избранное — они появятся здесь.")}</p></div>}</section>;
}
