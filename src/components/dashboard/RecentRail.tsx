/**
 * Компактный список "недавно изменённых" для правого рейла дашборда. Прячется
 * целиком, когда заметок нет (по спеке, виджета-заглушки не делаем).
 *
 * Вёрстка повторяет рецепт StatCard в уменьшенном виде: ненавязчивая плитка с
 * рамкой, темнеет только на своём hover. Без подъёма от framer-motion, без
 * подсветки соседей, по политике проекта.
 */

import { Clock, FileText } from "lucide-react";
import { useMemo } from "react";
import { EMOJI_FONT_STACK, formatRelativeDate } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { NoteMeta } from "../../lib/storage";
import { useNotesStore } from "../../store/notes";

const MAX_ROWS = 7;

type Props = {
  notes: NoteMeta[];
};

export function RecentRail({ notes }: Props) {
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);

  const recent = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ROWS),
    [notes],
  );

  // Прячем весь виджет, когда показывать нечего. Это то же, что правило про
  // пустые entries: нет заметок, значит нет и записей.
  if (recent.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <Clock
          size={16}
          strokeWidth={2}
          className="text-[var(--color-accent)] shrink-0"
        />
        <h3 className="text-[15px] font-semibold text-zinc-200">{t("Недавнее")}</h3>
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        {recent.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => {
              setView("notes");
              void selectNote(note.id);
            }}
            className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)] px-3 py-2.5 flex items-center gap-2 transition-colors"
          >
            {note.icon ? (
              <span
                style={{ fontFamily: EMOJI_FONT_STACK, fontSize: 16 }}
                aria-hidden
              >
                {note.icon}
              </span>
            ) : (
              <FileText size={13} className="text-zinc-500 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm text-zinc-100">
                {note.title || t("Без названия")}
              </div>
              <div className="text-[11px] text-zinc-500">
                {formatRelativeDate(note.updatedAt)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
