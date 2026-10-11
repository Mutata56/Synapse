import { Image, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { obsidianMarkdownPreview } from "../lib/obsidianImport";
import { useI18n } from "./LanguageProvider";

const LIMIT = 18000;
const cache = new Map<string, string>();
const plugins = [remarkGfm];
const components = { img: ({ alt }: { alt?: string }) => <span className="fs-preview-attachment"><Image size={14} />{alt || "Вложение"}</span>, a: ({ children }: { children?: React.ReactNode }) => <span className="fs-preview-link">{children}</span> };

/** Explicit quick look only; never mounts an editor or fetches remote media. */
export default function FileQuickPreview({ id, revision, read }: { id: string; revision: number; read: (id: string) => Promise<string> }) {
  const { t } = useI18n();
  const [body, setBody] = useState<string | null>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const key = `${id}:${revision}`;
    setError(false); setBody(cache.get(key) ?? null);
    if (cache.has(key)) return;
    void read(id).then(value => {
      cache.delete(key); cache.set(key, value.slice(0, LIMIT + 1));
      while (cache.size > 5) cache.delete(cache.keys().next().value!);
      if (!cancelled) setBody(cache.get(key)!);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [id, revision, read, retry]);
  const markdown = useMemo(() => body === null ? "" : obsidianMarkdownPreview(body.slice(0, LIMIT)), [body]);
  if (error) return <div className="fs-preview-error" role="alert"><p>{t("Не удалось прочитать заметку")}</p><button type="button" className="fs-button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />{t("Повторить")}</button></div>;
  if (body === null) return <p role="status">{t("Загрузка…")}</p>;
  return <><div className="fs-markdown"><ReactMarkdown remarkPlugins={plugins} components={components}>{markdown || t("Заметка пока пустая")}</ReactMarkdown></div>{body.length > LIMIT && <p className="fs-preview-limit">{t("Показано начало длинной заметки")}</p>}</>;
}
