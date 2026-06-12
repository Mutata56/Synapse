/**
 * Рейтинг самых частых тегов в правом рейле. Полоски масштабируются по счёту
 * топового тега, так что самый тяжёлый всегда во всю ширину, а остальные
 * читаются как относительный ранг. Прячем весь виджет, когда фильтр
 * `topTags`/`minCount` проходит меньше четырёх тегов: почти пустой рейтинг
 * хуже, чем никакого.
 *
 * Бирюзовый акцент идёт через `var(--tag-accent)` (объявлен в index.css), так
 * что единственный литеральный hex `#5fb89a` живёт ровно в одном файле, том же,
 * что использует чип `.bn-tag` в редакторе.
 */

import { Hash } from "lucide-react";
import { useMemo } from "react";
import { t } from "../../lib/i18n";
import type { NoteMeta } from "../../lib/storage";
import { topTags } from "../../lib/tagsIndex";
import { useNotesStore } from "../../store/notes";

const MAX_ROWS = 8;
const MIN_TAGS_TO_SHOW = 4;

type Props = {
  notes: NoteMeta[];
};

export function TopTagsLeaderboard({ notes }: Props) {
  const setView = useNotesStore((s) => s.setView);
  const setCurrentTag = useNotesStore((s) => s.setCurrentTag);

  const rows = useMemo(() => topTags(notes, MAX_ROWS), [notes]);

  // Прячем, когда подходит меньше MIN_TAGS_TO_SHOW тегов (новички или кто-то,
  // кто лепит теги одноразово). Рейтинг из двух строк выглядит сломанным.
  if (rows.length < MIN_TAGS_TO_SHOW) return null;

  const maxCount = rows[0][1];

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <Hash
          size={16}
          strokeWidth={2}
          className="text-[var(--color-accent)] shrink-0"
        />
        <h3 className="text-[15px] font-semibold text-zinc-200">
          {t("Часто упоминаемые")}
        </h3>
      </div>
      <div className="mt-4 ml-[26px] flex flex-col gap-2">
        {rows.map(([tag, count]) => {
          const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => {
                setCurrentTag(tag);
                setView("tags");
              }}
              className="w-full flex items-center gap-3 group"
            >
              <span className="w-24 truncate text-sm text-zinc-200 text-left">
                #{tag}
              </span>
              <div className="flex-1 h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                <div
                  style={{
                    width: `${pct}%`,
                    backgroundColor: "var(--color-tag-accent)",
                    opacity: 0.7,
                  }}
                  className="h-full rounded-full transition-[width,opacity] duration-200 group-hover:opacity-90"
                />
              </div>
              <span className="tabular-nums text-[11px] text-zinc-500 w-6 text-right">
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
