import { Copy, ExternalLink, FileText, Folder, Hash, PanelRightClose, RotateCcw, Trash2, Eye } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { pluralRu } from "../lib/format";
import type { FileEntry, FileIndex } from "../lib/fileBrowser";
import { useI18n } from "./LanguageProvider";

const QuickPreview = lazy(() => import("./FileQuickPreview"));
type Props = { mode: "files" | "trash"; items: FileEntry[]; index: FileIndex; folder: string; busy: boolean; onClose: () => void; onOpen: (entry: FileEntry) => void; onMove: () => void; onTrash: () => void; onRestore: () => void; onDelete: () => void; onCopy: () => void; read: (id: string) => Promise<string>; previewKey: string };

export function FileProperties({ mode, items, index, folder, busy, onClose, onOpen, onMove, onTrash, onRestore, onDelete, onCopy, read, previewKey }: Props) {
  const { t, lang } = useI18n();
  const [peek, setPeek] = useState(false);
  const rootName = mode === "files" ? t("Хранилище") : t("Корзина");
  const single = items.length === 1 ? items[0] : undefined;
  useEffect(() => setPeek(false), [single?.key]);
  useEffect(() => { setPeek(!!single && previewKey === single.key); }, [previewKey, single?.key]);
  const readPreview = useCallback((id: string) => read(id.slice(id.indexOf(":") + 1)), [read]);
  const data = useMemo(() => {
    const parents = new Set(items.map(item => item.parent));
    const notes = items.filter(item => item.kind === "note").length;
    const modified = items.reduce((latest, item) => Math.max(latest, item.modified), 0);
    const tags = items.length <= 20 ? [...new Set(items.flatMap(item => item.note?.tags ?? []))] : [];
    return { parent: parents.size === 1 ? items[0].parent : null, notes, modified, tags };
  }, [items]);
  const title = single?.name ?? (items.length ? `${items.length} ${lang === "ru" ? pluralRu(items.length, t("объект"), t("объекта"), t("объектов")) : t(items.length === 1 ? "объект" : "объектов")}` : folder.split("/").pop() || rootName);
  const path = items.length ? data.parent : folder;
  const date = data.modified > 0 ? new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short" }).format(data.modified) : "—";
  const folderStats = single?.kind === "folder" ? single : !items.length ? index.folders.get(folder) : undefined;
  return <aside className="fs-properties fs-scroll" aria-label={t("Свойства выбранных элементов")}>
    <header><h2 title={title}>{title}</h2><button type="button" className="fs-icon-button" aria-label={t("Свернуть свойства")} onClick={onClose}><PanelRightClose size={16} /></button></header>
    <div className="fs-properties-icons">{items.length ? items.slice(0, 4).map(item => item.kind === "note" ? <FileText key={item.key} size={28} /> : <Folder key={item.key} size={28} />) : <Folder size={30} />}</div>
    <p className="fs-properties-description">{items.length ? data.notes === items.length ? t("Выбраны заметки") : data.notes === 0 ? t("Выбраны папки") : t("Выбраны папки и заметки") : mode === "files" ? t("Локальное хранилище") : t("Удалённые заметки и папки")}</p>
    <section><h3>{t("Расположение")}</h3><div className="fs-properties-location"><Folder size={20} /><span>{path === null ? t("Разные папки") : path ? path.replace(/\//g, " / ") : rootName}</span>{items.length > 0 && <button type="button" className="fs-icon-button" title={t("Копировать путь")} aria-label={t("Копировать путь")} onClick={onCopy}><Copy size={13} /></button>}</div>
      {items.length > 0 && <div className="fs-properties-actions">{mode === "files" ? <><button type="button" className="fs-button fs-primary" disabled={busy} onClick={onMove}><Folder size={16} />{t("Переместить…")}</button><button type="button" className="fs-button fs-danger" disabled={busy} onClick={onTrash}><Trash2 size={16} />{t("В корзину")}</button></> : <><button type="button" className="fs-button fs-primary" disabled={busy} onClick={onRestore}><RotateCcw size={16} />{t("Восстановить")}</button><button type="button" className="fs-button fs-danger" disabled={busy} onClick={onDelete}><Trash2 size={16} />{t("Удалить навсегда")}</button></>}</div>}
    </section>
    <section><h3>{t("Информация")}</h3><dl><div><dt>{t("Тип")}</dt><dd>{single?.kind === "folder" || !items.length ? t("Папка") : data.notes === items.length ? t("Заметки") : data.notes === 0 ? t("Папки") : t("Разные типы")}</dd></div>
      {folderStats || !items.length ? <><div><dt>{t("Заметки")}</dt><dd>{folderStats?.notes ?? index.notes}</dd></div><div><dt>{t("Папки")}</dt><dd>{folderStats?.folders ?? index.folderCount}</dd></div></> : <div><dt>{t("Элементы")}</dt><dd>{items.length}</dd></div>}
      <div><dt>{t("Изменено")}</dt><dd>{date}</dd></div></dl>
      {single && mode === "files" && <button type="button" className="fs-text-button" disabled={busy} onClick={() => onOpen(single)}><ExternalLink size={13} />{single.kind === "folder" ? t("Открыть папку") : t("Открыть заметку")}</button>}
    </section>
    {data.tags.length > 0 && <section><h3>{t("Теги")} ({data.tags.length})</h3><div className="fs-properties-tags">{data.tags.slice(0, 8).map(tag => <span className="fs-tag" key={tag}><Hash size={12} />{tag.replace(/^#/, "")}</span>)}{data.tags.length > 8 && <span>+{data.tags.length - 8}</span>}</div></section>}
    {single?.kind === "note" && <section><button type="button" className="fs-text-button" aria-expanded={peek} onClick={() => setPeek(value => !value)}><Eye size={14} />{peek ? t("Скрыть просмотр") : t("Быстрый просмотр")}</button>{peek && <Suspense fallback={<p role="status">{t("Загрузка…")}</p>}><QuickPreview id={`${mode}:${single.path}`} revision={single.modified} read={readPreview} /></Suspense>}</section>}
  </aside>;
}
