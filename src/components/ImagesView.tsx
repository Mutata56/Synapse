import { ArrowDownWideNarrow, Check, ChevronLeft, ChevronRight, Expand, FileImage, Folder, Grid2X2, ImageOff, Link2, List, RefreshCw, Search, Trash2, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatBytes, pluralRu } from "../lib/format";
import { buildImageIndex, imageFormat, isImageNote, queryImageIndex, type ImageLibrary, type ImageScope, type ImageSort, type LibraryImage } from "../lib/imageLibrary";
import { loadImagePreview, prioritizeImagePreview, subscribeImagePreview, type ImagePreview, type PreviewLoader } from "../lib/imagePreviews";
import { deleteUnusedLibraryImages, imageFilePath, listImageLibrary } from "../lib/storage";
import { confirmDialog } from "../store/confirm";
import { useImageLibraryStore } from "../store/imageLibrary";
import { useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { useI18n } from "./LanguageProvider";
import { useWindowedRows } from "./useWindowedRows";
import "./ImagesView.css";

const ImageViewer = lazy(() => import("./LibraryImageViewer"));
const EMPTY: LibraryImage[] = [];
type Props = { loadLibrary?: () => Promise<ImageLibrary>; previewLoader?: PreviewLoader; revealImage?: (image: LibraryImage) => Promise<void>; deleteImages?: (ids: readonly string[]) => Promise<void> };
const revealImageFile = async (image: LibraryImage) => revealItemInDir(await imageFilePath(image.id));

export function ImagesView({ loadLibrary = listImageLibrary, previewLoader = loadImagePreview, revealImage = revealImageFile, deleteImages = deleteUnusedLibraryImages }: Props = {}) {
  const { t, lang } = useI18n();
  const library = useImageLibraryStore((s) => s.library);
  const loading = useImageLibraryStore((s) => s.loading);
  const error = useImageLibraryStore((s) => s.error);
  const refresh = useImageLibraryStore((s) => s.refresh);
  const filter = useImageLibraryStore((s) => s.filter);
  const setFilter = useImageLibraryStore((s) => s.setFilter);
  const mode = useImageLibraryStore((s) => s.mode);
  const setMode = useImageLibraryStore((s) => s.setMode);
  const focusedId = useImageLibraryStore((s) => s.focusedId);
  const focus = useImageLibraryStore((s) => s.focus);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, gallery: 700 });
  const root = useRef<HTMLElement>(null);
  const details = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const navigation = useRef(0);
  const galleryId = useId();
  const deferredQuery = useDeferredValue(filter.query);
  const index = useMemo(() => buildImageIndex(library?.images ?? EMPTY), [library?.images]);
  const results = useMemo(() => queryImageIndex(index, { ...filter, query: deferredQuery }), [index, deferredQuery, filter.scope, filter.folder, filter.format, filter.sort]);
  const positions = useMemo(() => new Map(results.map((image, i) => [image.id, i])), [results]);
  const position = focusedId ? positions.get(focusedId) ?? 0 : 0;
  const selected = results[position] ?? null;
  const compact = size.width <= 950;
  const columns = mode === "list" ? 1 : Math.max(1, Math.floor((size.gallery - 18) / 204));
  const tileWidth = Math.max(150, (size.gallery - 32 - (columns - 1) * 14) / columns);
  const rowHeight = mode === "list" ? 76 : Math.ceil(tileWidth * .7) + 66;
  const resetKey = `${deferredQuery}|${filter.scope}|${filter.folder}|${filter.format}|${filter.sort}|${mode}|${columns}|${results.length}`;
  const windowed = useWindowedRows(Math.ceil(results.length / columns), rowHeight, resetKey);
  const lastLayout = useRef({ columns, mode, rowHeight });
  useLayoutEffect(() => {
    const before = lastLayout.current; lastLayout.current = { columns, mode, rowHeight };
    if (before.columns !== columns || before.mode !== mode || before.rowHeight !== rowHeight) windowed.reveal(Math.floor(position / columns));
  }, [columns, mode, rowHeight, position, windowed.reveal]);
  const first = windowed.start * columns; const last = Math.min(results.length, windowed.end * columns);
  const eligible = useMemo(() => results.filter((image) => image.managed && !image.usedBy.length), [results]);
  const eligibleIds = useMemo(() => new Set(index.images.filter((image) => image.managed && !image.usedBy.length).map((image) => image.id)), [index]);
  const selectedForDelete = [...checked].filter((id) => eligibleIds.has(id));
  const activeFilters = !!filter.query || filter.scope !== "all" || filter.folder !== null || !!filter.format;
  const countLabel = lang === "ru" ? `${index.images.length} ${pluralRu(index.images.length, "файл", "файла", "файлов")}` : t("{n} файлов", { n: index.images.length });
  useEffect(() => { void refresh(loadLibrary); }, [refresh, loadLibrary]);
  useLayoutEffect(() => {
    const element = root.current; const gallery = windowed.ref.current;
    if (!element || !gallery) return;
    const measure = () => setSize((before) => {
      const width = element.clientWidth; const galleryWidth = gallery.clientWidth;
      return before.width === width && before.gallery === galleryWidth ? before : { width, gallery: galleryWidth };
    });
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); observer.observe(gallery);
    return () => observer.disconnect();
  }, [windowed.ref]);
  useLayoutEffect(() => {
    const before = wasOpen.current; wasOpen.current = detailsOpen;
    if (before === detailsOpen) return;
    if (detailsOpen && !windowed.ref.current?.getClientRects().length) details.current?.focus({ preventScroll: true });
    else if (!detailsOpen && !details.current?.getClientRects().length) {
      const element = windowed.ref.current;
      if (element) {
        const cols = mode === "list" ? 1 : Math.max(1, Math.floor((element.clientWidth - 18) / 204));
        const height = mode === "list" ? 76 : Math.ceil(Math.max(150, (element.clientWidth - 32 - (cols - 1) * 14) / cols) * .7) + 66;
        element.scrollTop = Math.floor(position / cols) * height; element.focus({ preventScroll: true });
      }
    }
  }, [detailsOpen, windowed.ref]);
  const choose = useCallback((id: string) => { focus(id); setDetailsOpen(true); }, [focus]);
  const openViewer = useCallback((id: string) => setViewerId(id), []);
  const toggleChecked = useCallback((id: string) => setChecked((previous) => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  }), []);
  const openUsage = useCallback(async (id: string) => {
    if (id === "__trash__") { useNotesStore.getState().setView("trash"); return; }
    if (id === "__versions__" || id.startsWith("__unindexed__:")) return;
    const sequence = ++navigation.current;
    try {
      await useNotesStore.getState().selectNote(id);
      if (sequence === navigation.current && useNotesStore.getState().activeId === id) useNotesStore.getState().setView("notes");
    } catch { useToastStore.getState().push(t("Не удалось открыть заметку")); }
  }, [t]);
  const reset = () => { setFilter({ query: "", scope: "all", folder: null, format: "" }); setChecked(new Set()); };
  const remove = async () => {
    if (!selectedForDelete.length || deleting || loading || !library?.complete) return;
    if (!await confirmDialog(t("Удалить {n} неиспользуемых изображений?", { n: selectedForDelete.length }))) return;
    setDeleting(true);
    try { await deleteImages(selectedForDelete); setChecked(new Set()); }
    catch { useToastStore.getState().push(t("Не удалось удалить изображения. Обнови список и проверь связи.")); }
    finally { await refresh(loadLibrary); setDeleting(false); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!results.length) return;
    let next = position;
    if (event.key === "ArrowRight") next++;
    else if (event.key === "ArrowLeft") next--;
    else if (event.key === "ArrowDown") next += columns;
    else if (event.key === "ArrowUp") next -= columns;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = results.length - 1;
    else if (event.key === "PageDown") next += Math.max(1, Math.floor(windowed.height / rowHeight)) * columns;
    else if (event.key === "PageUp") next -= Math.max(1, Math.floor(windowed.height / rowHeight)) * columns;
    else if (event.key === "Enter") { event.preventDefault(); openViewer(results[position].id); return; }
    else if (event.key === " " && eligibleIds.has(results[position].id) && library?.complete) { event.preventDefault(); toggleChecked(results[position].id); return; }
    else return;
    event.preventDefault(); next = Math.min(results.length - 1, Math.max(0, next));
    focus(results[next].id); windowed.reveal(Math.floor(next / columns));
  };
  return <section ref={root} className="images-view" aria-label={t("Изображения")}>
    <header className="images-header">
      <div className="images-heading"><div><h1>{t("Изображения")}</h1><span>{library ? `${countLabel} · ${formatBytes(index.totalBytes)}` : t("Загрузка…")}</span></div><button type="button" className="images-icon-button" disabled={loading} onClick={() => void refresh(loadLibrary)} aria-label={t("Обновить изображения")} title={t("Обновить изображения")}><RefreshCw size={16} className={loading ? "images-refreshing" : ""} /></button></div>
      <div className="images-toolbar">
        <label className="images-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={t("Поиск изображений")} placeholder={t("Поиск по имени, папке или заметке…")} value={filter.query} onChange={(event) => setFilter({ query: event.target.value })} />{filter.query && <button type="button" aria-label={t("Очистить поиск")} onClick={() => setFilter({ query: "" })}><X size={14} /></button>}</label>
        <label className="images-select"><Folder size={14} aria-hidden="true" /><select aria-label={t("Папка изображений")} value={filter.folder === null ? "@all" : `folder:${filter.folder}`} onChange={(event) => setFilter({ folder: event.target.value === "@all" ? null : event.target.value.slice(7) })}><option value="@all">{t("Все папки")}</option>{index.folders.map(([folder, count]) => <option key={folder} value={`folder:${folder}`}>{folder === ".assets" ? t("Загруженные") : folder || t("Корень хранилища")} ({count})</option>)}</select></label>
        <label className="images-select images-format"><select aria-label={t("Формат изображения")} value={filter.format} onChange={(event) => setFilter({ format: event.target.value })}><option value="">{t("Все форматы")}</option>{index.formats.map(([format, count]) => <option key={format} value={format}>{format.toUpperCase()} ({count})</option>)}</select></label>
        <label className="images-select images-sort"><ArrowDownWideNarrow size={14} aria-hidden="true" /><select aria-label={t("Сортировка изображений")} value={filter.sort} onChange={(event) => setFilter({ sort: event.target.value as ImageSort })}><option value="modified">{t("По изменению")}</option><option value="name">{t("По имени")}</option><option value="size">{t("Сначала крупные")}</option></select></label>
        <div className="images-layout" role="group" aria-label={t("Вид изображений")}><button type="button" aria-label={t("Сетка")} aria-pressed={mode === "grid"} onClick={() => setMode("grid")}><Grid2X2 size={16} /></button><button type="button" aria-label={t("Список")} aria-pressed={mode === "list"} onClick={() => setMode("list")}><List size={17} /></button></div>
      </div>
      <div className="images-scopes"><div role="group" aria-label={t("Связи изображений")}>{([["all", "Все", index.images.length], ["used", "Со связями", index.used], ["unused", "Без связей", index.unused]] as const).map(([scope, label, count]) => <button type="button" key={scope} aria-pressed={filter.scope === scope} onClick={() => setFilter({ scope: scope as ImageScope })}>{t(label)}<span>{count}</span></button>)}</div><span className="images-result-count" role="status" aria-live="polite">{t("Показано {n} из {total}", { n: results.length, total: index.images.length })}</span>{activeFilters && <button type="button" className="images-text-button" onClick={reset}>{t("Сбросить")}</button>}{eligible.length > 0 && library?.complete && <button type="button" className="images-text-button" onClick={() => setChecked(new Set(eligible.map((image) => image.id)))}>{t("Выбрать неиспользуемые")}</button>}</div>
    </header>
    {(error || library?.complete === false) && <div className="images-error" role="alert"><span>{t(error ? "Не удалось загрузить изображения" : "Часть файлов недоступна")}</span><button type="button" onClick={() => void refresh(loadLibrary)} disabled={loading}>{t("Повторить")}</button></div>}
    <div className="images-workspace" data-detail={detailsOpen}>
      <div className="images-gallery-panel">
        <div ref={windowed.ref} className="images-gallery images-scroll" onScroll={windowed.onScroll} onKeyDown={onKeyDown} tabIndex={0} role="listbox" aria-label={t("Библиотека изображений")} aria-busy={loading || deferredQuery !== filter.query} aria-activedescendant={selected && position >= first && position < last ? `${galleryId}-${position}` : undefined}>
          {!library && loading ? <div className="images-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} />)}</div> : !results.length ? <div className="images-empty"><FileImage size={32} strokeWidth={1.3} /><h2>{t(index.images.length ? "Изображения не найдены" : error ? "Не удалось загрузить изображения" : "Изображений пока нет")}</h2><p>{t(index.images.length ? "Попробуй другое название или измени фильтры." : "Здесь будут картинки из заметок и вложения хранилища.")}</p>{activeFilters && <button type="button" className="images-button" onClick={reset}>{t("Сбросить фильтр")}</button>}</div> : <div className="images-window" style={{ height: windowed.total }}><div className={`images-window-slice images-${mode}`} style={{ transform: `translateY(${windowed.offset}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: rowHeight - 14 }}>{results.slice(first, last).map((image, offset) => <ImageTile key={image.id} id={`${galleryId}-${first + offset}`} image={image} selected={selected?.id === image.id} checked={checked.has(image.id)} canDelete={!loading && !!library?.complete && eligibleIds.has(image.id)} onChoose={choose} onOpen={openViewer} onCheck={toggleChecked} previewLoader={previewLoader} active={!viewerId && (!compact || !detailsOpen)} />)}</div></div>}
        </div>
        {selectedForDelete.length > 0 && <div className="images-selection"><span role="status">{t("Выбрано: {n}", { n: selectedForDelete.length })}</span><button type="button" onClick={() => setChecked(new Set())}>{t("Отменить")}</button><button type="button" className="images-delete" disabled={deleting || loading || !library?.complete} onClick={() => void remove()}><Trash2 size={14} />{t(deleting ? "Удаление…" : "Удалить")}</button></div>}
      </div>
      <aside ref={details} className="images-detail" tabIndex={-1} aria-label={t("Сведения об изображении")}>
        {selected && (!compact || detailsOpen) ? <ImageDetails key={selected.id} image={selected} previewLoader={previewLoader} onOpen={openViewer} onUsage={openUsage} onBack={() => setDetailsOpen(false)} onReveal={() => void revealImage(selected).catch(() => useToastStore.getState().push(t("Не удалось показать файл")))} active={!viewerId} /> : <div className="images-empty"><FileImage size={28} /><p>{t("Выбери изображение")}</p></div>}
      </aside>
    </div>
    {viewerId && positions.has(viewerId) && <Suspense fallback={null}><ImageViewer images={results} activeId={viewerId} onChoose={(id) => { focus(id); setViewerId(id); windowed.reveal(Math.floor((positions.get(id) ?? 0) / columns)); }} onClose={() => { setViewerId(null); if (windowed.ref.current?.getClientRects().length) windowed.ref.current.focus({ preventScroll: true }); else details.current?.focus({ preventScroll: true }); }} onUsage={openUsage} /></Suspense>}
  </section>;
}

function usePreview(image: LibraryImage, loader: PreviewLoader, retry = 0, active = true, priority = false) {
  const key = `${image.id}:${image.modifiedAt}:${image.sizeBytes}:${retry}`;
  const [state, setState] = useState<{ key: string; preview: ImagePreview | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const unsubscribe = loader === loadImagePreview ? subscribeImagePreview(image, (preview) => { if (!controller.signal.aborted) setState({ key, preview, error: false }); }) : () => {};
    void loader(image, controller.signal, retry > 0).then((preview) => {
      if (!controller.signal.aborted) setState({ key, preview, error: false });
    }).catch(() => { if (!controller.signal.aborted) setState({ key, preview: null, error: true }); });
    if (priority && loader === loadImagePreview) prioritizeImagePreview(image);
    return () => { unsubscribe(); controller.abort(); };
  }, [image.id, image.modifiedAt, image.sizeBytes, loader, retry, key, active, priority]);
  return { preview: state?.key === key ? state.preview : null, error: state?.key === key && state.error, fail: () => setState({ key, preview: null, error: true }) };
}

const ImageTile = memo(function ImageTile({ image, selected, checked, canDelete, id, onChoose, onOpen, onCheck, previewLoader, active }: { image: LibraryImage; selected: boolean; checked: boolean; canDelete: boolean; id: string; onChoose: (id: string) => void; onOpen: (id: string) => void; onCheck: (id: string) => void; previewLoader: PreviewLoader; active: boolean }) {
  const { t } = useI18n();
  const preview = usePreview(image, previewLoader, 0, active);
  const label = /^[0-9a-f]{64}\./i.test(image.name) ? image.usedBy.find(isImageNote)?.title || `${image.name.slice(0, 8)}…${image.name.slice(image.name.lastIndexOf("."))}` : image.name;
  return <div id={id} className="images-tile" role="option" aria-selected={selected} data-checked={checked}>
    <button type="button" tabIndex={-1} className="images-tile-open" aria-label={t("Просмотр: {name}", { name: image.name })} onClick={(event) => { onChoose(image.id); event.currentTarget.closest<HTMLElement>("[role=listbox]")?.focus({ preventScroll: true }); }} onDoubleClick={() => onOpen(image.id)}>
      <div className="images-thumbnail">{preview.preview ? <img src={preview.preview.url} alt="" decoding="async" draggable={false} onError={preview.fail} /> : preview.error ? <ImageOff size={24} strokeWidth={1.3} /> : <span className="images-thumb-placeholder" />}<span className="images-image-type">{imageFormat(image.name).toUpperCase()}</span></div>
      <div className="images-tile-caption"><strong title={image.name}>{label}</strong><div><span>{formatBytes(image.sizeBytes)}</span><span className="images-usage-count" title={t("Связей с заметками: {n}", { n: image.usedBy.length })}><Link2 size={12} aria-hidden="true" />{image.usedBy.length}</span></div></div>
    </button>
    {canDelete && <button type="button" tabIndex={-1} className="images-check" aria-label={t(checked ? "Снять выделение {name}" : "Выделить {name}", { name: image.name })} aria-pressed={checked} onClick={() => onCheck(image.id)}>{checked && <Check size={12} />}</button>}
  </div>;
});

function ImageDetails({ image, previewLoader, onOpen, onUsage, onBack, onReveal, active }: { image: LibraryImage; previewLoader: PreviewLoader; onOpen: (id: string) => void; onUsage: (id: string) => void; onBack: () => void; onReveal: () => void; active: boolean }) {
  const { t, lang } = useI18n();
  const [retry, setRetry] = useState(0);
  const preview = usePreview(image, previewLoader, retry, active, true);
  const usages = useWindowedRows(image.usedBy.length, 56, image.id);
  const date = image.modifiedAt ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(image.modifiedAt) : "—";
  return <>
    <div className="images-detail-toolbar"><button type="button" className="images-back images-text-button" onClick={onBack}><ChevronLeft size={15} />{t("Изображения")}</button><span>{t("Сведения")}</span><button type="button" className="images-icon-button" onClick={() => onOpen(image.id)} aria-label={t("Открыть оригинал")} title={t("Открыть оригинал")}><Expand size={16} /></button></div>
    <div className="images-detail-scroll images-scroll">
      <button type="button" className="images-detail-preview" aria-label={t("Открыть оригинал")} onClick={() => onOpen(image.id)}>{preview.preview ? <img src={preview.preview.url} alt={image.name} decoding="async" onError={preview.fail} /> : <ImageOff size={30} strokeWidth={1.2} />}<span><Expand size={14} />{t("Оригинал")}</span></button>
      {preview.error && <div className="images-preview-error"><span>{t("Превью недоступно")}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>{t("Повторить")}</button></div>}
      <h2>{image.name}</h2>
      <dl className="images-properties"><div><dt>{t("Размер")}</dt><dd>{formatBytes(image.sizeBytes)}</dd></div><div><dt>{t("Формат")}</dt><dd>{imageFormat(image.name).toUpperCase()}</dd></div>{preview.preview && preview.preview.width > 0 && <div><dt>{t("Разрешение")}</dt><dd>{preview.preview.width} × {preview.preview.height}</dd></div>}<div><dt>{t("Изменено")}</dt><dd>{date}</dd></div></dl>
      <div className="images-location"><Folder size={14} aria-hidden="true" /><span title={image.folder}>{image.folder === ".assets" ? t("Загруженные") : image.folder || t("Корень хранилища")}</span><button type="button" onClick={onReveal}>{t("Показать файл")}</button></div>
      <div className="images-note-heading"><h3>{t("Связанные заметки")}</h3><span>{image.usedBy.length}</span></div>
      {image.usedBy.length ? <div ref={usages.ref} onScroll={usages.onScroll} className="images-note-links images-scroll"><div className="images-window" style={{ height: usages.total }}><div className="images-window-slice" style={{ transform: `translateY(${usages.offset}px)` }}>{image.usedBy.slice(usages.start, usages.end).map((usage) => usage.id === "__trash__" || isImageNote(usage) ? <button type="button" key={usage.id} onClick={() => onUsage(usage.id)}><Link2 size={14} /><div><strong>{usage.id === "__trash__" ? t("В корзине") : usage.title}</strong><span>{usage.folder || (usage.id === "__trash__" ? t("Корзина") : t("Корень хранилища"))}</span></div><ChevronRight size={13} /></button> : <div key={usage.id} className="images-protected-usage"><Link2 size={14} /><span>{usage.id === "__versions__" ? t("История версий") : usage.title}</span></div>)}</div></div></div> : <p className="images-no-links">{t("В заметках не найдено ссылок на этот файл.")}</p>}
    </div>
  </>;
}
