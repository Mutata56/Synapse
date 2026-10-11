import { ChevronLeft, ChevronRight, ExternalLink, FileText, Folder, X } from "lucide-react";
import { lazy, Suspense, useCallback, useId, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { fileRows, type FileEntry, type FileIndex } from "../lib/fileBrowser";
import { useI18n } from "./LanguageProvider";
import "./fileQuickLook.css";

const QuickPreview = lazy(() => import("./FileQuickPreview"));
const CHILD_LIMIT = 40;
type Props = {
  mode: "files" | "trash";
  entry: FileEntry;
  index: FileIndex;
  read: (id: string) => Promise<string>;
  position: number;
  total: number;
  onStep: (delta: number) => void;
  onClose: () => void;
  onReturnFocus: () => void;
  onOpen: (entry: FileEntry) => void;
};

/** Native modal focus/inert behavior, with Markdown loaded only for an explicit note preview. */
export function FileQuickLook({ mode, entry, index, read, position, total, onStep, onClose, onReturnFocus, onOpen }: Props) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const readPreview = useCallback((id: string) => read(id.slice(id.indexOf(":") + 1)), [read]);
  const children = useMemo(() => entry.kind === "folder"
    ? fileRows(index, entry.path, "", false, "all", "name", false, lang) : [], [entry.kind, entry.path, index, lang]);
  const path = `${mode === "trash" ? ".trash/" : ""}${entry.path}${entry.kind === "note" ? ".md" : "/"}`;

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      element.close();
      onReturnFocus();
    };
  }, [onReturnFocus]);
  useLayoutEffect(() => { if (reader.current) reader.current.scrollTop = 0; }, [entry.key]);

  return createPortal(<dialog ref={dialog} className="fs-quicklook" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    onKeyDown={event => {
      // Preview keys must not reach workspace shortcuts or destructive list commands.
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Tab") {
        const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]'))
          .filter(element => element.getClientRects().length > 0);
        const current = targets.indexOf(document.activeElement as HTMLElement);
        if (targets.length) {
          event.preventDefault();
          const next = current < 0 ? (event.shiftKey ? targets.length - 1 : 0)
            : (current + (event.shiftKey ? targets.length - 1 : 1)) % targets.length;
          targets[next].focus({ preventScroll: true });
        }
        return;
      }
      if ((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.key === " " && !(event.target as HTMLElement).closest("button,a")) {
        event.preventDefault(); if (!event.repeat) onClose();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); if (!event.repeat) onStep(event.key === "ArrowLeft" ? -1 : 1);
      }
    }}>
    <header className="fs-quicklook-toolbar">
      <button type="button" className="fs-quicklook-close" aria-label={t("Закрыть предпросмотр")} title={t("Закрыть предпросмотр")} onClick={onClose}><X size={16} /></button>
      <div className="fs-quicklook-title">
        <h2 id={titleId}>{entry.kind === "folder" ? <Folder size={16} /> : <FileText size={16} />}<span title={entry.name}>{entry.name}</span></h2>
        <p title={path}>{path}</p>
      </div>
      <div className="fs-quicklook-open">{mode === "files" && <button type="button" className="fs-button" title={entry.kind === "folder" ? t("Открыть папку") : t("Открыть заметку")} onClick={() => { onClose(); onOpen(entry); }}><ExternalLink size={14} /><span>{t("Открыть")}</span></button>}</div>
    </header>
    <div ref={reader} className="fs-quicklook-reader fs-scroll" tabIndex={0} role="region" aria-label={entry.kind === "folder" ? t("Предпросмотр папки") : t("Предпросмотр заметки")}>
      {entry.kind === "note" ? <Suspense fallback={<p className="fs-quicklook-status" role="status">{t("Загрузка…")}</p>}>
        <QuickPreview key={`${mode}:${entry.key}:${entry.modified}`} id={`${mode}:${entry.path}`} revision={entry.modified} read={readPreview} />
      </Suspense> : <div className="fs-quicklook-folder">
        <div className="fs-quicklook-folder-summary"><Folder size={72} strokeWidth={1.2} /><div><h3>{entry.name}</h3><dl><div><dt>{t("Заметки")}</dt><dd>{entry.notes}</dd></div><div><dt>{t("Папки")}</dt><dd>{entry.folders}</dd></div></dl></div></div>
        <h3 className="fs-quicklook-contents-title">{t("Содержимое папки")}</h3>
        {children.length ? <><ul className="fs-quicklook-children">{children.slice(0, CHILD_LIMIT).map(child => <li key={child.key}>
          {child.kind === "folder" ? <Folder size={18} /> : <FileText size={18} />}<span title={child.name}>{child.name}</span><small>{child.kind === "folder" ? t("Папка") : t("Заметка")}</small>
        </li>)}</ul>{children.length > CHILD_LIMIT && <p className="fs-quicklook-status">{t("Показано {n} из {total}", { n: CHILD_LIMIT, total: children.length })}</p>}</> : <p className="fs-quicklook-status">{t("В папке пока нет элементов")}</p>}
      </div>}
    </div>
    <footer className="fs-quicklook-footer">
      <span className="fs-quicklook-hint"><kbd>Space</kbd><span>/</span><kbd>Esc</kbd><span>{t("Закрыть")}</span></span>
      <nav aria-label={t("Быстрый просмотр")}>
        <button type="button" className="fs-icon-button" disabled={position <= 0} aria-label={t("Предыдущий элемент")} title={t("Предыдущий элемент")} onClick={() => onStep(-1)}><ChevronLeft size={18} /></button>
        <span className="fs-quicklook-position" aria-live="polite">{t("{current} из {total}", { current: position + 1, total })}</span>
        <button type="button" className="fs-icon-button" disabled={position >= total - 1} aria-label={t("Следующий элемент")} title={t("Следующий элемент")} onClick={() => onStep(1)}><ChevronRight size={18} /></button>
      </nav>
    </footer>
  </dialog>, document.body);
}
