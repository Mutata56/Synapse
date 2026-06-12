import { FileText, Link2 } from "lucide-react";
import { useMemo } from "react";
import { computeBacklinks } from "../editor2026/backlinks";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { t } from "../lib/i18n";
import { useNotesStore } from "../store/notes";

/**
 * "Связанные упоминания" для открытой заметки: все другие заметки, в теле
 * которых есть `[[title]]`, указывающий на эту. Резолвим по заголовку (как в
 * модели вики-ссылок), а `NoteMeta.links` уже очищен от блоков кода, так что
 * это дешёвый синхронный фильтр по закешированному дереву, без чтения с диска.
 * Если упоминаний нет, панель прячется. Рисуется под контентом редактора, как
 * в Obsidian.
 *
 * Сам расчёт вынесен в editor2026/backlinks.ts (`computeBacklinks`), чтобы
 * алгоритм жил в одном месте: его дёргает и эта панель, и (когда-нибудь) любой
 * сайдбар "Откуда ссылаются" или юнит-тесты.
 */
export function Backlinks({ compact = false }: { compact?: boolean }) {
  const activeNote = useNotesStore((s) => s.activeNote);
  const tree = useNotesStore((s) => s.tree);
  const selectNote = useNotesStore((s) => s.selectNote);

  const backlinks = useMemo(
    () => computeBacklinks(tree, activeNote).map((b) => b.note),
    [activeNote, tree],
  );

  if (!activeNote || backlinks.length === 0) return null;

  return (
    <div
      className={
        compact ? "w-full" : "max-w-3xl mx-auto w-full px-5 sm:px-12 pb-20 pt-6"
      }
    >
      <div className={compact ? "" : "border-t border-[var(--color-border)] pt-6"}>
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3 flex items-center gap-1.5">
          <Link2 size={12} strokeWidth={2} />
          {t("Упоминания")} · {backlinks.length}
        </h3>
        <div className="flex flex-col gap-1.5">
          {backlinks.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void selectNote(n.id)}
              className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)] transition-colors text-left"
            >
              <span className="shrink-0 w-5 flex justify-center">
                {n.icon ? (
                  <span
                    style={{ fontFamily: EMOJI_FONT_STACK }}
                    className="text-base leading-none select-none"
                  >
                    {n.icon}
                  </span>
                ) : (
                  <FileText
                    size={15}
                    strokeWidth={1.8}
                    className="text-zinc-500"
                  />
                )}
              </span>
              <span className="text-[13px] text-zinc-200 truncate flex-1">
                {n.title || DEFAULT_NOTE_TITLE}
              </span>
              {!compact && n.folder && (
                <span className="text-[11px] text-zinc-600 shrink-0 truncate max-w-[45%]">
                  {n.folder.replace(/\//g, " › ")}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
