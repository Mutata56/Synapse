import { motion } from "framer-motion";
import { Check, FileText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import {
  gradientClassName,
  parseCover,
  type CoverParsed,
} from "../lib/covers";
import { setDragData, type DragItem } from "../lib/dnd";
import {
  DEFAULT_NOTE_TITLE,
  EMOJI_FONT_STACK,
  EMPTY_NOTE_PREVIEW,
  formatRelativeDate,
} from "../lib/format";
import { resolveCoverImageUrl, type NoteMeta } from "../lib/storage";

const COVER_HEIGHT_CLASS = "h-28";
const FOLDER_CHIP_MAX_WIDTH_PX = 120;
const PREVIEW_MIN_HEIGHT_EM = 3.5;
const ICON_SIZE_PX = 24;
const PLACEHOLDER_ICON_PX = 28;
const SMALL_ICON_PX = 12;

const CARD_TRANSITION = {
  layout: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const },
  opacity: { duration: 0.22 },
  scale: { duration: 0.22 },
  y: { duration: 0.22 },
};

type Props = {
  note: NoteMeta;
  onOpen: () => void;
  onTrash?: () => void;
  selected?: boolean;
  selecting?: boolean;
  onToggleSelect?: () => void;
  draggable?: boolean;
  animateIn?: boolean;
  /**
   * Зовётся на `dragstart`, чтобы решить, какие элементы поедут с этим драгом.
   * Даёт родителю прицепить всё выделение, когда карточка в него входит. Если
   * не передан, карточка тащит только себя.
   */
  getDragItems?: () => DragItem[];
};

// ─── Компонент ─────────────────────────────────────────────────────────────

export function NoteCard({
  note,
  onOpen,
  onTrash,
  selected = false,
  selecting = false,
  onToggleSelect,
  draggable = false,
  animateIn = true,
  getDragItems,
}: Props) {
  const cover = parseCover(note.cover);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  /** true, когда нарисованный `<img>` обложки стрельнул `error`. Сбрасываем на
   *  каждую смену `note.cover`, чтобы удачный выбор стёр прошлые провалы. */
  const [coverImgFailed, setCoverImgFailed] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Обложки `file:` резолвим через asset-протокол Tauri. Для градиентов и
  // внешних URL резолвер вернёт null, и рисуем напрямую. Сброс `coverImgFailed`
  // тут значит, что смена обложки всегда стартует с чистого листа: битая раньше
  // file-обложка не накроет свежевыбранную URL-обложку.
  useEffect(() => {
    setCoverImgFailed(false);

    if (cover.kind !== "file") {
      setCoverUrl(null);
      return;
    }
    let cancelled = false;
    resolveCoverImageUrl(note.cover)
      .then((u) => {
        if (!cancelled) setCoverUrl(u);
      })
      .catch((e) => {
        if (!cancelled) {
          console.error("NoteCard: resolveCoverImageUrl failed:", e);
          setCoverUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [note.cover, cover.kind]);

  // Клик с модификатором и клик в режиме выделения переключают выделение,
  // обычный клик открывает заметку.
  const handleClick = (e: React.MouseEvent) => {
    if (onToggleSelect && (selecting || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onToggleSelect();
      return;
    }
    onOpen();
  };

  // Даём открывать с клавиатуры (Enter / Space) для скринридеров и тех, кто
  // ходит табом, motion.div по умолчанию не кнопка.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };

  const card = (
    <motion.div
      initial={animateIn ? { opacity: 0, y: 8, scale: 0.96 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      whileHover={{ y: -2 }}
      transition={CARD_TRANSITION}
      // `content-visibility: auto` позволяет браузеру пропускать
      // layout/отрисовку карточек за экраном, длинные галереи (сотни и тысячи
      // заметок) скроллятся плавно. `contain-intrinsic-size` резервирует место,
      // чтобы скроллбар не прыгал, `auto` запоминает реальную высоту карточки.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 260px" }}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative cursor-pointer rounded-xl border overflow-hidden h-full transition-colors",
        "outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-border)]",
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] ring-1 ring-[var(--color-accent-border)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)]",
        dragging && "opacity-40",
      )}
    >
      {onToggleSelect && (
        <SelectCheckbox
          selected={selected}
          selecting={selecting}
          onToggle={onToggleSelect}
        />
      )}

      <CoverArea
        cover={cover}
        coverUrl={coverUrl}
        coverImgFailed={coverImgFailed}
        onImgError={() => setCoverImgFailed(true)}
      />

      <CardBody note={note} />

      {onTrash && !selecting && <TrashButton onClick={onTrash} />}
    </motion.div>
  );

  if (!draggable) return card;

  // Оборачиваем в простой DOM-div, чтобы HTML5 dragstart стрелял нативно,
  // framer-motion перехватывает onDragStart у motion.* под свою систему драга.
  return (
    <div
      draggable
      onDragStart={(e) => {
        const items = getDragItems?.() ?? [
          { kind: "note", id: note.id } satisfies DragItem,
        ];
        setDragData(e.dataTransfer, items, {
          label: note.title || DEFAULT_NOTE_TITLE,
          meta: note.folder || undefined,
        });
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      {card}
    </div>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function SelectCheckbox({
  selected,
  selecting,
  onToggle,
}: {
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={selected ? t("Снять выделение") : t("Выделить")}
      aria-label={selected ? t("Снять выделение") : t("Выделить")}
      aria-pressed={selected}
      className={cn(
        "absolute top-2 left-2 z-20 w-5 h-5 rounded-md flex items-center justify-center transition-all",
        selected
          ? "bg-[var(--color-accent)] text-white opacity-100 scale-100"
          : "bg-black/40 backdrop-blur text-transparent border border-white/20 opacity-0 group-hover:opacity-100 hover:border-white/50",
        selecting && !selected && "opacity-100",
      )}
    >
      {selected && <Check size={SMALL_ICON_PX} strokeWidth={3} />}
    </button>
  );
}

function CoverArea({
  cover,
  coverUrl,
  coverImgFailed,
  onImgError,
}: {
  cover: CoverParsed;
  coverUrl: string | null;
  coverImgFailed: boolean;
  onImgError: () => void;
}) {
  // Картиночные обложки (file/url), стрельнувшие `error`, считаем за отсутствие
  // обложки вообще, рисуем нейтральный плейсхолдер.
  const imageFailed =
    coverImgFailed && (cover.kind === "file" || cover.kind === "url");
  const showPlaceholder = cover.kind === "none" || imageFailed;

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-[var(--color-pre-bg)]",
        COVER_HEIGHT_CLASS,
      )}
    >
      {cover.kind === "gradient" && (
        <div
          className={cn("absolute inset-0", gradientClassName(cover.value))}
        />
      )}
      {cover.kind === "file" && coverUrl && !imageFailed && (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={onImgError}
        />
      )}
      {cover.kind === "url" && !imageFailed && (
        <img
          src={cover.value}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={onImgError}
        />
      )}
      {showPlaceholder && <CoverPlaceholder />}
      {/* Мягкий градиент сверху, чтобы текст поверх читался. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent pointer-events-none" />
    </div>
  );
}

function CoverPlaceholder() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-bg-elevated)] to-[var(--color-pre-bg)] flex items-center justify-center">
      <FileText
        size={PLACEHOLDER_ICON_PX}
        strokeWidth={1.2}
        className="text-[var(--color-text-dim)]"
      />
    </div>
  );
}

function CardBody({ note }: { note: NoteMeta }) {
  const folderName = note.folder ? note.folder.split("/").pop() : "";

  return (
    <div className="p-4">
      <div className="flex items-start gap-2 min-w-0">
        {note.icon && (
          <span
            style={{
              fontFamily: EMOJI_FONT_STACK,
              fontSize: ICON_SIZE_PX,
              lineHeight: 1,
            }}
            className="select-none shrink-0"
          >
            {note.icon}
          </span>
        )}
        <h3 className="text-[14px] font-semibold text-zinc-100 truncate flex-1 leading-tight">
          {note.title || DEFAULT_NOTE_TITLE}
        </h3>
      </div>

      <p
        className="text-[12px] text-zinc-500 mt-2 leading-relaxed line-clamp-3"
        style={{ minHeight: `${PREVIEW_MIN_HEIGHT_EM}em` }}
      >
        {note.preview || (
          <span className="text-zinc-700 italic">{EMPTY_NOTE_PREVIEW}</span>
        )}
      </p>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-border)]">
        <span className="text-[11px] text-zinc-600">
          {formatRelativeDate(note.updatedAt)}
        </span>
        {folderName && (
          <span
            className="text-[10px] text-zinc-600 px-1.5 py-0.5 rounded bg-white/[0.03] truncate"
            style={{ maxWidth: FOLDER_CHIP_MAX_WIDTH_PX }}
            title={note.folder}
          >
            {folderName}
          </span>
        )}
      </div>
    </div>
  );
}

function TrashButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={t("В корзину")}
      aria-label={t("В корзину")}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-black/40 backdrop-blur text-white/80 hover:text-red-300 hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-all"
    >
      <Trash2 size={SMALL_ICON_PX} strokeWidth={2} />
    </button>
  );
}
