import { motion } from "framer-motion";
import { Hash } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../lib/cn";
import { pluralRu } from "../lib/format";
import { topTags, type TagEntry } from "../lib/tagsIndex";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";
import { NoteCard } from "./NoteCard";

// Общие стили чипа: активная и спокойная палитра лежат в одном месте, а не
// дублируются на каждом варианте чипа.
const CHIP_CLASS =
  "text-[12px] px-3 py-1.5 rounded-full font-medium transition-colors";
const CHIP_ACTIVE = "bg-[var(--color-accent)] text-white";
const CHIP_IDLE_BG = "bg-white/[0.04] hover:bg-white/[0.08]";

export function TagsView() {
  const tree = useNotesStore((s) => s.tree);
  const currentTag = useNotesStore((s) => s.currentTag);
  const setCurrentTag = useNotesStore((s) => s.setCurrentTag);
  const setView = useNotesStore((s) => s.setView);
  const selectNote = useNotesStore((s) => s.selectNote);
  const trashNote = useNotesStore((s) => s.trashNote);

  const allNotes = useMemo(() => flattenNotes(tree), [tree]);

  // Сортировка та же, но показываем ВСЕ теги (без лимита по количеству), чтобы
  // в строке чипов был каждый тег, что юзер когда-либо писал. Таблица лидеров
  // на дашборде дёргает тот же `topTags`, но с дефолтным лимитом.
  const tagCounts = useMemo<TagEntry[]>(
    () => topTags(allNotes, Infinity, 1),
    [allNotes],
  );

  const filtered = useMemo(() => {
    if (!currentTag) return [];
    return allNotes
      .filter((n) => n.tags.includes(currentTag))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [allNotes, currentTag]);

  const hasTags = tagCounts.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Теги
        </h2>
        <p className="text-[13px] text-zinc-500 mt-1">
          {hasTags
            ? `${tagCounts.length} ${pluralRu(tagCounts.length, "тег", "тега", "тегов")}`
            : "Пиши #тег прямо в заметках , они появятся здесь"}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-7xl mx-auto">
        {!hasTags ? (
          <EmptyState />
        ) : (
          <>
            <TagChipBar
              tagCounts={tagCounts}
              currentTag={currentTag}
              onSelect={setCurrentTag}
            />

            {currentTag ? (
              filtered.length === 0 ? (
                <CenteredMessage>
                  С тегом #{currentTag} ничего нет.
                </CenteredMessage>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filtered.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onOpen={() => {
                        setView("notes");
                        void selectNote(note.id);
                      }}
                      onTrash={() => void trashNote(note.id)}
                    />
                  ))}
                </div>
              )
            ) : (
              <CenteredMessage>
                Выбери тег, чтобы увидеть заметки.
              </CenteredMessage>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function TagChipBar({
  tagCounts,
  currentTag,
  onSelect,
}: {
  tagCounts: TagEntry[];
  currentTag: string | null;
  onSelect: (tag: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-8">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          CHIP_CLASS,
          currentTag === null
            ? CHIP_ACTIVE
            : cn("text-zinc-400 hover:text-zinc-100", CHIP_IDLE_BG),
        )}
      >
        Все
      </button>
      {tagCounts.map(([tag, count]) => {
        const active = currentTag === tag;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onSelect(active ? null : tag)}
            className={cn(
              CHIP_CLASS,
              "flex items-center gap-1",
              active
                ? CHIP_ACTIVE
                : cn("text-zinc-300 hover:text-white", CHIP_IDLE_BG),
            )}
          >
            <Hash size={11} strokeWidth={2.4} className="opacity-70" />
            {tag}
            <span className="text-[10px] text-zinc-500">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-zinc-600 text-sm text-center py-24"
    >
      Чтобы добавить тег , напиши{" "}
      <span className="font-mono text-zinc-400">#идея</span> или{" "}
      <span className="font-mono text-zinc-400">#дневник</span> в любой заметке.
    </motion.div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-zinc-600 text-sm text-center py-12">{children}</div>
  );
}
