import { motion } from "framer-motion";
import {
  Calendar,
  FileText,
  FolderTree,
  Hash,
  Image as ImageIcon,
  Inbox,
  Network,
  Settings,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { reducedFx } from "../lib/platform";
import { INBOX_FOLDER } from "../lib/inbox";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore, type View } from "../store/notes";

type NavItemDef = {
  id: View;
  label: string;
  icon: LucideIcon;
};

/** Общий layoutId: framer-motion перегоняет активную «пилюлю» между пунктами
 *  одной анимацией через transform (без дёрганья `top/left/width/height`). */
const ACTIVE_PILL_LAYOUT_ID = "nav-active";

/** Бодрая пружина, подобрана так, чтобы доезжать за ~150мс без перелёта. */
const ACTIVE_PILL_TRANSITION = {
  type: "spring",
  stiffness: 380,
  damping: 30,
} as const;

const ICON_SIZE_PX = 14;

// ─── Компонент ─────────────────────────────────────────────────────────────

export function NavSection() {
  const view = useNotesStore((s) => s.view);
  const setView = useNotesStore((s) => s.setView);
  const closeActiveNote = useNotesStore((s) => s.closeActiveNote);
  const tree = useNotesStore((s) => s.tree);

  const navItems = useMemo(() => [
    { id: "files" as const, label: t("/ Файлы"), icon: FolderTree },
    { id: "graph" as const, label: t("Граф"), icon: Network },
    { id: "notes" as const, label: t("Все заметки"), icon: FileText },
    { id: "inbox" as const, label: t("Входящие"), icon: Inbox },
    { id: "calendar" as const, label: t("Календарь"), icon: Calendar },
    { id: "overview" as const, label: t("Обзор"), icon: Sparkles },
    { id: "tags" as const, label: t("Теги"), icon: Hash },
    { id: "trash" as const, label: t("Корзина"), icon: Trash2 },
    { id: "images" as const, label: t("Изображения"), icon: ImageIcon },
    { id: "settings" as const, label: t("Настройки"), icon: Settings },
  ], [t]);

  // Неразобранные быстрые захваты во входящих, показываем бейджем в навигации.
  const inboxCount = useMemo(
    () => flattenNotes(tree).filter((n) => n.folder === INBOX_FOLDER).length,
    [tree],
  );

  // Переключение вида почти бесплатно, но клик по "Все заметки" с уже открытой
  // заметкой обрабатываем особо: закрываем активную заметку, чтобы юзер попал
  // в галерею, а не обратно в то, что редактировал последним. Остальные виды
  // редактор не рисуют, так что сбрасывать активную заметку им не надо.
  const handleSelect = (id: View) => {
    setView(id);
    if (id === "notes") closeActiveNote();
  };

  return (
    <nav aria-label={t("Разделы")} className="px-2 py-2 space-y-0.5">
      {navItems.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={view === item.id}
          onSelect={handleSelect}
          badge={item.id === "inbox" ? inboxCount : undefined}
        />
      ))}
    </nav>
  );
}

function NavButton({
  item,
  active,
  onSelect,
  badge,
}: {
  item: NavItemDef;
  active: boolean;
  onSelect: (id: View) => void;
  badge?: number;
}) {
  const { id, label, icon: Icon } = item;
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(id)}
      className={cn(
        "relative w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors",
        active ? "text-white" : "text-zinc-500 hover:text-zinc-200",
      )}
    >
      {active &&
        (reducedFx ? (
          // WebKitGTK не тянет пружину shared-layout плавно (перерисовывает
          // матовый сайдбар каждый кадр). Поэтому активную заливку ставим резко.
          <div className="absolute inset-0 rounded-md bg-[var(--color-accent-bg)] ring-1 ring-inset ring-[var(--color-accent-border)]" />
        ) : (
          <motion.div
            layoutId={ACTIVE_PILL_LAYOUT_ID}
            transition={ACTIVE_PILL_TRANSITION}
            className="absolute inset-0 rounded-md bg-[var(--color-accent-bg)] ring-1 ring-inset ring-[var(--color-accent-border)]"
          />
        ))}
      <Icon
        size={ICON_SIZE_PX}
        strokeWidth={2}
        className={cn(
          "relative z-10 transition-colors",
          active && "text-[var(--color-accent)]",
        )}
      />
      <span className="relative z-10">{label}</span>
      {badge != null && badge > 0 && (
        <span className="relative z-10 ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-accent)] text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
