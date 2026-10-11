import { ChevronRight, FolderOpen, Grid2X2, Plus, Search, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSelection } from "../hooks/useSelection";
import { pluralRu } from "../lib/format";
import { buildLibraryIndex, layoutLibrary, libraryColumns, normalizeLibraryTag, queryLibrary, type LibraryGrouping, type LibrarySort } from "../lib/noteLibrary";
import { indexVaultFiles } from "../lib/obsidianImport";
import { readNote, type Note } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { confirmDialog } from "../store/confirm";
import { useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { BulkActionBar } from "./BulkActionBar";
import { useWorkspaceStore } from "../store/workspace";
import { useI18n } from "./LanguageProvider";
import { LibraryNoteCard } from "./LibraryNoteCard";
import { useLibraryWindow } from "./useLibraryWindow";
import "./NotesGallery.css";
import "./TagsView.css";
const ReadingPane = lazy(() => import("./TagReadingPane"));
const PREFERENCE_KEY = "synapse-note-library-v1";
const EMPTY_TAGS: string[] = [];
const SESSION_KEY = "synapse-note-library-session-v1";
function session(): { query: string; folder: string; tag: string; favorite: boolean; top: number } {
    try {
        const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}");
        return { query: typeof value.query === "string" ? value.query.slice(0, 500) : "", folder: typeof value.folder === "string" ? value.folder : "", tag: typeof value.tag === "string" ? value.tag : "", favorite: value.favorite === true, top: Number.isFinite(value.top) ? Math.max(0, value.top) : 0 };
    } catch { return { query: "", folder: "", tag: "", favorite: false, top: 0 }; }
}
function preferences(): {
    sort: LibrarySort;
    grouping: LibraryGrouping;
    compact: boolean;
} {
    try {
        const value = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "{}");
        return { sort: ["updated", "created", "title"].includes(value.sort) ? value.sort : "updated", grouping: ["section", "folder", "none"].includes(value.grouping) ? value.grouping : "section", compact: value.compact === true };
    }
    catch {
        return { sort: "updated", grouping: "section", compact: false };
    }
}
export function NotesGallery({ loadNote = readNote }: {
    loadNote?: (id: string) => Promise<Note | null>;
}) {
    const { t } = useI18n();
    const newNoteEnabled = useNotesStore(state => state.settings.modules.newNote);
    const tree = useNotesStore(state => state.tree), createNote = useNotesStore(state => state.createNote);
    const index = useMemo(() => buildLibraryIndex(flattenNotes(tree)), [tree]);
    const files = useMemo(() => indexVaultFiles([...index.byId.keys()].map(id => `${id}.md`)), [index]);
    const [remembered] = useState(session);
    const [query, setQuery] = useState(remembered.query), [folder, setFolder] = useState(remembered.folder), [tag, setTag] = useState(remembered.tag), [favorite, setFavorite] = useState(remembered.favorite);
    const [prefs, setPrefs] = useState(preferences), [previewId, setPreviewId] = useState<string | null>(null);
    const deferred = useDeferredValue(query), searchRef = useRef<HTMLInputElement>(null), tagRef = useRef<HTMLSelectElement>(null);
    const previewTrigger = useRef<HTMLButtonElement | null>(null), closeRef = useRef<HTMLButtonElement>(null), keyboardTarget = useRef<string | null>(null);
    const sel = useSelection<string>();
    const filtered = useMemo(() => queryLibrary(index, { query: deferred, folder, tag, favorite, sort: prefs.sort }), [index, deferred, folder, tag, favorite, prefs.sort]);
    const [columns, setColumns] = useState(3), cardHeight = prefs.compact ? 230 : 282;
    const layout = useMemo(() => layoutLibrary(filtered, columns, cardHeight, prefs.grouping, folder), [filtered, columns, cardHeight, prefs.grouping, folder]);
    const resetKey = JSON.stringify([deferred, folder, tag, favorite, prefs.sort, prefs.grouping]);
    const windowed = useLibraryWindow(layout, resetKey, remembered.top, columns, prefs.compact);
    const snapshot = useRef({ query, folder, tag, favorite, top: remembered.top });
    snapshot.current = { query, folder, tag, favorite, top: windowed.viewport.top };
    useEffect(() => () => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot.current)); } catch { /* Session state is optional. */ } }, []);
    useLayoutEffect(() => { setColumns(libraryColumns(windowed.viewport.width, prefs.compact)); }, [windowed.viewport.width, prefs.compact]);
    useEffect(() => { try {
        localStorage.setItem(PREFERENCE_KEY, JSON.stringify(prefs));
    }
    catch { /* Preferences are optional; browsing still works. */ } }, [prefs]);
    const preview = previewId ? index.byId.get(previewId) : undefined;
    useEffect(() => { if (previewId && !index.byId.has(previewId))
        setPreviewId(null); }, [previewId, index]);
    useEffect(() => {
        const live = [...sel.selection].filter(id => index.byId.has(id));
        if (live.length !== sel.size)
            sel.selectAll(live);
    }, [index, sel.selection, sel.size, sel.selectAll]);
    const closePreview = useCallback((restoreFocus = true) => {
        setPreviewId(null);
        if (restoreFocus)
            requestAnimationFrame(() => { if (previewTrigger.current?.isConnected)
                previewTrigger.current.focus({ preventScroll: true });
            else
                windowed.ref.current?.focus({ preventScroll: true }); });
    }, [windowed.ref]);
    useEffect(() => {
        if (!previewId)
            return;
        closeRef.current?.focus({ preventScroll: true });
        const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !sel.isSelecting) {
            event.preventDefault();
            closePreview();
        } };
        window.addEventListener("keydown", escape);
        return () => window.removeEventListener("keydown", escape);
    }, [previewId, closePreview, sel.isSelecting]);
    const open = useCallback((id: string, newTab = false) => {
        void useWorkspaceStore.getState().openNote(id, newTab).catch(() => useToastStore.getState().push(t("Не удалось открыть заметку")));
    }, [t]);
    const peek = useCallback((id: string, trigger: HTMLButtonElement) => { previewTrigger.current = trigger; setPreviewId(id); }, []);
    const onFavorite = useCallback((id: string) => { void useNotesStore.getState().toggleFavorite(id); }, []);
    const onTag = useCallback((value: string) => { const normalized = normalizeLibraryTag(value); sel.clear(); setTag(previous => previous === normalized ? "" : normalized); }, [sel.clear]);
    const noteRows = useMemo(() => {
        const positions = new Map<string, {
            row: number;
            column: number;
        }>();
        layout.rows.forEach((row, rowIndex) => { if (row.kind === "cards")
            row.notes.forEach((note, column) => positions.set(note.id, { row: rowIndex, column })); });
        return positions;
    }, [layout]);
    const navigate = useCallback((id: string, event: KeyboardEvent<HTMLButtonElement>) => {
        if (!event.key.startsWith("Arrow") && event.key !== "Home" && event.key !== "End")
            return;
        const position = noteRows.get(id);
        if (!position)
            return;
        let rowIndex = position.row, column = position.column;
        if (event.key === "Home" || event.key === "End") {
            rowIndex = event.key === "Home" ? 0 : layout.rows.length - 1;
            column = event.key === "Home" ? 0 : columns - 1;
        }
        else if (event.key === "ArrowLeft")
            column--;
        else if (event.key === "ArrowRight")
            column++;
        else
            rowIndex += event.key === "ArrowUp" ? -1 : 1;
        const direction = event.key === "Home" ? 1 : event.key === "End" || event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        const current = layout.rows[rowIndex];
        if (column < 0) {
            rowIndex--;
            column = columns - 1;
        }
        else if (current?.kind === "cards" && column >= current.notes.length && rowIndex === position.row) {
            rowIndex++;
            column = 0;
        }
        while (rowIndex >= 0 && rowIndex < layout.rows.length && layout.rows[rowIndex].kind !== "cards")
            rowIndex += direction;
        const row = layout.rows[rowIndex];
        if (!row || row.kind !== "cards")
            return;
        const next = row.notes[Math.min(Math.max(0, column), row.notes.length - 1)];
        if (!next)
            return;
        event.preventDefault();
        const element = windowed.ref.current;
        if (element) {
            if (row.top < element.scrollTop)
                element.scrollTop = row.top;
            else if (row.top + cardHeight > element.scrollTop + element.clientHeight)
                element.scrollTop = row.top + cardHeight - element.clientHeight + 24;
            windowed.onScroll();
            keyboardTarget.current = next.id;
            const mounted = element.querySelector<HTMLButtonElement>(`[data-note-id="${CSS.escape(next.id)}"] .library-card-open`);
            if (mounted) {
                mounted.focus({ preventScroll: true });
                keyboardTarget.current = null;
            }
        }
    }, [layout, noteRows, columns, windowed.ref, windowed.onScroll, cardHeight]);
    useLayoutEffect(() => {
        if (!keyboardTarget.current)
            return;
        const mounted = windowed.ref.current?.querySelector<HTMLButtonElement>(`[data-note-id="${CSS.escape(keyboardTarget.current)}"] .library-card-open`);
        if (mounted) {
            mounted.focus({ preventScroll: true });
            keyboardTarget.current = null;
        }
    }, [windowed.start, windowed.end, layout, windowed.ref]);
    const reset = () => { setQuery(""); setFolder(""); setTag(""); setFavorite(false); sel.clear(); };
    const trash = async () => {
        const ids = [...sel.selection];
        if (!ids.length)
            return;
        const word = pluralRu(ids.length, t("заметку"), t("заметки"), t("заметок"));
        if (!(await confirmDialog(t("Переместить {n} {word} в корзину?", { n: ids.length, word }), { confirmLabel: t("В корзину") })))
            return;
        try {
            await useNotesStore.getState().batchTrashNotes(ids);
        }
        finally {
            sel.clear();
        }
    };
    const activeFilters = !!(query || folder || tag || favorite);
    return <section className={`note-library${prefs.compact ? " is-compact" : ""}`} aria-label={t("Все заметки")}>
    <header className="library-header"><div><h1>{t("Все заметки")}</h1><span className="library-count">{activeFilters ? `${filtered.length} / ${index.entries.length}` : index.entries.length} {t("заметок")}</span></div>{newNoteEnabled ? <button type="button" className="library-new" onClick={() => void createNote(folder)}><Plus size={16}/>{t("Новая заметка")}</button> : null}</header>
    <div className="library-tools">
      <label className="library-search"><Search size={17}/><input ref={searchRef} value={query} onChange={event => { sel.clear(); setQuery(event.target.value); }} placeholder={t("Название, папка или тег…")} aria-label={t("Поиск заметок")}/>{query && <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label={t("Очистить поиск заметок")}><X size={14}/></button>}</label>
      <select aria-label={t("Раздел библиотеки")} value={folder} onChange={event => { setFolder(event.target.value); sel.clear(); }}><option value="">{t("Вся библиотека")}</option>{index.folders.map(item => <option key={item.path} value={item.path}>{item.path} · {item.count}</option>)}</select>
      <select ref={tagRef} aria-label={t("Фильтр по тегу")} value={tag} onChange={event => { setTag(event.target.value); sel.clear(); }}><option value="">{t("Все теги")}</option>{index.tags.map(value => <option key={value} value={value}>#{value}</option>)}</select>
      <button type="button" className={`library-favorite${favorite ? " is-active" : ""}`} aria-pressed={favorite} onClick={() => { setFavorite(value => !value); sel.clear(); }}><Star size={15}/>{t("Избранное")}<span>{index.favoriteCount}</span></button>
    </div>
    <div className="library-view-tools"><div className="library-breadcrumb"><button type="button" onClick={() => { sel.clear(); setFolder(""); }}><FolderOpen size={15}/>{t("Вся библиотека")}</button>{folder && <><ChevronRight size={13}/><span title={folder}>{folder}</span></>}{tag && <button type="button" className="library-tag" onClick={() => setTag("")}>#{tag}<X size={11}/></button>}{activeFilters && <button type="button" className="library-reset" onClick={reset}>{t("Сбросить фильтры")}</button>}</div><div>
      <label><SlidersHorizontal size={14}/><select aria-label={t("Группировка заметок")} value={prefs.grouping} onChange={event => setPrefs(value => ({ ...value, grouping: event.target.value as LibraryGrouping }))}><option value="section">{t("По разделам")}</option><option value="folder">{t("По папкам")}</option><option value="none">{t("Без группировки")}</option></select></label>
      <select aria-label={t("Сортировка заметок")} value={prefs.sort} onChange={event => setPrefs(value => ({ ...value, sort: event.target.value as LibrarySort }))}><option value="updated">{t("По изменению")}</option><option value="created">{t("По созданию")}</option><option value="title">{t("По названию")}</option></select>
      <button type="button" className="library-density" aria-pressed={prefs.compact} onClick={() => setPrefs(value => ({ ...value, compact: !value.compact }))} title={t(prefs.compact ? "Крупные карточки" : "Компактные карточки")} aria-label={t(prefs.compact ? "Крупные карточки" : "Компактные карточки")}><Grid2X2 size={15}/></button>
    </div></div>
    <div className="library-body">
      <div className="library-viewport" ref={windowed.ref} onScroll={windowed.onScroll} tabIndex={0} aria-label={t("Карточки заметок")} aria-busy={query !== deferred} onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !(event.target instanceof HTMLInputElement)) {
                event.preventDefault();
                sel.selectAll(filtered.map(note => note.id));
            }
            if (event.key === "/" && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                searchRef.current?.focus();
            }
        }}>
        {filtered.length ? <div className="library-canvas" style={{ height: layout.height }} data-library-total={filtered.length} data-library-mounted={windowed.rows.reduce((count, row) => count + (row.kind === "cards" ? row.notes.length : 0), 0)}>{windowed.rows.map(row => row.kind === "heading" ? <div key={`heading:${row.path}`} className="library-shelf-heading" style={{ top: row.top, height: row.height }}><h2>{row.label || t("Без папки")}</h2><span>{row.count}</span>{row.path && <button type="button" onClick={() => { setFolder(row.path); sel.clear(); }} aria-label={`${t("Открыть раздел")}: ${row.path}`} title={row.path}><ChevronRight size={16}/></button>}</div> : <div key={`row:${row.notes[0].id}`} className="library-card-row" style={{ top: row.top, height: cardHeight, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{row.notes.map(note => <LibraryNoteCard key={note.id} note={note} selected={sel.selection.has(note.id)} selecting={sel.isSelecting} previewing={previewId === note.id} onOpen={open} onPreview={peek} onSelect={sel.toggle} onFavorite={onFavorite} onTag={onTag} onNavigate={navigate}/>)}</div>)}</div> : <div className="library-empty"><Search size={30}/><h2>{t(index.entries.length ? "Заметки не найдены" : "Заметок пока нет")}</h2><p>{t(index.entries.length ? "Измени запрос или сбрось фильтры" : "Создай первую заметку")}</p>{index.entries.length || newNoteEnabled ? <button type="button" onClick={index.entries.length ? reset : () => void createNote("")}>{t(index.entries.length ? "Сбросить фильтры" : "Новая заметка")}</button> : null}</div>}
      </div>
      {preview && <aside className="library-preview" role="dialog" aria-modal="false" aria-label={t("Быстрый просмотр")}><div className="library-preview-top"><span>{t("Быстрый просмотр")}</span><button ref={closeRef} type="button" onClick={() => closePreview()} aria-label={t("Закрыть просмотр")}><X size={18}/></button></div><Suspense fallback={<div className="library-empty" role="status">{t("Загрузка…")}</div>}><ReadingPane note={preview} selectedTags={tag ? [tag] : EMPTY_TAGS} files={files} loadNote={loadNote} onOpen={open} onTrash={id => void useNotesStore.getState().trashNote(id)} onTag={onTag} onAddFilter={() => { closePreview(false); tagRef.current?.focus(); }}/></Suspense></aside>}
    </div>
    <BulkActionBar count={sel.size} total={filtered.length} onClear={sel.clear} onSelectAll={() => sel.selectAll(filtered.map(note => note.id))} actions={[{ id: "trash", label: t("В корзину"), icon: Trash2, variant: "danger", onClick: trash }]}/>
  </section>;
}
