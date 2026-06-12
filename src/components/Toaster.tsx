import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { useToastStore, type ToastKind } from "../store/toasts";

// Выше палитры команд (200) и контекстного меню (300), чтобы тост не прятался
// за модалкой.
const Z_TOASTS = 400;

const ICON: Record<ToastKind, LucideIcon> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

const ACCENT: Record<ToastKind, string> = {
  error: "text-red-400",
  success: "text-emerald-400",
  info: "text-[var(--color-accent)]",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    // Контейнер не ловит мышь, чтобы не перекрывать приложение; каждый тост
    // включает события обратно для своей кнопки закрытия.
    <div
      style={{ zIndex: Z_TOASTS }}
      className="fixed bottom-6 right-6 flex flex-col items-end gap-2 pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICON[toast.kind];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role="alert"
              className="pointer-events-auto flex items-center gap-2.5 max-w-sm px-3.5 py-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-overlay)] shadow-2xl shadow-black/60 backdrop-blur-xl"
            >
              <Icon
                size={15}
                strokeWidth={2}
                className={cn("shrink-0", ACCENT[toast.kind])}
              />
              <span className="text-[13px] text-zinc-200 flex-1">
                {toast.message}
              </span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={t("Закрыть")}
                className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
