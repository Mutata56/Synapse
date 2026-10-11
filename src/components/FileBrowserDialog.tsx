import { ChevronRight, Folder, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildBreadcrumbs } from "../lib/treeUtils";
import { closestFileFolder, movableFileTargets, targetPath, type FileEntry, type FileIndex, type FileTarget } from "../lib/fileBrowser";
import { useI18n } from "./LanguageProvider";
import { useWindowedRows } from "./useWindowedRows";

export type FileDialogMode = "createNote" | "createFolder" | "rename" | "move" | "navigate";
type Props = { mode: FileDialogMode; index: FileIndex; folder: string; entry?: FileEntry; targets: FileTarget[]; busy: boolean; onClose: () => void; onSubmit: (value: string) => Promise<void> };

export function FileBrowserDialog({ mode, index, folder, entry, targets, busy, onClose, onSubmit }: Props) {
  const { t, lang } = useI18n();
  const picker = mode === "move" || mode === "navigate";
  const [value, setValue] = useState(mode === "rename" ? entry?.name ?? "" : "");
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(closestFileFolder(index, folder));
  const [destination, setDestination] = useState(closestFileFolder(index, folder));
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDivElement>(null), submitting = useRef(false);
  const movedFolders = useMemo(() => targets.filter(item => item.kind === "folder").map(targetPath), [targets]);
  const unavailable = (path: string) => mode === "move" && movedFolders.some(source => path === source || path.startsWith(`${source}/`));
  const rows = useMemo(() => {
    const source = query.trim() ? [...index.folders.values()].filter(item => item.search.includes(query.trim().toLocaleLowerCase()))
      : (index.children.get(browsing) ?? []).filter(item => item.kind === "folder");
    const collator = new Intl.Collator(lang, { numeric: true, sensitivity: "base" });
    return [...source].sort((a, b) => collator.compare(a.name, b.name));
  }, [index, browsing, query, lang]);
  const windowed = useWindowedRows(rows.length, 48, `${browsing}:${query}`);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus(); if (!picker) input.current?.select();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [picker]);
  const titles = { createNote: t("Новая заметка"), createFolder: t("Новая папка"), rename: t("Переименовать"), move: t("Переместить в папку"), navigate: t("Перейти в папку") };
  const clean = value.trim();
  const folderName = mode === "createFolder" || (mode === "rename" && entry?.kind === "folder");
  const invalidName = folderName && (clean.startsWith(".") || /[\\/]/.test(clean));
  const validDestination = destination === "" || index.folders.has(destination);
  const canSubmit = picker ? validDestination && !unavailable(destination) && (mode !== "move" || movableFileTargets(targets, destination).length > 0) : !!clean && !invalidName;
  const browse = (path: string) => { setBrowsing(path); setDestination(path); setQuery(""); };
  return createPortal(<div className="fs-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="fs-dialog" role="dialog" aria-modal="true" aria-labelledby="fs-dialog-title" ref={dialog} onKeyDown={event => {
      if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]') ?? []).filter(element => element.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header><h2 id="fs-dialog-title">{titles[mode]}</h2><button type="button" className="fs-icon-button" aria-label={t("Закрыть")} onClick={onClose} disabled={busy}><X size={18} /></button></header>
      <form onSubmit={async event => {
        event.preventDefault(); if (!canSubmit || busy || submitting.current) return;
        submitting.current = true;
        try { await onSubmit(picker ? destination : clean); } finally { submitting.current = false; }
      }}>
        {picker ? <>
          <div className="fs-search"><Search size={16} /><input ref={input} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder={t("Поиск папки…")} aria-label={t("Поиск папки")} /></div>
          <nav className="fs-picker-route" aria-label={t("Папка назначения")}><button type="button" onClick={() => browse("")} disabled={busy}>{t("Хранилище")}</button>{buildBreadcrumbs(browsing).map(crumb => <span key={crumb.path}><ChevronRight size={13} /><button type="button" disabled={busy} onClick={() => browse(crumb.path)}>{crumb.name}</button></span>)}</nav>
          <button type="button" className={`fs-picker-current${destination === browsing ? " is-selected" : ""}`} disabled={busy || unavailable(browsing)} onClick={() => setDestination(browsing)}><Folder size={17} /><span>{browsing ? t("Эта папка") : t("Корень хранилища")}</span></button>
          <div className="fs-picker-list fs-scroll" ref={windowed.ref} onScroll={windowed.onScroll}>
            {rows.length ? <div style={{ height: rows.length * 48, position: "relative" }}>{rows.slice(windowed.start, windowed.end).map((row, offset) => <button type="button" key={row.key} className={`fs-picker-row${destination === row.path ? " is-selected" : ""}`} disabled={busy || unavailable(row.path)} style={{ position: "absolute", top: (windowed.start + offset) * 48, height: 48, width: "100%" }} onClick={() => setDestination(row.path)} onDoubleClick={() => browse(row.path)}><Folder size={17} /><span><strong>{row.name}</strong><small>{query ? row.parent || t("Хранилище") : t("{n} заметок", { n: row.notes })}</small></span><ChevronRight size={14} /></button>)}</div> : <div className="fs-empty-small">{query ? t("Папки не найдены") : t("Вложенных папок нет")}</div>}
          </div>
          <p className="fs-destination"><span>{mode === "move" ? t("Переместить в:") : t("Открыть:")}</span> <strong>{destination || t("Хранилище")}</strong></p>
          {mode === "move" && validDestination && !unavailable(destination) && !canSubmit && <p className="fs-dialog-hint">{t("Выбранные элементы уже находятся в этой папке")}</p>}
        </> : <label className="fs-name-field"><span>{folderName ? t("Название папки") : t("Название заметки")}</span><input ref={input} autoComplete="off" value={value} disabled={busy} onChange={event => setValue(event.target.value)} aria-invalid={invalidName || undefined} maxLength={240} />{invalidName && <small role="alert">{t("Название не должно начинаться с точки или содержать слеши")}</small>}<small>{folder || t("Хранилище")}</small></label>}
        <footer><button type="button" className="fs-button" onClick={onClose} disabled={busy}>{t("Отмена")}</button><button type="submit" className="fs-button fs-primary" disabled={!canSubmit || busy}>{busy ? t("Обработка…") : mode === "move" ? t("Переместить") : mode === "navigate" ? t("Открыть") : mode === "rename" ? t("Сохранить") : t("Создать")}</button></footer>
      </form>
    </div>
  </div>, document.body);
}
