import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CalendarDays, ChartNoAxesCombined, ChevronDown, FilePlus2, FileText, FolderOpen, Hash, HelpCircle, Home, Image, Inbox, LayoutGrid, List, Network, PanelLeft, PanelRight, Plus, Search, Settings2, Shapes, Table2, Trash2, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { emptyModel } from "../editor2026/dataTable/model";
import { hashString } from "../lib/hashString";
import { exitAfterSaving } from "../lib/applicationExit";
import { cn } from "../lib/cn";
import { NoteIcon } from "./NoteIcon";
import { t } from "../lib/i18n";
import { flattenNotes } from "../lib/treeUtils";
import { QUICK_SWITCHER_EVENT, WORKSPACE_COMMAND_EVENT, type WorkspaceCommand } from "../lib/workspaceCommands";
import { activeWorkspaceTab, type WorkspaceTarget } from "../lib/workspaceTabs";
import { flushAllPending, useNotesStore, type View } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { connectWorkspaceNavigation, useWorkspaceStore } from "../store/workspace";
import { Sidebar } from "./Sidebar";
import { WorkspaceContext } from "./WorkspaceContext";
import "./workspace.css";

export const WORKSPACE_VIEW_LABELS: Record<View, string> = { notes: "Все заметки", files: "Файлы", graph: "Граф", inbox: "Входящие", calendar: "Календарь", overview: "Обзор", tags: "Теги", trash: "Корзина", images: "Изображения", settings: "Настройки" };
const VIEW_ICONS: Record<View, LucideIcon> = { notes: FileText, files: FolderOpen, graph: Network, inbox: Inbox, calendar: CalendarDays, overview: ChartNoAxesCombined, tags: Hash, trash: Trash2, images: Image, settings: Settings2 };
const RIBBON_VIEWS: View[] = ["files", "notes", "inbox", "graph", "calendar", "tags", "images", "overview", "trash"];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const keyModifier = isMac ? "⌘" : "Ctrl";

export function WorkspaceIconButton({ icon: Icon, label, active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean }) {
  return <button type="button" className={cn("workspace-icon-button", active && "is-active", className)} title={label} aria-label={label} {...props}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /></button>;
}

export async function createWorkspaceDocument(kind: "note" | "database" | "canvas" = "note") {
  const state = useNotesStore.getState();
  if (!state.settings.modules.newNote || kind === "canvas" && !state.settings.modules.canvas || kind === "database" && !state.settings.modules.database) return;
  const folder = state.currentFolder;
  const titles = new Set(flattenNotes(state.tree).filter(note => note.folder === folder).map(note => note.title.toLocaleLowerCase()));
  const base = kind === "database" ? t("База данных") : t("Холст");
  let title = base, number = 2;
  while (titles.has(title.toLocaleLowerCase())) title = `${base} ${number++}`;
  try {
    await flushAllPending();
    const noteId = await state.createNote(folder, kind === "note" ? "" : title);
    if (!noteId) return;
    if (kind !== "note") {
      const block = kind === "database" ? { id: crypto.randomUUID(), type: "dataTable", props: { data: JSON.stringify(emptyModel()) }, children: [] }
        : { id: crypto.randomUUID(), type: "whiteboard", props: { name: title, snapshot: "" }, children: [] };
      await useNotesStore.getState().saveNote({ content: "", blocknote: JSON.stringify([block, { id: crypto.randomUUID(), type: "paragraph", content: [], children: [] }]), bnHash: hashString("") });
      useNotesStore.setState(s => ({ editorReloadNonce: s.editorReloadNonce + 1 }));
    }
    await useWorkspaceStore.getState().openNote(noteId);
  } catch (error) { useToastStore.getState().push(error instanceof Error ? error.message : t("Не удалось создать заметку"), "error"); }
}

function useWorkspaceController() {
  useEffect(() => connectWorkspaceNavigation(), []);
  useEffect(() => {
    const execute = (command: WorkspaceCommand) => {
      const state = useWorkspaceStore.getState();
      const modules = useNotesStore.getState().settings.modules;
      if (command === "new-tab" && !modules.home || command === "new-note" && !modules.newNote || command === "new-canvas" && (!modules.canvas || !modules.newNote) || command === "new-database" && (!modules.database || !modules.newNote) || command === "quick-switcher" && !modules.search || command === "help" && !modules.help || command === "toggle-context" && !modules.context) return;
      if (command === "new-tab") void state.newTab();
      else if (command === "close-tab") void state.closeTab();
      else if (command === "toggle-sidebar") state.toggleSidebar();
      else if (command === "toggle-context") state.toggleRight();
      else if (command === "settings") void state.openView("settings");
      else if (command === "help") state.showHelp(true);
      else if (command === "quit-app") {
        void exitAfterSaving().catch(error => useToastStore.getState().push(t("Не удалось сохранить изменения. Приложение осталось открытым.") + ": " + String(error), "error"));
      }
      else if (command === "quick-switcher") window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_EVENT));
      else if (command === "new-note" || command === "new-database" || command === "new-canvas") void createWorkspaceDocument(command === "new-database" ? "database" : command === "new-canvas" ? "canvas" : "note");
    };
    const onCommand = (event: Event) => execute((event as CustomEvent<WorkspaceCommand>).detail);
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      let command: WorkspaceCommand | null = null;
      if (event.code === "KeyT" && !event.shiftKey) command = "new-tab";
      else if (event.code === "KeyW" && !event.shiftKey) command = "close-tab";
      else if (event.code === "KeyN" && !event.shiftKey) command = "new-note";
      else if (event.code === "KeyO" && !event.shiftKey) command = "quick-switcher";
      else if (event.code === "Backslash") command = event.shiftKey ? "toggle-context" : "toggle-sidebar";
      else if (event.code === "Comma") command = "settings";
      else if (event.code === "PageUp" || event.code === "PageDown") {
        event.preventDefault();
        const state = useWorkspaceStore.getState(), index = state.tabs.findIndex(tab => tab.id === state.activeTabId);
        const next = (index + (event.code === "PageDown" ? 1 : -1) + state.tabs.length) % state.tabs.length;
        void state.activateTab(state.tabs[next].id); return;
      }
      if (command) { event.preventDefault(); execute(command); }
    };
    window.addEventListener(WORKSPACE_COMMAND_EVENT, onCommand);
    window.addEventListener("keydown", onKey);
    let disposed = false, unlisten: (() => void) | undefined;
    if (isTauri()) void listen<WorkspaceCommand>("workspace-command", event => execute(event.payload)).then(fn => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; unlisten?.(); window.removeEventListener(WORKSPACE_COMMAND_EVENT, onCommand); window.removeEventListener("keydown", onKey); };
  }, []);
}

export function WorkspaceChrome({ children }: { children: ReactNode }) {
  useWorkspaceController();
  const empty = useWorkspaceStore(state => activeWorkspaceTab(state).target.kind === "empty");
  const settingsOpen = useWorkspaceStore(state => { const target = activeWorkspaceTab(state).target; return target.kind === "view" && target.view === "settings"; });
  const pending = useWorkspaceStore(state => state.pending);
  const rightVisible = useWorkspaceStore(state => state.rightVisible);
  const helpVisible = useWorkspaceStore(state => state.helpVisible);
  const modules = useNotesStore(state => state.settings.modules);
  return <div className={cn("workspace-shell", isMac && "is-mac")}>
    <WorkspaceRibbon />
    {!settingsOpen ? <Sidebar /> : null}
    <section className="workspace-center" aria-label={t("Рабочая область")}>
      <WorkspaceTabs />
      <main className={cn("workspace-stage", pending && "is-pending")}>
        {empty ? <EmptyWorkspace /> : children}
        {pending ? <div className="workspace-navigation-progress" role="status">{t("Загрузка…")}</div> : null}
      </main>
    </section>
    {!settingsOpen && rightVisible && modules.context ? <WorkspaceContext /> : null}
    {helpVisible && modules.help ? <WorkspaceHelp /> : null}
  </div>;
}

function WorkspaceRibbon() {
  const modules = useNotesStore(state => state.settings.modules);
  const current = useNotesStore(state => state.view);
  const empty = useWorkspaceStore(state => activeWorkspaceTab(state).target.kind === "empty");
  const open = useWorkspaceStore(state => state.openView);
  const views = RIBBON_VIEWS.filter(view => view !== "settings" && modules[view]);
  const hasActions = modules.home || modules.newNote;
  const hasTools = modules.search || modules.newNote && (modules.canvas || modules.database);
  return <nav className="workspace-ribbon" aria-label={t("Разделы")}>
    <div className="workspace-ribbon-top">
      {modules.home ? <WorkspaceIconButton icon={Home} label={t("Новая вкладка")} active={empty} onClick={() => void useWorkspaceStore.getState().newTab()} /> : null}
      {modules.newNote ? <WorkspaceIconButton icon={FilePlus2} label={t("Новая заметка")} onClick={() => void createWorkspaceDocument()} /> : null}
      {hasActions && (views.length > 0 || hasTools) ? <div className="workspace-ribbon-divider" /> : null}
      {views.map(view => <WorkspaceIconButton key={view} icon={VIEW_ICONS[view]} label={t(WORKSPACE_VIEW_LABELS[view])} active={!empty && current === view} onClick={() => void open(view)} />)}
      {views.length > 0 && hasTools ? <div className="workspace-ribbon-divider" /> : null}
      {modules.canvas && modules.newNote ? <WorkspaceIconButton icon={Shapes} label={t("Новый холст")} onClick={() => void createWorkspaceDocument("canvas")} /> : null}
      {modules.database && modules.newNote ? <WorkspaceIconButton icon={Table2} label={t("Создать базу данных")} onClick={() => void createWorkspaceDocument("database")} /> : null}
      {modules.search ? <WorkspaceIconButton icon={Search} label={t("Перейти к файлу")} onClick={() => window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_EVENT))} /> : null}
    </div>
    <div className="workspace-ribbon-bottom"><WorkspaceIconButton icon={Settings2} label={t("Настройки")} onClick={() => void open("settings")} />{modules.help ? <WorkspaceIconButton icon={HelpCircle} label={t("Помощь и сочетания клавиш")} onClick={() => useWorkspaceStore.getState().showHelp(true)} /> : null}</div>
  </nav>;
}

function WorkspaceTabs() {
  const settingsOpen = useWorkspaceStore(state => { const target = activeWorkspaceTab(state).target; return target.kind === "view" && target.view === "settings"; });
  const modules = useNotesStore(state => state.settings.modules);
  const tabs = useWorkspaceStore(state => state.tabs), activeId = useWorkspaceStore(state => state.activeTabId);
  const sidebarVisible = useWorkspaceStore(state => state.sidebarVisible), rightVisible = useWorkspaceStore(state => state.rightVisible);
  const tree = useNotesStore(state => state.tree);
  const labels = useMemo(() => new Map(flattenNotes(tree).map(note => [note.id, note.title || t("Без названия")])), [tree]);
  const noteIcons = useMemo(() => new Map(flattenNotes(tree).map(note => [note.id, note])), [tree]);
  const [menu, setMenu] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  const keyboardTabFocus = useRef(false);
  const label = (target: WorkspaceTarget) => target.kind === "empty" ? t("Новая вкладка") : target.kind === "view" ? t(WORKSPACE_VIEW_LABELS[target.view]) : labels.get(target.noteId) ?? target.noteId.split("/").slice(-1)[0] ?? t("Без названия");
  useEffect(() => { activeButton.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); if (keyboardTabFocus.current) { activeButton.current?.focus({ preventScroll: true }); keyboardTabFocus.current = false; } }, [activeId]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!menuRoot.current?.contains(event.target as Node)) setMenu(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [menu]);
  return <header className="workspace-tabs-header" data-tauri-drag-region>
    {!sidebarVisible && !settingsOpen && (modules.files || modules.search || modules.bookmarks) ? <WorkspaceIconButton icon={PanelLeft} label={t("Развернуть левую панель")} onClick={() => useWorkspaceStore.getState().toggleSidebar()} /> : null}
    <div className="workspace-tabs-scroll" role="tablist" aria-label={t("Открытые вкладки")}>
      {tabs.map(tab => {
        const Icon = tab.target.kind === "view" ? VIEW_ICONS[tab.target.view] : tab.target.kind === "note" ? FileText : null;
        return <div className={cn("workspace-tab", tab.id === activeId && "is-active")} key={tab.id} draggable onDragStart={event => { event.dataTransfer.setData("application/x-synapse-workspace-tab", tab.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={event => { if (event.dataTransfer.types.includes("application/x-synapse-workspace-tab")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); useWorkspaceStore.getState().reorder(event.dataTransfer.getData("application/x-synapse-workspace-tab"), tab.id); }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void useWorkspaceStore.getState().closeTab(tab.id); } }}>
          <button ref={tab.id === activeId ? activeButton : undefined} className="workspace-tab-select" type="button" role="tab" aria-selected={tab.id === activeId} aria-controls="workspace-active-content" tabIndex={tab.id === activeId ? 0 : -1} title={label(tab.target)} onClick={() => void useWorkspaceStore.getState().activateTab(tab.id)} onKeyDown={event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault(); keyboardTabFocus.current = true; const index = tabs.indexOf(tab); const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; void useWorkspaceStore.getState().activateTab(tabs[next].id);
          }}>{tab.target.kind === "note" ? <NoteIcon note={noteIcons.get(tab.target.noteId)} path={tab.target.noteId + ".md"} size={14} surface="tab" /> : Icon ? <Icon size={14} aria-hidden="true" /> : null}<span>{label(tab.target)}</span></button>
          <button className="workspace-tab-close" type="button" aria-label={t("Закрыть вкладку {title}", { title: label(tab.target) })} title={t("Закрыть вкладку")} onClick={() => void useWorkspaceStore.getState().closeTab(tab.id)}><X size={15} aria-hidden="true" /></button>
        </div>;
      })}
    </div>
    <div className="workspace-tab-actions" ref={menuRoot}>
      {modules.home ? <WorkspaceIconButton icon={Plus} label={t("Новая вкладка")} onClick={() => void useWorkspaceStore.getState().newTab()} /> : null}
      <WorkspaceIconButton icon={ChevronDown} label={t("Список вкладок")} aria-expanded={menu} onClick={() => setMenu(value => !value)} />
      {menu ? <div className="workspace-tab-menu" role="menu" aria-label={t("Список вкладок")}>
        {tabs.map(tab => <button key={tab.id} type="button" role="menuitem" className={tab.id === activeId ? "is-active" : ""} onClick={() => { setMenu(false); void useWorkspaceStore.getState().activateTab(tab.id); }}>{label(tab.target)}</button>)}
        <hr /><button type="button" role="menuitem" onClick={() => { setMenu(false); useWorkspaceStore.getState().closeOtherTabs(); }}>{t("Закрыть остальные вкладки")}</button>
      </div> : null}
      {modules.context && !settingsOpen ? <WorkspaceIconButton icon={PanelRight} label={t(rightVisible ? "Свернуть правую панель" : "Развернуть правую панель")} active={rightVisible} onClick={() => useWorkspaceStore.getState().toggleRight()} /> : null}
    </div>
  </header>;
}

function EmptyWorkspace() {
  const modules = useNotesStore(state => state.settings.modules);
  return <div className="workspace-empty" id="workspace-active-content" role="tabpanel" aria-label={t("Новая вкладка")}>
    <div className="workspace-empty-actions">
      {!modules.newNote && !modules.search ? <><p>{t("Выбери раздел в меню или включи нужные модули в настройках.")}</p><button type="button" onClick={() => void useWorkspaceStore.getState().openView("settings")}><Settings2 size={19} aria-hidden="true" /><span>{t("Настройки")}</span></button></> : null}
      {modules.newNote ? <button type="button" onClick={() => void createWorkspaceDocument()}><FilePlus2 size={19} aria-hidden="true" /><span>{t("Новая заметка")}</span><kbd>{keyModifier} N</kbd></button> : null}
      {modules.database && modules.newNote ? <button type="button" onClick={() => void createWorkspaceDocument("database")}><List size={19} aria-hidden="true" /><span>{t("Создать базу данных")}</span></button> : null}
      {modules.canvas && modules.newNote ? <button type="button" onClick={() => void createWorkspaceDocument("canvas")}><LayoutGrid size={19} aria-hidden="true" /><span>{t("Новый холст")}</span></button> : null}
      {modules.search ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_EVENT))}><Search size={19} aria-hidden="true" /><span>{t("Перейти к файлу")}</span><kbd>{keyModifier} O</kbd></button> : null}
    </div>
  </div>;
}

function WorkspaceHelp() {
  const close = () => useWorkspaceStore.getState().showHelp(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); else if (event.key === "Tab") { event.preventDefault(); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    window.addEventListener("keydown", key); return () => { window.removeEventListener("keydown", key); previousFocus?.focus({ preventScroll: true }); };
  }, []);
  const shortcuts = [["Новая заметка", `${keyModifier} N`], ["Новая вкладка", `${keyModifier} T`], ["Закрыть вкладку", `${keyModifier} W`], ["Перейти к файлу", `${keyModifier} O`], ["Поиск", `${keyModifier} K`], ["Левая панель", `${keyModifier} \\`], ["Правая панель", `${keyModifier} Shift \\`]];
  return <div className="workspace-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={root} className="workspace-help" role="dialog" aria-modal="true" aria-label={t("Помощь и сочетания клавиш")} tabIndex={-1}>
    <header><h2>{t("Сочетания клавиш")}</h2><WorkspaceIconButton icon={X} label={t("Закрыть")} onClick={close} /></header>
    {shortcuts.map(([text, key]) => <div className="workspace-shortcut" key={text}><span>{t(text)}</span><kbd>{key}</kbd></div>)}
    <p>{t("Потяни границу панели, чтобы изменить её ширину. Средняя кнопка мыши открывает файл в новой вкладке.")}</p>
  </div></div>;
}
