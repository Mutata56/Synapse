import { useWorkspaceStore } from "../store/workspace";
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, FilePlus, FileText, Folder, FolderPlus, MoreHorizontal, PanelRightOpen, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { decodeDrag, setDragData, type DragItem } from "../lib/dnd";
import { pluralRu } from "../lib/format";
import { closestFileFolder, entryTarget, fileRangeSelection, fileRows, getFileIndex, normalizeFileTargets, type FileEntry, type FileSort } from "../lib/fileBrowser";
import { themeFolderColors } from "../lib/folderTheme";
import { buildBreadcrumbs } from "../lib/treeUtils";
import { readNote, readTrashedNoteBody } from "../lib/storage";
import { confirmDialog } from "../store/confirm";
import { reportError, useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { FileBrowserDialog, type FileDialogMode } from "./FileBrowserDialog";
import { FileProperties } from "./FileProperties";
import { FileQuickLook } from "./FileQuickLook";
import { useI18n } from "./LanguageProvider";
import { useWindowedRows } from "./useWindowedRows";
import "./fileBrowser.css";
import { NoteIcon } from "./NoteIcon";
import { useIconizeStore } from "../store/iconize";
import { resolveIcon } from "../lib/iconize";
import { copyWorkspacePaths, type WorkspacePathFormat } from "../lib/workspaceClipboard";

const ROW_HEIGHT = 49;
type Props = { mode: "files" | "trash"; readBody?: (id: string) => Promise<string>; initialSelected?: string[] };

/** One browser and gesture model; only the source and available operations differ. */
export function FileBrowser({ mode, readBody, initialSelected = [] }: Props) {
  const { t, lang } = useI18n();
  const newNoteEnabled = useNotesStore(state => state.settings.modules.newNote);
  const tree = useNotesStore(state => mode === "files" ? state.tree : state.trashTree);
  const folder = useNotesStore(state => mode === "files" ? state.currentFolder : state.currentTrashFolder);
  const colors = useNotesStore(state => state.folderColors);
  const colorTheme = useNotesStore(state => state.settings.colorTheme);
  const rainbow = useMemo(() => colorTheme === "anuppuccin" ? themeFolderColors(tree) : undefined, [tree, colorTheme]);
  const undoBusy = useNotesStore(state => state._undoRedoBusy);
  const index = useMemo(() => getFileIndex(tree), [tree]);
  const [query, setQuery] = useState(""), deferredQuery = useDeferredValue(query);
  const [deep, setDeep] = useState(false), [kind, setKind] = useState<"all" | "note" | "folder">("all");
  const [sort, setSort] = useState<FileSort>("name"), [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [active, setActive] = useState(""), anchor = useRef("");
  const [details, setDetails] = useState(true), [busy, setBusy] = useState(false);
  const [previewKey, setPreviewKey] = useState("");
  const host = useRef<HTMLElement>(null);
  const route = useRef<HTMLElement>(null);
  const [dialog, setDialog] = useState<{ mode: FileDialogMode; entry?: FileEntry } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false), busyItems = useRef<FileEntry[]>([]), search = useRef<HTMLInputElement>(null), menuRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => fileRows(index, folder, deferredQuery, deep, kind, sort, descending, lang), [index, folder, deferredQuery, deep, kind, sort, descending, lang]);
  const keys = useMemo(() => rows.map(row => row.key), [rows]);
  const rowIndexes = useMemo(() => new Map(keys.map((key, position) => [key, position])), [keys]);
  const selectedItems = useMemo(() => [...selected].map(key => index.byKey.get(key)).filter((item): item is FileEntry => !!item), [selected, index]);
  const shownSelection = busy ? busyItems.current : selectedItems;
  const previewEntry = rowIndexes.has(previewKey) ? index.byKey.get(previewKey) : undefined;
  const previewPosition = rowIndexes.get(previewKey) ?? -1;
  const targets = useMemo(() => normalizeFileTargets(selectedItems.map(entryTarget)), [selectedItems]);
  const resetKey = `${mode}:${folder}:${deferredQuery}:${deep}:${kind}`;
  const windowed = useWindowedRows(rows.length, ROW_HEIGHT, resetKey, 52);
  const returnQuickLookFocus = useCallback(() => {
    const element = windowed.ref.current;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }, [windowed.ref]);
  const blocked = busy || undoBusy;
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short" }), [lang]);
  const read = useCallback(async (id: string) => {
    if (readBody) return readBody(id);
    if (mode === "trash") return readTrashedNoteBody(id);
    const note = await readNote(id); if (!note) throw new Error("Note unavailable"); return note.content;
  }, [readBody, mode]);
  useLayoutEffect(() => {
    const element = host.current; if (!element) return;
    let compact = false;
    const measure = () => { const next = element.clientWidth < 900; if (next && !compact) { setDetails(false); if (route.current) route.current.scrollLeft = route.current.scrollWidth; } compact = next; };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { if (route.current) route.current.scrollLeft = route.current.scrollWidth; }, [folder]);
  const navigate = useCallback((path: string) => {
    if (busyRef.current) return;
    const state = useNotesStore.getState();
    if (state._undoRedoBusy) return;
    if (mode === "files") state.setCurrentFolder(path); else state.setCurrentTrashFolder(path);
    setSelected(new Set()); setActive(""); anchor.current = ""; setMenu(null); setPreviewKey("");
  }, [mode]);
  const refresh = useCallback(async () => {
    if (busyRef.current || useNotesStore.getState()._undoRedoBusy) return;
    setRefreshing(true);
    try { if (mode === "trash") await useNotesStore.getState().refreshTrash(); else await useNotesStore.getState().refreshTree(); }
    catch (error) { reportError(t("Не удалось обновить список"), "FileBrowser refresh:", error); }
    finally { setRefreshing(false); }
  }, [mode, t]);
  useEffect(() => { if (mode === "trash") void refresh(); }, [mode, refresh]);
  useEffect(() => { const next = closestFileFolder(index, folder); if (next !== folder && !busy && !undoBusy) navigate(next); }, [index, folder, busy, undoBusy, navigate]);
  useEffect(() => {
    if (busy) return;
    setSelected(previous => {
      const next = new Set([...previous].filter(key => index.byKey.has(key) && rowIndexes.has(key)));
      return next.size === previous.size ? previous : next;
    });
    if (active && !rowIndexes.has(active)) setActive("");
    if (previewKey && !rowIndexes.has(previewKey)) setPreviewKey("");
  }, [index, rowIndexes, active, busy, previewKey]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); windowed.ref.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss); window.addEventListener("keydown", escape);
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", escape); };
  }, [menu, windowed.ref]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const bounds = menuRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8));
    if (x !== menu.x || y !== menu.y) setMenu({ x, y });
  }, [menu]);
  const selectAt = (position: number, toggle: boolean, range: boolean) => {
    if (blocked || !keys[position]) return;
    const anchorIndex = rowIndexes.get(anchor.current) ?? position;
    setSelected(previous => fileRangeSelection(keys, previous, position, anchorIndex, toggle, range));
    setActive(keys[position]); if (!range) anchor.current = keys[position];
    windowed.ref.current?.focus({ preventScroll: true });
  };
  const showQuickLook = () => {
    if (blocked) return;
    const entry = selected.has(active) ? index.byKey.get(active) : selectedItems[0];
    if (entry) { setMenu(null); setPreviewKey(entry.key); }
  };
  const stepQuickLook = (delta: number) => {
    const position = previewPosition + delta, entry = rows[position];
    if (!entry) return;
    setPreviewKey(entry.key); setActive(entry.key); anchor.current = entry.key;
    setSelected(new Set([entry.key])); windowed.reveal(position);
  };
  const open = (entry: FileEntry) => {
    if (blocked) return;
    if (entry.kind === "folder") navigate(entry.path);
    else if (mode === "files") { void useWorkspaceStore.getState().openNote(entry.path).catch(error => reportError(t("Не удалось открыть заметку"), "FileBrowser open:", error)); }
    else { setSelected(new Set([entry.key])); setActive(entry.key); setPreviewKey(entry.key); }
  };
  const execute = async (operation: () => Promise<unknown>) => {
    if (busyRef.current || undoBusy) return false;
    busyRef.current = true; busyItems.current = selectedItems; setBusy(true); setMenu(null); setPreviewKey("");
    try { await operation(); return true; }
    catch (error) { reportError(t("Не удалось выполнить действие"), "FileBrowser operation:", error); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const trash = async () => {
    if (!targets.length || blocked) return;
    if (!(await confirmDialog(t("Переместить {n} элементов в корзину? Папки будут перемещены со всем содержимым.", { n: targets.length }), { confirmLabel: t("В корзину") }))) return;
    await execute(() => useNotesStore.getState().batchTrash(targets.filter(item => item.kind === "note").map(item => item.id), targets.filter(item => item.kind === "folder").map(item => item.path)));
  };
  const restore = () => execute(() => useNotesStore.getState().batchRestoreTrash(targets));
  const permanentlyDelete = async () => {
    if (!targets.length || blocked) return;
    if (!(await confirmDialog(t("Удалить {n} элементов навсегда, включая содержимое папок? Это действие нельзя отменить.", { n: targets.length }), { confirmLabel: t("Удалить навсегда") }))) return;
    await execute(() => useNotesStore.getState().batchDeleteForever(targets));
  };
  const clearTrash = async () => {
    if (blocked || !index.entries.length) return;
    if (!(await confirmDialog(t("Очистить корзину полностью? Это действие нельзя отменить."), { confirmLabel: t("Очистить корзину") }))) return;
    await execute(() => useNotesStore.getState().emptyTrash());
  };
  const copyPaths = async (format: WorkspacePathFormat = "relative") => {
    if (!selectedItems.length) return;
    try {
      await copyWorkspacePaths(selectedItems, format, mode === "trash");
      useToastStore.getState().push(t("Путь скопирован")); setMenu(null);
    } catch (error) { reportError(t("Не удалось скопировать путь"), "FileBrowser clipboard:", error); }
  };
  const drop = async (items: DragItem[], destination: string) => {
    if (mode !== "files" || busyRef.current || !items.length) return;
    await execute(() => useNotesStore.getState().batchMove(items, destination));
  };
  const submit = async (value: string) => {
    const action = dialog; if (!action) return;
    if (action.mode === "navigate") { navigate(value); setDialog(null); return; }
    const succeeded = await execute(async () => {
      const state = useNotesStore.getState();
      if (action.mode === "createFolder") await state.createFolder(folder, value);
      else if (action.mode === "createNote") await state.createNote(folder, value);
      else if (action.mode === "rename" && action.entry) { if (action.entry.kind === "folder") await state.renameFolder(action.entry.path, value); else await state.renameNote(action.entry.path, value); }
      else if (action.mode === "move") {
        const result = await state.batchMove(targets, value);
        if (result.failed.length) useToastStore.getState().push(t("Некоторые элементы не удалось переместить"));
      }
    });
    if (succeeded) setDialog(null);
  };
  const activePosition = rowIndexes.get(active) ?? -1;
  const activeDescendant = activePosition >= windowed.start && activePosition < windowed.end ? `fs-${mode}-row-${activePosition}` : undefined;
  const toggleSort = (next: FileSort) => { if (blocked) return; if (next === sort) setDescending(value => !value); else { setSort(next); setDescending(next === "modified"); } };
  const showMenu = (event: MouseEvent, entry: FileEntry) => {
    event.preventDefault(); event.stopPropagation(); if (blocked) return;
    if (!selected.has(entry.key)) setSelected(new Set([entry.key]));
    setActive(entry.key); setMenu({ x: event.clientX, y: event.clientY });
  };
  return <section ref={host} className="fs-browser" aria-label={mode === "files" ? t("Файлы") : t("Корзина")} data-mode={mode}>
    <header className="fs-header"><h1>{mode === "files" ? t("Файлы") : t("Корзина")}</h1>
      <div className="fs-search"><Search size={17} /><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Поиск в папке…")} aria-label={t("Поиск в папке")} disabled={blocked} />{query && <button type="button" className="fs-icon-button" onClick={() => setQuery("")} aria-label={t("Очистить поиск")}><X size={14} /></button>}<button type="button" className={`fs-search-scope${deep ? " is-active" : ""}`} aria-pressed={deep} aria-label={t("Искать во вложенных папках")} title={t("Искать во вложенных папках")} onClick={() => setDeep(value => !value)} disabled={blocked}><Folder size={14} /></button></div>
      {mode === "files" ? <><button type="button" className="fs-button fs-new-folder" title={t("Новая папка")} disabled={blocked} onClick={() => setDialog({ mode: "createFolder" })}><FolderPlus size={16} />{t("Новая папка")}</button>{newNoteEnabled ? <button type="button" className="fs-button fs-primary fs-new-note" title={t("Новая заметка")} disabled={blocked} onClick={() => setDialog({ mode: "createNote" })}><FilePlus size={16} />{t("Новая заметка")}</button> : null}</> : <button type="button" className="fs-button fs-danger" disabled={blocked || !index.entries.length} onClick={() => void clearTrash()}><Trash2 size={16} />{t("Очистить корзину")}</button>}
    </header>
    <div className={`fs-layout${details ? " has-properties" : ""}`}>
      <div className="fs-work">
        <nav ref={route} className="fs-route fs-scroll" aria-label={t("Хлебные крошки")}>
          {[{ name: mode === "files" ? t("Хранилище") : t("Корзина"), path: "" }, ...buildBreadcrumbs(folder)].map((crumb, position, trail) => <span key={crumb.path}>
            {position > 0 && <ChevronRight size={14} aria-hidden="true" />}<button type="button" className={position === trail.length - 1 ? "is-current" : ""} aria-current={position === trail.length - 1 ? "page" : undefined} aria-label={crumb.name} title={crumb.path || crumb.name} disabled={blocked} onClick={() => navigate(crumb.path)} onDragOver={mode === "files" ? event => { if (event.dataTransfer.types.includes("text/plain")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; event.currentTarget.classList.add("is-drop-target"); } } : undefined} onDragLeave={event => event.currentTarget.classList.remove("is-drop-target")} onDrop={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove("is-drop-target"); void drop(decodeDrag(event.dataTransfer), crumb.path); }}><Folder size={19} aria-hidden="true" />{(position > 0 || !folder) && <span>{crumb.name}</span>}</button>
          </span>)}<button type="button" className="fs-icon-button fs-route-picker" onClick={() => setDialog({ mode: "navigate" })} disabled={blocked} aria-label={t("Перейти в папку")}><MoreHorizontal size={17} /></button>
        </nav>
        <div className="fs-selection-bar" aria-live="polite">
          {shownSelection.length ? <><span className="fs-selection-count"><span className="fs-checked"><Check size={15} /></span>{busy ? t("Обработка…") : t("Выбрано: {n}", { n: shownSelection.length })}</span>{mode === "files" ? <><button type="button" className="fs-button fs-tonal" disabled={blocked} onClick={() => setDialog({ mode: "move" })}><Folder size={16} />{t("Переместить")}</button><button type="button" className="fs-button" disabled={blocked} onClick={() => void trash()}><Trash2 size={16} className="fs-danger-icon" />{t("В корзину")}</button></> : <><button type="button" className="fs-button fs-tonal" disabled={blocked} onClick={() => void restore()}><RotateCcw size={16} />{t("Восстановить")}</button><button type="button" className="fs-button fs-danger" disabled={blocked} onClick={() => void permanentlyDelete()}><Trash2 size={16} />{t("Удалить навсегда")}</button></>}<button type="button" className="fs-text-button fs-clear-selection" title={t("Снять выделение")} disabled={blocked} onClick={() => setSelected(new Set())}><X size={14} />{t("Снять выделение")}</button></> : <><span className="fs-selection-summary">{rows.length} {lang === "ru" ? pluralRu(rows.length, t("элемент"), t("элемента"), t("элементов")) : t(rows.length === 1 ? "элемент" : "элементов")}{deep && <span> · {t("Включая вложенные папки")}</span>}</span><button type="button" className="fs-text-button" disabled={blocked || refreshing} onClick={() => void refresh()}><RotateCcw size={14} />{refreshing ? t("Обновление…") : t("Обновить")}</button></>}
        </div>

        <div className="fs-table-viewport fs-scroll" role="grid" aria-label={mode === "files" ? t("Содержимое папки") : t("Содержимое корзины")} aria-multiselectable="true" aria-rowcount={rows.length + 1} aria-activedescendant={activeDescendant} tabIndex={0} ref={windowed.ref} onScroll={windowed.onScroll} onKeyDown={event => {
          if (event.target !== event.currentTarget || blocked) return;
          const command = event.metaKey || event.ctrlKey;
          if (command && event.key.toLocaleLowerCase() === "a") { event.preventDefault(); setSelected(new Set(keys)); }
          else if (command && event.key.toLocaleLowerCase() === "f") { event.preventDefault(); search.current?.focus(); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, activePosition + (event.key === "ArrowDown" ? 1 : -1)));
            selectAt(next, command, event.shiftKey); windowed.reveal(next);
          } else if (event.key === "Enter" && activePosition >= 0) { event.preventDefault(); open(rows[activePosition]); }
          else if (event.key === "Escape") { setSelected(new Set()); setMenu(null); }
          else if (event.key === "Backspace" && folder) { event.preventDefault(); navigate(folder.slice(0, Math.max(0, folder.lastIndexOf("/")))); }
          else if (event.key === "Delete") { event.preventDefault(); if (mode === "files") void trash(); else void permanentlyDelete(); }
          else if (event.key === "F2" && selectedItems.length === 1 && mode === "files") { event.preventDefault(); setDialog({ mode: "rename", entry: selectedItems[0] }); }
          else if (event.key === "F5") { event.preventDefault(); void refresh(); }
          else if (event.key === "F10" && event.shiftKey && activePosition >= 0) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left + 64, y: box.top + 32 }); }
          else if (event.key === " " && !command && !event.altKey) { event.preventDefault(); if (!event.repeat) { if (previewKey) setPreviewKey(""); else showQuickLook(); } }
        }}>
        <div className="fs-table-header" role="row">
          <div role="columnheader" aria-label={t("Выделение")}><button type="button" className="fs-select-all" aria-label={selected.size === rows.length && rows.length ? t("Снять выделение всех") : t("Выбрать все")} aria-pressed={selected.size === rows.length && rows.length > 0} disabled={blocked || !rows.length} onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(keys))}><span className={selected.size === rows.length && rows.length ? "fs-checked" : "fs-checkbox"}>{selected.size === rows.length && rows.length > 0 && <Check size={13} />}</span></button></div>
          <div role="columnheader" aria-sort={sort === "name" ? descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => toggleSort("name")} disabled={blocked}>{t("Название")}{sort === "name" && (descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button></div>
          <div role="columnheader" className="fs-type-head"><select aria-label={t("Тип элементов")} value={kind} disabled={blocked} onChange={event => setKind(event.target.value as typeof kind)}><option value="all">{t("Тип")}</option><option value="note">{t("Заметки")}</option><option value="folder">{t("Папки")}</option></select></div>
          <div role="columnheader" className="fs-date-head" aria-sort={sort === "modified" ? descending ? "descending" : "ascending" : "none"}><button type="button" onClick={() => toggleSort("modified")} disabled={blocked}>{t("Изменено")}{sort === "modified" && (descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button></div>
          <div role="columnheader" aria-label={t("Действия")}><button type="button" className="fs-icon-button" aria-label={details ? t("Свернуть свойства") : t("Развернуть свойства")} aria-expanded={details} onClick={() => setDetails(value => !value)}><PanelRightOpen size={16} /></button></div>
        </div>
          {rows.length ? <div className="fs-row-space" role="presentation" style={{ height: rows.length * ROW_HEIGHT }}>{rows.slice(windowed.start, windowed.end).map((entry, offset) => {
            const position = windowed.start + offset, checked = selected.has(entry.key);
            return <div key={entry.key} id={`fs-${mode}-row-${position}`} role="row" aria-selected={checked} aria-rowindex={position + 2} className={`fs-row${checked ? " is-selected" : ""}${active === entry.key ? " is-active" : ""}`} style={{ position: "absolute", top: position * ROW_HEIGHT, height: ROW_HEIGHT, width: "100%" }} draggable={mode === "files" && !blocked} onClick={event => { if (event.metaKey && entry.kind === "note" && mode === "files") { event.preventDefault(); if (!blocked) void useWorkspaceStore.getState().openNote(entry.path, true); return; } selectAt(position, event.metaKey || event.ctrlKey, event.shiftKey); }} onDoubleClick={event => { if (!event.shiftKey && !event.ctrlKey && !event.metaKey) open(entry); }} onContextMenu={event => showMenu(event, entry)} onDragStart={event => {
              const items = checked ? selectedItems.map(entryTarget) : [entryTarget(entry)]; setDragData(event.dataTransfer, items, { label: entry.name, meta: entry.parent || t("Хранилище") });
            }} onDragOver={mode === "files" && entry.kind === "folder" ? event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; event.currentTarget.classList.add("is-drop-target"); } : undefined} onDragLeave={event => event.currentTarget.classList.remove("is-drop-target")} onDrop={event => { if (entry.kind !== "folder") return; event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove("is-drop-target"); void drop(decodeDrag(event.dataTransfer), entry.path); }}>
              <div role="gridcell" className="fs-check-cell"><button type="button" tabIndex={-1} role="checkbox" aria-checked={checked} aria-label={t("Выбрать {name}", { name: entry.name })} className={checked ? "fs-checked" : "fs-checkbox"} disabled={blocked} onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); selectAt(position, true, event.shiftKey); }}>{checked && <Check size={13} />}</button></div>
              <div role="gridcell" className="fs-name-cell"><NoteIcon note={entry.note} kind={entry.kind === "folder" ? "folder" : "file"} path={(mode === "trash" ? ".trash/" : "") + entry.path + (entry.kind === "note" ? ".md" : "")} size={20} fallback={entry.kind === "folder" ? <Folder size={20} style={{ color: colors[entry.path] || rainbow?.get(entry.path) }} className="fs-folder-icon" /> : <FileText size={20} />} /><span className="fs-entry-name" title={entry.name}>{entry.name}{deep && entry.parent !== folder && <small>{entry.parent || t("Хранилище")}</small>}</span><div className="fs-row-tags">{entry.note?.tags.slice(0, 3).map(tag => <span key={tag} className="fs-tag">#{tag.replace(/^#/, "")}</span>)}</div></div>
              <div role="gridcell" className="fs-type-cell">{entry.kind === "folder" ? t("Папка") : t("Заметка")}</div><div role="gridcell" className="fs-date-cell">{entry.modified > 0 ? dateFormat.format(entry.modified) : "—"}</div><div role="gridcell" className="fs-menu-cell"><button type="button" tabIndex={-1} className="fs-icon-button" aria-label={t("Действия: {name}", { name: entry.name })} disabled={blocked} onClick={event => showMenu(event, entry)}><MoreHorizontal size={17} /></button></div>
            </div>;
          })}</div> : <div className="fs-empty"><Folder size={36} /><h2>{query || kind !== "all" ? t("Ничего не найдено") : mode === "trash" ? t("Корзина пуста") : t("В папке пока нет элементов")}</h2><p>{query || kind !== "all" ? t("Измени поиск или сбрось фильтр типа") : mode === "trash" ? t("Удалённые заметки и папки появятся здесь") : t("Создай заметку или папку")}</p>{(query || kind !== "all") && <button type="button" className="fs-button" onClick={() => { setQuery(""); setKind("all"); }}>{t("Сбросить фильтры")}</button>}</div>}
        </div>
      </div>
      {details && <FileProperties mode={mode} items={shownSelection} index={index} folder={folder} busy={blocked} onClose={() => setDetails(false)} onOpen={open} onMove={() => setDialog({ mode: "move" })} onTrash={() => void trash()} onRestore={() => void restore()} onDelete={() => void permanentlyDelete()} onCopy={() => void copyPaths()} />}
    </div>
    {previewEntry && <FileQuickLook mode={mode} entry={previewEntry} index={index} read={read} position={previewPosition} total={rows.length} onStep={stepQuickLook} onClose={() => setPreviewKey("")} onReturnFocus={returnQuickLookFocus} onOpen={open} />}
    {dialog && <FileBrowserDialog mode={dialog.mode} source={mode} index={index} folder={folder} entry={dialog.entry} targets={targets} busy={blocked} onClose={() => { if (!busyRef.current) setDialog(null); }} onSubmit={submit} />}
    {menu && createPortal(<div role="menu" aria-label={t("Действия с элементами")} className="fs-menu" ref={menuRef} style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button")); const current = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(current + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus(); } }}>
      <button type="button" role="menuitem" onClick={showQuickLook}><FileText size={15} />{t("Быстрый просмотр")}<kbd>Space</kbd></button>
      {selectedItems.length === 1 && mode === "files" && <><button type="button" role="menuitem" onClick={() => { setMenu(null); open(selectedItems[0]); }}><FileText size={15} />{t("Открыть")}</button><button type="button" role="menuitem" onClick={() => { setMenu(null); setDialog({ mode: "rename", entry: selectedItems[0] }); }}>{t("Переименовать")}<kbd>F2</kbd></button></>}
      {mode === "files" && <button type="button" role="menuitem" onClick={() => { setMenu(null); const first = selectedItems[0]; useIconizeStore.getState().openPicker({ targets: selectedItems.map(item => ({ kind: item.kind === "folder" ? "folder" : "file", path: item.path + (item.kind === "note" ? ".md" : "") })), current: first ? resolveIcon(useIconizeStore.getState().data, first.kind === "folder" ? "folder" : "file", first.path + (first.kind === "note" ? ".md" : ""), first.note) ?? undefined : undefined }); }}>{t("Изменить иконку")}</button>}
      {mode === "files" ? <><button type="button" role="menuitem" onClick={() => { setMenu(null); setDialog({ mode: "move" }); }}><Folder size={15} />{t("Переместить…")}</button><button type="button" role="menuitem" className="fs-danger" onClick={() => { setMenu(null); void trash(); }}><Trash2 size={15} />{t("В корзину")}</button></> : <><button type="button" role="menuitem" onClick={() => { setMenu(null); void restore(); }}><RotateCcw size={15} />{t("Восстановить")}</button><button type="button" role="menuitem" className="fs-danger" onClick={() => { setMenu(null); void permanentlyDelete(); }}><Trash2 size={15} />{t("Удалить навсегда")}</button></>}
      <button type="button" role="menuitem" onClick={() => void copyPaths("absolute")}><Copy size={15} />{t("Скопировать абсолютный путь")}</button>
      <button type="button" role="menuitem" onClick={() => void copyPaths("relative")}><Copy size={15} />{t("Скопировать относительный путь")}</button>
    </div>, document.body)}
  </section>;
}
