import { useIconizeStore } from "../store/iconize";
import { InlineIcon, VaultLinkIcon, remarkIconize } from "./IconizeMarkdown";
import { ExternalLink, Ellipsis, FileText, Hash, Image, Plus, RefreshCw, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { obsidianMarkdownPreview, resolveVaultReference, wikiTarget, type VaultFileIndex } from "../lib/obsidianImport";
import type { Note, NoteMeta } from "../lib/storage";
import { normalizeTag } from "../lib/tagExplorer";
import { useToastStore } from "../store/toasts";
import { useI18n } from "./LanguageProvider";

const PREVIEW_LIMIT = 24000;
type Body = { id: string; text: string; truncated: boolean; words: number };
type Props = { note: NoteMeta; selectedTags: readonly string[]; files: VaultFileIndex; loadNote: (id: string) => Promise<Note | null>; onOpen: (id: string) => void; onTrash: (id: string) => void; onTag: (tag: string) => void; onAddFilter: () => void };

/** Only the selected note is read. Five bounded previews, no covers or remote images. */
export default function TagReadingPane({ note, selectedTags, files, loadNote, onOpen, onTrash, onTag, onAddFilter }: Props) {
  const { t, lang } = useI18n();
  const [body, setBody] = useState<Body | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, Body>());
  const contentRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const id = note.id;
  const tags = useMemo(() => [...new Set(note.tags.map(normalizeTag).filter(Boolean))], [note.tags]);
  const orderedTags = useMemo(() => [...tags].sort((a, b) => Number(selectedTags.includes(b)) - Number(selectedTags.includes(a))), [tags, selectedTags]);
  useEffect(() => {
    let cancelled = false;
    const key = `${id}:${note.updatedAt}`;
    setError(false); contentRef.current?.scrollTo(0, 0);
    const cached = cache.current.get(key);
    if (cached) { setBody(cached); return; }
    setBody(null);
    void loadNote(id).then((loaded) => {
      if (!loaded) throw new Error("Note unavailable");
      const text = loaded.content;
      const preview = { id, text: text.slice(0, PREVIEW_LIMIT), truncated: text.length > PREVIEW_LIMIT, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
      cache.current.delete(key); cache.current.set(key, preview);
      while (cache.current.size > 5) cache.current.delete(cache.current.keys().next().value!);
      if (!cancelled) setBody(preview);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [id, note.updatedAt, retry, loadNote]);
  const visibleBody = body?.id === id ? body : null;
  const markdown = useMemo(() => obsidianMarkdownPreview(visibleBody?.text ?? ""), [visibleBody]);
  const iconSettings = useIconizeStore(state => state.data.settings);
  const iconPlugins = useMemo(() => [remarkGfm, [remarkIconize, { identifier: iconSettings.iconIdentifier, enabled: iconSettings.iconsInNotesEnabled }]] as import("unified").PluggableList, [iconSettings.iconIdentifier, iconSettings.iconsInNotesEnabled]);
  const components = useMemo(() => ({
    img: ({ alt }: { alt?: string }) => <button type="button" className="tags-attachment" onClick={() => onOpen(id)}><Image size={15} aria-hidden="true" />{alt || t("Вложение")}<span>{t("Открыть в заметке")}</span></button>,
    a: ({ href = "", children }: { href?: string; children?: React.ReactNode }) => href.startsWith("synapse-icon:") ? <InlineIcon id={href.slice("synapse-icon:".length)}>{children}</InlineIcon> : <a href={href || undefined} onClick={(event) => {
      event.preventDefault();
      if (href.startsWith("#")) {
        const heading = decodeURIComponent(href.slice(1)).replace(/-/g, " ").toLocaleLowerCase();
        Array.from(contentRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? []).find((element) => element.textContent?.toLocaleLowerCase() === heading)?.scrollIntoView({ block: "start" });
        return;
      }
      if (/^(?:https?:|mailto:)/i.test(href)) { void openUrl(href).catch(() => useToastStore.getState().push(t("Не удалось открыть ссылку"))); return; }
      const wiki = href.startsWith("synapse-note:");
      const reference = wiki ? decodeURIComponent(href.slice("synapse-note:".length)) : href;
      const target = wikiTarget(reference);
      const path = resolveVaultReference(target.path, id, files, { note: true, relativeFirst: !wiki });
      if (path) onOpen(path.slice(0, -3));
      else useToastStore.getState().push(t("Ссылка не найдена или неоднозначна"));
    }}><VaultLinkIcon href={href} noteId={id} files={files} />{children}</a>,
  }), [files, id, onOpen, t]);
  const renderedMarkdown = useMemo(() => <ReactMarkdown remarkPlugins={iconPlugins} components={components} urlTransform={(url) => /^synapse-(?:note|embed|icon):/.test(url) ? url : defaultUrlTransform(url)}>{markdown || t("Заметка пока пустая")}</ReactMarkdown>, [markdown, components, iconPlugins, t]);
  const date = useMemo(() => new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(note.updatedAt), [lang, note.updatedAt]);

  return <>
    <div className="tags-reader-toolbar"><span className="tags-reader-folder" title={note.folder || "/"}>{note.folder || "/"}</span><button type="button" className="tags-open-note" aria-label={t("Открыть заметку")} onClick={() => onOpen(id)}>{t("Открыть")}<ExternalLink size={13} aria-hidden="true" /></button><details ref={menuRef} className="tags-note-menu" onKeyDown={(event) => { if (event.key === "Escape" && menuRef.current) { menuRef.current.open = false; menuRef.current.querySelector("summary")?.focus(); } }}><summary aria-label={t("Действия с заметкой")}><Ellipsis size={17} /></summary><div><button type="button" onClick={() => { if (menuRef.current) menuRef.current.open = false; onTrash(id); }}><Trash2 size={15} />{t("В корзину")}</button></div></details></div>
    <div className="tags-reader-scroll tags-scroll" ref={contentRef}>
      <header className="tags-note-header"><h2>{note.title}</h2><div className="tags-note-tags">{orderedTags.map((tag) => <button type="button" key={tag} className="tags-inline-tag" onClick={() => onTag(tag)} title={t("Добавить или убрать фильтр {tag}", { tag })}><Hash size={12} />{tag}</button>)}</div><div className="tags-note-meta"><span>{t("Изменено {date}", { date })}</span>{visibleBody && <span>{t("{n} слов", { n: visibleBody.words })}</span>}<span className="tags-readonly"><FileText size={12} />{t("Только чтение")}</span></div></header>
      {error ? <div className="tags-empty" role="alert"><h3>{t("Не удалось прочитать заметку")}</h3><p>{t("Файл мог измениться или стать недоступным.")}</p><button type="button" className="tags-button" onClick={() => { cache.current.delete(`${id}:${note.updatedAt}`); setRetry((value) => value + 1); }}><RefreshCw size={14} />{t("Повторить")}</button></div> : !visibleBody ? <div className="tags-preview-loading" role="status">{t("Загрузка…")}</div> : <><div className="tags-markdown">{renderedMarkdown}</div>{visibleBody.truncated && <div className="tags-preview-limit"><p>{t("Показано начало длинной заметки")}</p><button type="button" className="tags-button" onClick={() => onOpen(id)}>{t("Открыть целиком")}</button></div>}</>}
    </div>
    <footer className="tags-reader-footer"><span>{t("Теги")}</span><div>{orderedTags.slice(0, 3).map((tag) => <button type="button" className="tags-inline-tag" key={tag} onClick={() => onTag(tag)}><Hash size={12} />{tag}</button>)}<button type="button" className="tags-add-filter" onClick={onAddFilter}><Plus size={13} />{t("Добавить фильтр")}</button></div></footer>
  </>;
}
