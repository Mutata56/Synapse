import { Link2, Unlink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_NOTE_TITLE } from "../lib/format";
import { buildSearchDocs } from "../lib/fullTextSearch";
import { t } from "../lib/i18n";
import type { NoteMeta } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";

const SNIPPET_CTX = 40;
const MIN_TITLE_LEN = 3; // заголовки короче ловят слишком много мусора

type Mention = { note: NoteMeta; snippet: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeSnippet(body: string, idx: number, len: number): string {
  const start = Math.max(0, idx - SNIPPET_CTX);
  const end = Math.min(body.length, idx + len + SNIPPET_CTX);
  const s = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + s + (end < body.length ? "…" : "");
}

/**
 * "Возможные связи": заметки, где заголовок открытой заметки упомянут просто
 * текстом, без ссылки `[[ ]]`. Любую можно связать в один клик (оборачиваем
 * упоминание). Тела берём из полнотекстового кеша (`buildSearchDocs`), так что
 * почти всё попадает в кеш; заметки, которые уже ссылаются на заголовок,
 * выкидываем.
 */
export function UnlinkedMentions({ compact = false }: { compact?: boolean }) {
  const activeNote = useNotesStore((s) => s.activeNote);
  const selectNote = useNotesStore((s) => s.selectNote);
  const linkMention = useNotesStore((s) => s.linkMention);
  const tree = useNotesStore((s) => s.tree);
  // Стабильная сигнатура содержимого дерева (id+updatedAt на заметку). По ней
  // скан обновляется, когда создали/правили/переименовали/связали ДРУГУЮ
  // заметку. Считаем в useMemo (не внутри Zustand-селектора!), потому что
  // селекторы гоняются на КАЖДЫЙ set() стора, а при печати это и автосейв раз
  // в 400мс, и каждое нажатие через дебаунс редактора. На сотнях заметок обход
  // дерева плюс склейка прямо в селекторе это O(N) на каждую мутацию по всему
  // приложению. Теперь селектор отдаёт ссылку на дерево (дешёвая проверка по
  // идентичности), а тяжёлый обход случается только при ре-рендере компонента.
  const treeSig = useMemo(() => {
    const flat = flattenNotes(tree);
    let out = "";
    for (const n of flat) out += `${n.id}:${n.updatedAt}|`;
    return out;
  }, [tree]);
  const [mentions, setMentions] = useState<Mention[]>([]);

  const activeId = activeNote?.id ?? null;
  const title = activeNote?.title.trim() ?? "";

  // Пере-сканируем при смене заметки, смене заголовка или любой мутации
  // дерева, которая бампает updatedAt любой заметки (это и есть случай правки
  // в соседней заметке выше).
  useEffect(() => {
    if (!activeId || title.length < MIN_TITLE_LEN) {
      setMentions([]);
      return;
    }
    let cancelled = false;
    const tLower = title.toLowerCase();
    const wb = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegex(title)}(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    void buildSearchDocs(flattenNotes(useNotesStore.getState().tree))
      .then((docs) => {
        if (cancelled) return;
        const out: Mention[] = [];
        for (const d of docs) {
          if (d.note.id === activeId) continue;
          if (d.note.links.includes(tLower)) continue; // уже связана
          if (!d.bodyLower.includes(tLower)) continue; // дешёвый отсев
          const m = wb.exec(d.body);
          if (!m) continue; // совпала подстрока, но не целое слово
          out.push({
            note: d.note,
            snippet: makeSnippet(d.body, m.index, m[0].length),
          });
        }
        out.sort((a, b) => b.note.updatedAt - a.note.updatedAt);
        setMentions(out);
      })
      .catch((e) => {
        if (!cancelled) console.error("UnlinkedMentions: scan failed:", e);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, title, treeSig]);

  if (!activeNote || mentions.length === 0) return null;

  const onLink = (id: string) => {
    void linkMention(id, title);
    // Оптимистично: теперь она ссылается на заголовок, значит уже не висит как
    // возможная связь.
    setMentions((m) => m.filter((x) => x.note.id !== id));
  };

  return (
    <div
      className={
        compact ? "w-full mt-6" : "max-w-3xl mx-auto w-full px-5 sm:px-12 pb-10"
      }
    >
      <div className={compact ? "" : "border-t border-[var(--color-border)] pt-6"}>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3 flex items-center gap-1.5">
          <Unlink size={12} strokeWidth={2} />
          {t("Возможные связи")} · {mentions.length}
        </h3>
        <div className="flex flex-col gap-1.5">
          {mentions.map(({ note, snippet }) => (
            <div
              key={note.id}
              className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] transition-colors"
            >
              <button
                type="button"
                onClick={() => void selectNote(note.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="text-[13px] text-zinc-200 truncate">
                  {note.title || DEFAULT_NOTE_TITLE}
                </div>
                <div className="text-[11px] text-zinc-500 truncate">
                  {snippet}
                </div>
              </button>
              <button
                type="button"
                onClick={() => onLink(note.id)}
                title={t("Связать , обернуть упоминание в [[ ]]")}
                className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent)] hover:text-indigo-300 px-2 py-1 rounded hover:bg-[var(--color-accent-bg)] transition-colors"
              >
                <Link2 size={12} strokeWidth={2} />
                {t("Связать")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
