import { NoteIcon } from "./NoteIcon";
import { Check, Eye, FileText, Star } from "lucide-react";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { gradientClassName, parseCover } from "../lib/covers";
import { formatRelativeDate } from "../lib/format";
import { resolveCoverImageUrl, type NoteMeta } from "../lib/storage";
import { useI18n } from "./LanguageProvider";
import { noteClickAction } from "../lib/noteClick";
import { libraryExcerpt } from "../lib/noteLibrary";
type Props = {
    note: NoteMeta;
    selected: boolean;
    selecting: boolean;
    previewing: boolean;
    onOpen: (id: string, newTab?: boolean) => void;
    onPreview: (id: string, trigger: HTMLButtonElement) => void;
    onSelect: (id: string) => void;
    onFavorite: (id: string) => void;
    onTag: (tag: string) => void;
    onNavigate: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void;
};
export const LibraryNoteCard = memo(function LibraryNoteCard({ note, selected, selecting, previewing, onOpen, onPreview, onSelect, onFavorite, onTag, onNavigate }: Props) {
    const { t } = useI18n();
    const title = note.title || t("Без названия"), folder = note.folder || t("Без папки");
    const click = (event: MouseEvent<HTMLButtonElement>) => {
        const action = noteClickAction(event, selecting);
        if (action === "select")
            onSelect(note.id);
        else {
            if (action === "new-tab") event.preventDefault();
            onOpen(note.id, action === "new-tab");
        }
    };
    const tags = [...new Set(note.tags)].slice(0, 2);
    const excerpt = libraryExcerpt(note), date = new Date(note.updatedAt);
    const iso = Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    return <article data-note-id={note.id} className={`library-card${selected ? " is-selected" : ""}${previewing ? " is-previewing" : ""}`}>
    <button type="button" className="library-card-check" aria-label={t(selected ? "Снять выделение" : "Выделить")} aria-pressed={selected} onClick={() => onSelect(note.id)}>{selected && <Check size={13}/>}</button>
    <button type="button" className={`library-card-star${note.favorite ? " is-favorite" : ""}`} aria-label={t(note.favorite ? "Убрать из избранного" : "В избранное")} aria-pressed={note.favorite} onClick={() => onFavorite(note.id)}><Star size={15} fill={note.favorite ? "currentColor" : "none"}/></button>
    <button type="button" className="library-card-open" aria-label={`${t("Открыть заметку")}: ${title}`} onClick={click} onKeyDown={event => onNavigate(note.id, event)}>
      <LibraryCover cover={note.cover}/>
      <div className="library-card-content">
        <div className="library-card-meta"><span><NoteIcon note={note} size={15} fallback={<FileText size={15}/>} /></span><time dateTime={iso}>{iso ? formatRelativeDate(note.updatedAt) : t("Без даты")}</time></div>
        <h3>{title}</h3><p className="library-card-excerpt">{excerpt || t("Заметка пока пустая")}</p>
        <span className="library-card-folder" title={folder}>{folder}</span>
      </div>
    </button>
    <footer className="library-card-footer"><div>{tags.map(tag => <button type="button" className="library-tag" key={tag} onClick={() => onTag(tag)} title={tag}>#{tag.replace(/^#+/, "")}</button>)}{note.tags.length > 2 && <span className="library-tag-more">+{note.tags.length - 2}</span>}</div><button type="button" className="library-card-peek" onClick={event => onPreview(note.id, event.currentTarget)} aria-label={`${t("Быстрый просмотр")}: ${title}`} title={t("Быстрый просмотр")}><Eye size={15}/></button></footer>
  </article>;
});
/** Resolve and request cover images only when this mounted cover is actually visible. */
function LibraryCover({ cover }: {
    cover: string | null;
}) {
    const parsed = parseCover(cover), ref = useRef<HTMLDivElement>(null);
    const [source, setSource] = useState<string | null>(null), [failed, setFailed] = useState(false);
    useEffect(() => {
        setSource(null);
        setFailed(false);
        const element = ref.current;
        if (!element || parsed.kind === "none" || parsed.kind === "gradient")
            return;
        let cancelled = false;
        const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting))
                return;
            observer.disconnect();
            if (parsed.kind === "url") {
                if (!cancelled)
                    setSource(parsed.value);
            }
            else
                void resolveCoverImageUrl(cover).then(url => { if (!cancelled) {
                    setSource(url);
                    if (!url)
                        setFailed(true);
                } }).catch(() => { if (!cancelled)
                    setFailed(true); });
        });
        observer.observe(element);
        return () => { cancelled = true; observer.disconnect(); };
    }, [cover, parsed.kind]);
    if (parsed.kind === "none" || failed)
        return null;
    return <div ref={ref} className={`library-card-cover${parsed.kind === "gradient" ? ` ${gradientClassName(parsed.value)}` : ""}`}>{source && <img src={source} alt="" decoding="async" loading="lazy" onError={() => setFailed(true)}/>}</div>;
}
