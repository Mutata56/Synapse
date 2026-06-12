import { AnimatePresence, motion } from "framer-motion";
import { X, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";

export type ContextMenuItem =
  | {
      kind: "item";
      label: string;
      icon?: LucideIcon;
      onClick: () => void | Promise<void>;
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
    }
  | { kind: "separator" }
  | {
      kind: "swatches";
      label: string;
      colors: readonly string[]; // варианты hex
      active: string | null; // текущий hex, либо null = дефолт
      onPick: (color: string | null) => void;
    };

const Z_CONTEXT_MENU = 300;
const MIN_WIDTH_PX = 200;
const VIEWPORT_PAD_PX = 6;
const ANIM_DURATION_S = 0.12;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

// ─── Компонент ─────────────────────────────────────────────────────────────

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Прижимаем меню к границам вьюпорта, когда уже знаем его размер.
  // useLayoutEffect срабатывает синхронно до отрисовки, так что меню ни на
  // один кадр не вылезает за экран.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + rect.width + VIEWPORT_PAD_PX > window.innerWidth) {
      nx = window.innerWidth - rect.width - VIEWPORT_PAD_PX;
    }
    if (y + rect.height + VIEWPORT_PAD_PX > window.innerHeight) {
      ny = window.innerHeight - rect.height - VIEWPORT_PAD_PX;
    }
    setPos({
      x: Math.max(VIEWPORT_PAD_PX, nx),
      y: Math.max(VIEWPORT_PAD_PX, ny),
    });
  }, [open, x, y, items.length]);

  // Закрытие по клику снаружи, Esc и скроллу.
  //
  // Листенер contextmenu намеренно переиспользует onDown: правый клик снаружи
  // должен закрыть текущее меню. Если новый правый клик попал по другому узлу
  // дерева, его React-обработчик onContextMenu сработает после этого нативного
  // и заново откроет меню уже на новом месте.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("contextmenu", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("contextmenu", onDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          aria-label={t("Контекстное меню")}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: ANIM_DURATION_S, ease: EASE_OUT }}
          style={{
            left: pos.x,
            top: pos.y,
            zIndex: Z_CONTEXT_MENU,
            minWidth: MIN_WIDTH_PX,
          }}
          className="fixed py-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-float)]"
        >
          {items.map((item, i) =>
            item.kind === "separator" ? (
              <div
                key={`sep-${i}`}
                role="separator"
                className="h-px bg-[var(--color-border)] my-1"
              />
            ) : item.kind === "swatches" ? (
              <SwatchRow key={`sw-${i}`} item={item} onClose={onClose} />
            ) : (
              <MenuItem key={`item-${i}`} item={item} onClose={onClose} />
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function MenuItem({
  item,
  onClose,
}: {
  item: Extract<ContextMenuItem, { kind: "item" }>;
  onClose: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (item.disabled) return;
        // Запустили и забыли: действия бывают асинхронные (например массовое
        // удаление), но меню не должно висеть и ждать их. Реджект всё же
        // вытаскиваем наружу, чтобы не словить молчаливый unhandledrejection.
        void Promise.resolve()
          .then(() => item.onClick())
          .catch((err) => {
            console.error("ContextMenu: item action failed:", err);
          });
        onClose();
      }}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] transition-colors text-left",
        item.disabled
          ? "text-zinc-700 cursor-not-allowed"
          : item.danger
            ? "text-zinc-200 hover:text-red-300 hover:bg-red-500/10"
            : "text-zinc-200 hover:bg-white/[0.06]",
      )}
    >
      {Icon && <Icon size={13} strokeWidth={1.8} className="shrink-0" />}
      <span className="flex-1">{item.label}</span>
      {item.hint && (
        <span className="text-[10px] text-zinc-600 font-mono">{item.hint}</span>
      )}
    </button>
  );
}

function SwatchRow({
  item,
  onClose,
}: {
  item: Extract<ContextMenuItem, { kind: "swatches" }>;
  onClose: () => void;
}) {
  const pick = (color: string | null) => {
    item.onPick(color);
    onClose();
  };
  return (
    <div className="px-3 py-1.5">
      <div className="text-[11px] text-zinc-500 mb-1.5">{item.label}</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* Сброс на дефолтный акцентный цвет. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            pick(null);
          }}
          title={t("По умолчанию")}
          aria-label={t("По умолчанию")}
          className={cn(
            "w-5 h-5 rounded-full border flex items-center justify-center transition-transform hover:scale-110",
            item.active === null
              ? "border-white/70 ring-1 ring-white/40"
              : "border-white/20",
          )}
        >
          <X size={11} strokeWidth={2.4} className="text-zinc-400" />
        </button>
        {item.colors.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              pick(hex);
            }}
            title={hex}
            aria-label={`${t("Цвет")} ${hex}`}
            style={{ backgroundColor: hex }}
            className={cn(
              "w-5 h-5 rounded-full border transition-transform hover:scale-110",
              item.active === hex
                ? "border-white ring-2 ring-white/50"
                : "border-black/20",
            )}
          />
        ))}
      </div>
    </div>
  );
}
