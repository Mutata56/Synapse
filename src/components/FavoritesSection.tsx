import { motion } from "framer-motion";
import { FileText, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { t } from "../lib/i18n";
import type { NoteMeta } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";

/** Размер инлайнового эмодзи для иконки строки. Остальные мелкие иконки этой
 *  строки (FileText, Star) берут размер из пропа `size` у lucide и живут в
 *  районе 11-13 px. Держим это именованным, чтобы все три двигались вместе. */
const ROW_EMOJI_PX = 13;
const ROW_FILE_ICON_PX = 12;
const HEADER_STAR_PX = 11;
const UNFAVORITE_STAR_PX = 11;

// ─── Компонент ─────────────────────────────────────────────────────────────

export function FavoritesSection() {
  const tree = useNotesStore((s) => s.tree);
  const activeId = useNotesStore((s) => s.activeId);
  const view = useNotesStore((s) => s.view);
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);
  const toggleFavorite = useNotesStore((s) => s.toggleFavorite);

  const favorites = useMemo(
    () =>
      flattenNotes(tree)
        .filter((n) => n.favorite)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [tree],
  );

  // Не занимаем место в сайдбаре, когда показывать нечего.
  if (favorites.length === 0) return null;

  const openNote = (id: string) => {
    setView("notes");
    void selectNote(id);
  };

  return (
    <div className="flex flex-col">
      <SectionHeader count={favorites.length} />
      <div className="px-1 pb-2">
        {favorites.map((note) => (
          <FavoriteRow
            key={note.id}
            note={note}
            active={view === "notes" && activeId === note.id}
            onOpen={() => openNote(note.id)}
            onUnfavorite={() => void toggleFavorite(note.id)}
          />
        ))}
      </div>
      <FadedDivider />
    </div>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function SectionHeader({ count }: { count: number }) {
  return (
    <div className="px-3 pt-3 pb-1.5 flex items-center gap-1.5">
      <Star
        size={HEADER_STAR_PX}
        strokeWidth={2.2}
        fill="currentColor"
        className="text-amber-300/80"
      />
      <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-zinc-600">
        {t("Избранное")}
      </span>
      <span className="text-[10px] text-zinc-700">· {count}</span>
    </div>
  );
}

function FadedDivider() {
  return (
    <div className="h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent mx-3 my-1" />
  );
}

type FavoriteRowProps = {
  note: NoteMeta;
  active: boolean;
  onOpen: () => void;
  onUnfavorite: () => void;
};

function FavoriteRow({
  note,
  active,
  onOpen,
  onUnfavorite,
}: FavoriteRowProps) {
  const [hovered, setHovered] = useState(false);

  // Внешний контейнер обязан быть `<div role="button">` (а не `<button>`),
  // потому что кнопка «убрать из избранного» внутри это сама `<button>`, а HTML
  // запрещает вложенные интерактивные элементы. Семантику нативной кнопки
  // повторяем руками: tabIndex, активация по Enter и Space, focus-visible
  // обводка.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <motion.div
      layout
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group flex items-center gap-1.5 px-1.5 py-1 cursor-pointer",
        "text-[13px] rounded-md transition-colors outline-none",
        "focus-visible:ring-1 focus-visible:ring-[var(--color-accent-border)]",
        active
          ? "bg-[var(--color-accent-bg)] text-white ring-1 ring-inset ring-[var(--color-accent-border)]"
          : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200",
      )}
    >
      {note.icon ? (
        <span
          style={{
            fontFamily: EMOJI_FONT_STACK,
            fontSize: ROW_EMOJI_PX,
            lineHeight: 1,
          }}
          className="select-none shrink-0 w-4 text-center"
        >
          {note.icon}
        </span>
      ) : (
        <FileText
          size={ROW_FILE_ICON_PX}
          strokeWidth={1.8}
          className="shrink-0 text-zinc-600"
        />
      )}
      <span className="truncate flex-1">
        {note.title || DEFAULT_NOTE_TITLE}
      </span>
      {hovered && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnfavorite();
          }}
          title={t("Убрать из избранного")}
          aria-label={t("Убрать из избранного")}
          className="p-0.5 rounded text-amber-300 hover:text-amber-200 hover:bg-amber-500/15 transition-colors"
        >
          <Star size={UNFAVORITE_STAR_PX} strokeWidth={2} fill="currentColor" />
        </button>
      )}
    </motion.div>
  );
}
