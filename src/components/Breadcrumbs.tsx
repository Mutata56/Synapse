import { ChevronRight, Home } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";
import { decodeDrag, type DragItem } from "../lib/dnd";
import { t } from "../lib/i18n";
import { buildBreadcrumbs } from "../lib/treeUtils";
import { reportError } from "../store/notes";

const HOME_ICON_SIZE_PX = 13;
const SEP_ICON_SIZE_PX = 12;
const ROW_MIN_HEIGHT_PX = 28;

/**
 * Один обработчик дропа на заметки и папки сразу. Вызывающий сам бежит по
 * items и применяет нужный move для каждого вида, и сам же отсекает дроп на
 * себя и пустые дропы.
 */
type DropFn = (items: DragItem[], destPath: string) => void | Promise<void>;

type Props = {
  /** Путь к папке через слэш. Пустая строка это корень. */
  path: string;
  onNavigate: (path: string) => void;
  /** Обработчик дропа. Передай, чтобы крошки подсвечивались при наведении. */
  onDrop?: DropFn;
};

// ─── Компонент ─────────────────────────────────────────────────────────────

export function Breadcrumbs({ path, onNavigate, onDrop }: Props) {
  const trail = buildBreadcrumbs(path);
  const droppable = Boolean(onDrop);

  return (
    <nav
      aria-label={t("Хлебные крошки")}
      className="flex items-center gap-1 text-[14px] flex-wrap"
      style={{ minHeight: ROW_MIN_HEIGHT_PX }}
    >
      <Crumb
        label="/"
        icon={<Home size={HOME_ICON_SIZE_PX} strokeWidth={2} />}
        mono
        active={path === ""}
        title={t("Корень")}
        onClick={() => onNavigate("")}
        droppable={droppable}
        onDrop={(items) => onDrop?.(items, "")}
      />
      {trail.map((b, i) => {
        const isLast = i === trail.length - 1;
        return (
          <div key={b.path} className="flex items-center gap-1">
            <ChevronRight
              size={SEP_ICON_SIZE_PX}
              strokeWidth={2}
              className="text-zinc-700"
            />
            <Crumb
              label={b.name}
              active={isLast}
              onClick={() => onNavigate(b.path)}
              droppable={droppable}
              onDrop={(items) => onDrop?.(items, b.path)}
              title={b.path}
            />
          </div>
        );
      })}
    </nav>
  );
}

function Crumb({
  label,
  icon,
  mono,
  active,
  onClick,
  droppable,
  onDrop,
  title,
}: {
  label: string;
  icon?: React.ReactNode;
  mono?: boolean;
  active: boolean;
  onClick: () => void;
  droppable: boolean;
  onDrop: (items: DragItem[]) => void | Promise<void>;
  title?: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = decodeDrag(e.dataTransfer);
    if (items.length === 0) return;
    try {
      await onDrop(items);
    } catch (err) {
      reportError(t("Не удалось переместить"), "Breadcrumbs: drop failed:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={droppable ? handleDragOver : undefined}
      onDragLeave={droppable ? () => setDragOver(false) : undefined}
      onDrop={droppable ? handleDrop : undefined}
      title={title}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md transition-colors",
        // Дети не должны ловить drag-события, иначе при переходе курсора с
        // иконки на подпись на кнопке стрельнёт `dragleave` и подсветка дропа
        // мигнёт на один кадр.
        droppable && "[&>*]:pointer-events-none",
        mono && "font-mono",
        dragOver
          ? "bg-[var(--color-accent)] text-white ring-1 ring-[var(--color-accent-border)]"
          : active
            ? "text-white bg-[var(--color-accent-bg)] ring-1 ring-inset ring-[var(--color-accent-border)] font-medium"
            : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
