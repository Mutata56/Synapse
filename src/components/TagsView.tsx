import { ArrowDownWideNarrow, Check, ChevronDown, ChevronRight, FileText, Hash, RotateCcw, Search, Tags, CircleMinus, X } from "lucide-react";
import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { indexVaultFiles } from "../lib/obsidianImport";
import { pluralRu } from "../lib/format";
import { readNote, type Note, type NoteMeta } from "../lib/storage";
import { buildTagIndex, getTagRows, normalizeTag, queryTagIndex, type NoteSort, type TagSort } from "../lib/tagExplorer";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { useI18n } from "./LanguageProvider";
import { useWindowedRows } from "./useWindowedRows";
import "./TagsView.css";

const ReadingPane = lazy(() => import("./TagReadingPane"));
const NOTE_ROW_HEIGHT = 88;
const TAG_ROW_HEIGHT = 40;

export function TagsView({ loadNote = readNote }: { loadNote?: (id: string) => Promise<Note | null> }) {
  const { t, lang } = useI18n();
  const tree = useNotesStore((s) => s.tree);
  const filter = useNotesStore((s) => s.tagsFilter);
  const setFilter = useNotesStore((s) => s.setTagsFilter);
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);
  const trashNote = useNotesStore((s) => s.trashNote);
  const [tagSearch, setTagSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [tagSort, setTagSort] = useState<TagSort>("count");
  const [noteSort, setNoteSort] = useState<NoteSort>("updated");
  const [previewId, setPreviewId] = useState<string | null>(() => useNotesStore.getState().activeId);
  const [focusedTag, setFocusedTag] = useState("");
  const [pane, setPane] = useState<"tags" | "notes" | "reader">("notes");
  const searchRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const anyMatchRef = useRef<HTMLButtonElement>(null);
  const previousPane = useRef(pane);
  const listId = useId();
  const tagListId = useId();
  const deferredTagSearch = useDeferredValue(tagSearch);
  const index = useMemo(() => buildTagIndex(flattenNotes(tree)), [tree]);
  const rows = useMemo(() => getTagRows(index, expanded, deferredTagSearch, tagSort), [index, expanded, deferredTagSearch, tagSort]);
  const results = useMemo(() => queryTagIndex(index, { ...filter, sort: noteSort }), [index, filter.tags, filter.match, filter.untagged, noteSort]);
  const positions = useMemo(() => new Map(results.map((note, i) => [note.id, i])), [results]);
  const selectedIndex = previewId ? positions.get(previewId) ?? 0 : 0;
  const selected = results[selectedIndex] ?? null;
  const files = useMemo(() => indexVaultFiles(index.notes.map((note) => `${note.id}.md`)), [index]);
  const dates = useMemo(() => new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short" }), [lang]);
  const resetKey = `${filter.tags.join("\0")}|${filter.match}|${filter.untagged}|${noteSort}`;
  const noteWindow = useWindowedRows(results.length, NOTE_ROW_HEIGHT, resetKey);
  const tagWindow = useWindowedRows(rows.length, TAG_ROW_HEIGHT, `${deferredTagSearch}|${tagSort}`);
  const tagIndex = Math.max(0, rows.findIndex((row) => row.path === focusedTag));
  const activeFilters = filter.tags.length > 0 || filter.untagged;
  const effectiveMatch = filter.tags.length ? filter.match : "any";
  const inventoryLabel = lang === "ru"
    ? `${index.explicitCount} ${pluralRu(index.explicitCount, "тег", "тега", "тегов")}`
    : t("{n} тегов", { n: index.explicitCount });
  const resultLabel = lang === "ru"
    ? `${results.length} из ${index.notes.length} ${pluralRu(index.notes.length, "заметки", "заметок", "заметок")}`
    : t("{n} из {total} заметок", { n: results.length, total: index.notes.length });

  // Transfer focus after CSS pane visibility commits, without stealing focus
  // from the results list when all three panes remain visible on desktop.
  useLayoutEffect(() => {
    const before = previousPane.current; previousPane.current = pane;
    if (before === pane) return;
    if (pane === "tags") searchRef.current?.focus({ preventScroll: true });
    else if (pane === "reader" && !noteWindow.ref.current?.getClientRects().length) readerRef.current?.focus({ preventScroll: true });
    else if (pane === "notes" && (
      (before === "reader" && !readerRef.current?.getClientRects().length) ||
      (before === "tags" && !searchRef.current?.getClientRects().length)
    )) noteWindow.ref.current?.focus({ preventScroll: true });
  }, [pane, noteWindow.ref]);

  const reset = () => { setFilter({ tags: [], match: "all", untagged: false }); setTagSearch(""); setPane("notes"); };
  const removeFilter = (tag: string) => {
    if (filter.tags.length === 1) anyMatchRef.current?.focus();
    setFilter({ tags: filter.tags.filter((value) => value !== tag) });
  };
  const toggleTag = useCallback((path: string) => {
    const state = useNotesStore.getState();
    const tag = normalizeTag(path);
    state.setTagsFilter({ tags: state.tagsFilter.tags.includes(tag) ? state.tagsFilter.tags.filter((value) => value !== tag) : [...state.tagsFilter.tags, tag] });
    setPane("notes");
  }, []);
  const expand = (path: string, value?: boolean) => setExpanded((previous) => {
    const next = new Set(previous);
    if (value ?? !next.has(path)) next.add(path); else next.delete(path);
    return next;
  });
  const open = useCallback((id: string) => {
    // selectNote flushes existing drafts and rejects stale reads itself.
    void selectNote(id).then(() => {
      if (useNotesStore.getState().activeId === id) setView("notes");
    }).catch(() => useToastStore.getState().push(t("Не удалось открыть заметку")));
  }, [selectNote, setView, t]);
  const choose = useCallback((id: string) => { setPreviewId(id); setPane("reader"); }, []);
  const onResultsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!results.length) return;
    let next = selectedIndex;
    if (event.key === "ArrowDown") next++;
    else if (event.key === "ArrowUp") next--;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = results.length - 1;
    else if (event.key === "PageDown") next += Math.max(1, Math.floor(noteWindow.height / NOTE_ROW_HEIGHT));
    else if (event.key === "PageUp") next -= Math.max(1, Math.floor(noteWindow.height / NOTE_ROW_HEIGHT));
    else if (event.key === "Enter") { event.preventDefault(); if (event.metaKey || event.ctrlKey) open(results[selectedIndex].id); else setPane("reader"); return; }
    else return;
    event.preventDefault();
    next = Math.min(results.length - 1, Math.max(0, next));
    setPreviewId(results[next].id);
    noteWindow.reveal(next);
  };
  const onTagsKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[tagIndex]; if (!row) return;
    let next = tagIndex;
    if (event.key === "ArrowDown") next++;
    else if (event.key === "ArrowUp") next--;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else if (event.key === "ArrowRight" && row.children.length) { event.preventDefault(); if (!row.expanded) expand(row.path, true); else next++; }
    else if (event.key === "ArrowLeft") { event.preventDefault(); if (row.expanded) expand(row.path, false); else if (row.parent) next = rows.findIndex((item) => item.path === row.parent); }
    else if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggleTag(row.path); return; }
    else return;
    event.preventDefault(); next = Math.min(rows.length - 1, Math.max(0, next));
    setFocusedTag(rows[next].path); tagWindow.reveal(next);
  };

  return <section className="tags-view" aria-label={t("Теги")}>
    <header className="tags-header">
      <div className="tags-heading-row">
        <div className="tags-heading"><h1>{t("Теги")}</h1><span>{inventoryLabel}</span></div>
        <div className="tags-heading-actions"><span className="tags-result-count" role="status" aria-live="polite">{resultLabel}</span><button className="tags-reset" type="button" disabled={!activeFilters && !tagSearch} aria-label={t("Сбросить фильтр")} title={t("Сбросить фильтр")} onClick={reset}><RotateCcw size={15} aria-hidden="true" /></button></div>
      </div>
      <div className="tags-filter-row">
        {filter.untagged ? <div className="tags-filter-chips"><span className="tags-filter-chip"><CircleMinus size={13} aria-hidden="true" /><span>{t("Без тегов")}</span><button type="button" onClick={() => { anyMatchRef.current?.focus(); setFilter({ untagged: false }); }} aria-label={t("Убрать фильтр без тегов")}><X size={12} /></button></span></div> : filter.tags.length ? <SelectedFilters tags={filter.tags} onRemove={removeFilter} /> : <span className="tags-filter-all">{t("Все заметки")}</span>}
        <div className="tags-match" role="group" aria-label={t("Совпадение тегов")}><button type="button" disabled={!filter.tags.length} aria-pressed={effectiveMatch === "all"} title={!filter.tags.length ? t("Сначала выбери теги") : undefined} onClick={() => setFilter({ match: "all" })}>{t("Все выбранные")}</button><button ref={anyMatchRef} type="button" aria-pressed={effectiveMatch === "any"} onClick={() => setFilter({ match: "any" })}>{t("Любой")}</button></div>
      </div>
    </header>
    <nav className="tags-pane-tabs" aria-label={t("Панели тегов")}>
      <button type="button" className="tags-tab-catalog" aria-pressed={pane === "tags"} onClick={() => setPane("tags")}><Tags size={15} />{t("Теги")}</button>
      <button type="button" aria-pressed={pane === "notes"} onClick={() => setPane("notes")}><FileText size={15} />{t("Заметки")}<span>{results.length}</span></button>
      <button type="button" disabled={!selected} aria-pressed={pane === "reader"} onClick={() => setPane("reader")}>{t("Чтение")}</button>
    </nav>
    <div className="tags-workspace" data-pane={pane}>
      <aside className="tags-catalog" aria-label={t("Каталог тегов")}>
        <div className="tags-catalog-tools"><label className="tags-search"><Search size={15} aria-hidden="true" /><input ref={searchRef} aria-label={t("Поиск тегов")} placeholder={t("Поиск тегов…")} value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} />{tagSearch && <button type="button" aria-label={t("Очистить поиск тегов")} onClick={() => setTagSearch("")}><X size={14} /></button>}</label></div>
        <div className="tags-scopes"><button type="button" aria-pressed={!filter.tags.length && !filter.untagged} onClick={() => { setFilter({ tags: [], untagged: false }); setPane("notes"); }}><Tags size={16} /><span>{t("Все заметки")}</span><span className="tags-count">{index.notes.length}</span></button><button type="button" aria-pressed={filter.untagged} onClick={() => { setFilter({ untagged: true }); setPane("notes"); }}><CircleMinus size={16} /><span>{t("Без тегов")}</span><span className="tags-count">{index.untagged.length}</span></button></div>
        <div className="tags-catalog-label"><span>{t("Теги")}</span><label><ArrowDownWideNarrow size={13} aria-hidden="true" /><select aria-label={t("Порядок тегов")} value={tagSort} onChange={(event) => setTagSort(event.target.value as TagSort)}><option value="count">{t("По частоте")}</option><option value="name">{t("По имени")}</option></select></label></div>
        <div className="tags-tree tags-scroll" ref={tagWindow.ref} onScroll={tagWindow.onScroll} role="tree" aria-label={t("Дерево тегов")} aria-multiselectable="true" tabIndex={0} onKeyDown={onTagsKey} aria-activedescendant={tagIndex >= tagWindow.start && tagIndex < tagWindow.end ? `${tagListId}-${tagIndex}` : undefined}>
          {rows.length ? <div className="tags-window" style={{ height: tagWindow.total }}><div className="tags-window-slice" style={{ transform: `translateY(${tagWindow.offset}px)` }}>{rows.slice(tagWindow.start, tagWindow.end).map((row, offset) => {
            const active = filter.tags.includes(row.path); const rowIndex = tagWindow.start + offset;
            return <div className="tags-tree-row" key={row.path} id={`${tagListId}-${rowIndex}`} role="treeitem" aria-level={row.depth + 1} aria-selected={active} aria-expanded={row.children.length ? row.expanded : undefined} title={`#${row.path}`} data-active={active} data-focused={rowIndex === tagIndex} style={{ paddingInlineStart: 12 + row.depth * 14 }} onClick={() => { setFocusedTag(row.path); toggleTag(row.path); tagWindow.ref.current?.focus({ preventScroll: true }); }}>
              {row.children.length ? <button type="button" tabIndex={-1} className="tags-disclosure" aria-label={t(row.expanded ? "Свернуть тег {tag}" : "Развернуть тег {tag}", { tag: row.path })} onClick={(event) => { event.stopPropagation(); expand(row.path); setFocusedTag(row.path); tagWindow.ref.current?.focus({ preventScroll: true }); }}>{row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="tags-tree-spacer" />}
              <Hash size={14} aria-hidden="true" /><span className="tags-tree-name">{row.label}</span><span className="tags-count">{row.count}</span><span className="tags-tree-check" aria-hidden="true">{active && <Check size={12} />}</span>
            </div>;
          })}</div></div> : <div className="tags-small-empty"><Hash size={20} /><p>{t(tagSearch ? "Теги не найдены" : "Тегов пока нет")}</p><p>{t(tagSearch ? "Попробуй другое название" : "Добавь #тег в заметку. Для вложенного тега используй #тема/подтема.")}</p></div>}
        </div>
      </aside>
      <section className="tags-results" aria-label={t("Найденные заметки")}>
        <div className="tags-results-tools"><h2>{t("Заметки")}</h2><label><ArrowDownWideNarrow size={14} aria-hidden="true" /><select aria-label={t("Сортировка заметок")} value={noteSort} onChange={(event) => setNoteSort(event.target.value as NoteSort)}><option value="updated">{t("По дате обновления")}</option><option value="created">{t("По созданию")}</option><option value="title">{t("По названию")}</option></select><ChevronDown size={13} aria-hidden="true" /></label></div>
        <div className="tags-note-list tags-scroll" ref={noteWindow.ref} onScroll={noteWindow.onScroll} onKeyDown={onResultsKey} tabIndex={0} role="listbox" aria-label={t("Найденные заметки")} aria-activedescendant={selected && selectedIndex >= noteWindow.start && selectedIndex < noteWindow.end ? `${listId}-${selectedIndex}` : undefined}>
          {results.length ? <div className="tags-window" style={{ height: noteWindow.total }}><div className="tags-window-slice" style={{ transform: `translateY(${noteWindow.offset}px)` }}>{results.slice(noteWindow.start, noteWindow.end).map((note, offset) => <ResultRow key={note.id} note={note} selected={note.id === selected?.id} id={`${listId}-${noteWindow.start + offset}`} formatDate={dates} onChoose={choose} onOpen={open} />)}</div></div> : <div className="tags-empty"><Search size={28} /><h3>{t(index.notes.length ? "Заметки не найдены" : "Заметок пока нет")}</h3><p>{t(index.notes.length ? "Убери один из тегов или выбери «Любой»." : "Создай заметку и добавь теги, чтобы находить её здесь.")}</p>{activeFilters && <button type="button" className="tags-button" onClick={reset}>{t("Сбросить фильтр")}</button>}</div>}
        </div>
      </section>
      <section className="tags-reading" ref={readerRef} tabIndex={-1} aria-label={t("Чтение заметки")}>
        {selected ? <Suspense fallback={<div className="tags-empty" role="status">{t("Загрузка…")}</div>}><ReadingPane note={selected} selectedTags={filter.tags} files={files} loadNote={loadNote} onOpen={open} onTrash={(id) => void trashNote(id).catch(() => useToastStore.getState().push(t("Не удалось переместить заметку в корзину")))} onTag={toggleTag} onAddFilter={() => { setPane("tags"); if (searchRef.current?.getClientRects().length) searchRef.current.focus({ preventScroll: true }); }} /></Suspense> : <div className="tags-empty"><FileText size={28} /><h3>{t("Выбери заметку")}</h3><p>{t("Здесь появится её содержимое")}</p></div>}
      </section>
    </div>
  </section>;
}

/** A bounded summary keeps the header stable even when every tag is selected. */
function SelectedFilters({ tags, onRemove }: { tags: string[]; onRemove: (tag: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusAfterRemove = useRef<number | null>(null);
  const restoreOnClose = useRef(false);
  const popupId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); restoreOnClose.current = true; setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open && restoreOnClose.current) {
      restoreOnClose.current = false;
      const target = trigger.current?.getClientRects().length ? trigger.current : root.current?.querySelector<HTMLButtonElement>(".tags-filter-chip button");
      target?.focus({ preventScroll: true });
    }
    const removedIndex = focusAfterRemove.current;
    if (removedIndex === null) return;
    focusAfterRemove.current = null;
    // Keep an open selection list available down to its last tag. Restore focus
    // to the next row, or the preceding row when the last row was removed.
    if (open) {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>(".tags-filter-popover-list button");
      buttons?.[Math.min(removedIndex, buttons.length - 1)]?.focus({ preventScroll: true });
    } else root.current?.querySelector<HTMLButtonElement>(".tags-filter-chip button")?.focus({ preventScroll: true });
  }, [tags, open]);
  const remove = (tag: string) => { focusAfterRemove.current = tags.indexOf(tag); onRemove(tag); };
  return <div ref={root} className="tags-filter-chips" aria-label={t("Выбранные теги")} onBlur={(event) => {
    // WebKit may blur a removed or clicked button without a related target.
    // Outside pointer clicks are handled above; close on a known focus exit.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    {tags.slice(0, 2).map((tag, i) => <span key={tag} className={`tags-filter-chip${i ? " tags-filter-secondary" : ""}`}><Hash size={12} aria-hidden="true" /><span title={tag}>{tag}</span><button type="button" onClick={() => remove(tag)} aria-label={t("Убрать тег {tag}", { tag })}><X size={12} /></button></span>)}
    {(tags.length > 1 || open) && <div className="tags-filter-overflow" data-count={tags.length} data-open={open}>
      <button ref={trigger} type="button" className="tags-filter-more" aria-label={t("Все выбранные теги: {n}", { n: tags.length })} aria-expanded={open} aria-controls={open ? popupId : undefined} onClick={() => { restoreOnClose.current = open; setOpen((value) => !value); }}><span className="tags-more-wide">{tags.length > 2 ? `+${tags.length - 2}` : t("Выбрано: {n}", { n: tags.length })}</span><span className="tags-more-small">{tags.length > 1 ? `+${tags.length - 1}` : t("Выбрано: {n}", { n: tags.length })}</span><ChevronDown size={12} aria-hidden="true" /></button>
      {open && <div id={popupId} className="tags-filter-popover" role="group" aria-label={t("Выбранные теги")}><div className="tags-filter-popover-heading">{t("Выбранные теги")}<span>{tags.length}</span></div><div className="tags-filter-popover-list tags-scroll">{tags.map((tag) => <div key={tag}><Hash size={13} aria-hidden="true" /><span title={tag}>{tag}</span><button type="button" onClick={() => remove(tag)} aria-label={t("Убрать тег {tag}", { tag })}><X size={13} /></button></div>)}</div></div>}
    </div>}
  </div>;
}

const ResultRow = memo(function ResultRow({ note, selected, id, formatDate, onChoose, onOpen }: { note: NoteMeta; selected: boolean; id: string; formatDate: Intl.DateTimeFormat; onChoose: (id: string) => void; onOpen: (id: string) => void }) {
  const tags = [...new Set(note.tags.map(normalizeTag).filter(Boolean))];
  return <div id={id} className="tags-result-row" role="option" aria-selected={selected} onClick={(event) => { onChoose(note.id); event.currentTarget.closest<HTMLElement>("[role=listbox]")?.focus({ preventScroll: true }); }} onDoubleClick={() => onOpen(note.id)}>
    <FileText size={17} className="tags-result-icon" aria-hidden="true" /><div className="tags-result-title" title={note.title}>{note.title}</div>
    <div className="tags-result-folder" title={note.folder || "/"}>{note.folder || "/"}</div>
    <div className="tags-result-bottom"><div className="tags-result-tags">{tags.slice(0, 2).map((tag) => <span key={tag} title={`#${tag}`}><Hash size={10} aria-hidden="true" />{tag}</span>)}{tags.length > 2 && <span>+{tags.length - 2}</span>}</div><time dateTime={new Date(note.updatedAt).toISOString()}>{formatDate.format(note.updatedAt)}</time></div>
  </div>;
});
