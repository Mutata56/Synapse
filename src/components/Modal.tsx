import {
  AnimatePresence,
  motion,
  type Transition,
  type Variants,
} from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { cn } from "../lib/cn";

// ─── Стек Escape на уровне модуля ──────────────────────────────────────────────
//
// Вложенные модалки (например ConfirmDialog поверх TemplatePicker) каждая вешает
// свой Escape-листенер на document. Обычный addEventListener зовёт их в порядке
// регистрации, а React монтирует сначала внешний, так что внешняя модалка
// закрылась бы раньше, чем внутренняя вообще увидит нажатие. stopImmediate-
// Propagation тут не спасает: он глушит листенеры после текущего, а не до. Фикс:
// один общий листенер, который смотрит в стек коллбэков закрытия (последний
// вошёл, первый вышел). Каждый Modal при монтировании пушит, при анмаунте
// снимает, а Escape дёргает только onClose с вершины стека.
const escapeStack: Array<() => void> = [];
let docListenerAttached = false;

function ensureDocListener(): void {
  if (docListenerAttached) return;
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const top = escapeStack[escapeStack.length - 1];
      if (!top) return;
      e.preventDefault();
      top();
    },
    // capture, чтобы успеть раньше внутренних хендлеров, которые могут вызвать preventDefault.
    { capture: true },
  );
  docListenerAttached = true;
}

function pushEscape(cb: () => void): () => void {
  ensureDocListener();
  escapeStack.push(cb);
  return () => {
    // Снимаем именно ЭТОТ cb (не обязательно с вершины: при асинхронных
    // закрытиях анмаунты могут идти не по порядку).
    const i = escapeStack.lastIndexOf(cb);
    if (i !== -1) escapeStack.splice(i, 1);
  };
}

/**
 * Общая оболочка модалки: бэкдроп, панель, обработка Escape и клика снаружи.
 *
 * Четыре оверлея в приложении (ConfirmDialog, VersionHistory, ImageLightbox,
 * TrashPreviewModal) каждый по-своему повторяли один и тот же паттерн:
 * AnimatePresence, бэкдроп motion.div, панель motion.div, только z-index,
 * тайминги переходов и Escape слегка отличались. Свели всё сюда, чтобы правила
 * слоёв, фокус, скролл и язык анимации были едиными, заодно минус ~25 строк
 * бойлерплейта на каждую модалку.
 *
 * Поповеры и инлайн-пикеры (CoverPicker, EmojiPicker, WikiLinkPicker, командная
 * палитра) намеренно сюда не лезут: они привязаны к якорю, а не на весь экран,
 * и позиционируются по-своему.
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** z-index по умолчанию относительно остального UI:
 *  - контекстные меню         около 300
 *  - wiki-link picker          около 200
 *  - этот дефолт (dialog)     = 400 (поверх всего)
 *  Если модалка должна лечь ПОД глобальный confirm, передай свой zIndex. */
const DEFAULT_DIALOG_Z = 400;
const DEFAULT_LIGHTBOX_Z = 300;

const BACKDROP_TRANSITION: Transition = { duration: 0.12 };
const PANEL_TRANSITION: Transition = { duration: 0.16, ease: EASE_OUT };

const BACKDROP_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const PANEL_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 8 },
};

/** Лайтбокс: панель без scale/translate. Картинка тут и есть панель, лишняя
 *  анимация вокруг ни к чему. Контент вызывающего сам рулит своими трансформами. */
const LIGHTBOX_PANEL_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export type ModalVariant = "dialog" | "lightbox";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** "dialog" = затемнённый бэкдроп и панель с увеличением (по умолчанию).
   *  "lightbox" = бэкдроп темнее, панель только с фейдом, как для картинки. */
  variant?: ModalVariant;
  /** ARIA-метка панели. По умолчанию пусто, передавай когда есть что сказать. */
  ariaLabel?: string;
  /** Переопределить role панели. По умолчанию "dialog". Для подтверждений
   *  бери "alertdialog". */
  role?: "dialog" | "alertdialog";
  /** Выключить закрытие по клику на бэкдроп (по умолчанию включено). */
  closeOnBackdrop?: boolean;
  /** Выключить закрытие по Escape (по умолчанию включено). */
  closeOnEscape?: boolean;
  /** Необязательный className, добавляется к бэкдропу. */
  backdropClassName?: string;
  /** Необязательный className, добавляется к обёртке панели. */
  panelClassName?: string;
  /** Переопределить z-index по умолчанию (400 / 300). */
  zIndex?: number;
  /** Доп. пропсы, прокидываются на бэкдроп (например onWheel для лайтбокса). */
  onBackdropWheel?: (e: React.WheelEvent) => void;
}

// ─── Компонент ─────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  children,
  variant = "dialog",
  ariaLabel,
  role = "dialog",
  closeOnBackdrop = true,
  closeOnEscape = true,
  backdropClassName,
  panelClassName,
  zIndex,
  onBackdropWheel,
}: ModalProps) {
  // Escape закрывает, но только верхнюю открытую модалку в стеке (LIFO через
  // модульный escapeStack). Escape на ConfirmDialog поверх TemplatePicker
  // гасит только confirm, а пикер остаётся видимым.
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    return pushEscape(onClose);
  }, [open, closeOnEscape, onClose]);

  const z =
    zIndex ?? (variant === "lightbox" ? DEFAULT_LIGHTBOX_Z : DEFAULT_DIALOG_Z);

  const backdropBase =
    variant === "lightbox"
      ? "fixed inset-0 flex items-center justify-center overflow-hidden bg-black/85 backdrop-blur-sm"
      : "fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={BACKDROP_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={BACKDROP_TRANSITION}
          onClick={closeOnBackdrop ? onClose : undefined}
          onWheel={onBackdropWheel}
          style={{ zIndex: z }}
          className={cn(backdropBase, backdropClassName)}
        >
          <motion.div
            variants={
              variant === "lightbox" ? LIGHTBOX_PANEL_VARIANTS : PANEL_VARIANTS
            }
            initial="initial"
            animate="animate"
            exit="exit"
            transition={PANEL_TRANSITION}
            onClick={(e) => e.stopPropagation()}
            role={role}
            aria-modal="true"
            aria-label={ariaLabel}
            className={panelClassName}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
