import { useEffect } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { useConfirmStore } from "../store/confirm";
import { Modal } from "./Modal";

/**
 * Одна модалка подтверждения на корне приложения, рулит ей useConfirmStore.
 * Замена нативного window.confirm, который вебвью Tauri блокирует. Enter
 * подтверждает, Esc / бэкдроп / Отмена закрывают.
 *
 * Слои, анимация и бэкдроп берутся из общей оболочки Modal. Тут только логика
 * подтверждения: хендлер Enter, содержимое панели, опасный цвет.
 */
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const resolve = useConfirmStore((s) => s.resolve);

  // Enter = подтвердить. Esc и клик по бэкдропу на совести Modal, тут только
  // Enter, потому что он специфичен для подтверждения.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        resolve(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request, resolve]);

  return (
    <Modal
      open={!!request}
      onClose={() => resolve(false)}
      role="alertdialog"
      ariaLabel={t("Подтверждение")}
      panelClassName="w-full max-w-sm bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] rounded-xl shadow-2xl shadow-black/70 p-5"
    >
      <p className="text-[14px] text-zinc-100 leading-relaxed whitespace-pre-line break-words">
        {request?.message}
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => resolve(false)}
          className="px-3 py-1.5 rounded-md text-[13px] font-medium text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
        >
          {request?.cancelLabel ?? t("Отмена")}
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => resolve(true)}
          className={cn(
            "px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors shadow-lg",
            (request?.danger ?? true)
              ? "text-white bg-red-500/90 hover:bg-red-500 shadow-red-500/20"
              : "text-white bg-[var(--color-accent)] hover:bg-indigo-500 shadow-indigo-500/20",
          )}
        >
          {request?.confirmLabel ?? t("Удалить")}
        </button>
      </div>
    </Modal>
  );
}
