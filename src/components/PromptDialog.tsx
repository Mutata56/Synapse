import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { usePromptStore } from "../store/confirm";
import { Modal } from "./Modal";

/**
 * Диалог с однострочным вводом, рулит ей usePromptStore. Нужен везде, где надо
 * спросить у юзера имя прямо на месте (название шаблона, со временем переименование
 * папки и т.п.), без плагина диалогов Tauri. Повторяет форму ConfirmDialog:
 * монтируется на корне, Enter подтверждает, Esc / бэкдроп / Отмена возвращают null.
 */
export function PromptDialog() {
  const request = usePromptStore((s) => s.request);
  const resolve = usePromptStore((s) => s.resolve);

  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Сбрасываем локальное значение на каждый новый запрос (иначе при втором
  // открытии висел бы текст от прошлого). Два rAF, чтобы панель уже была
  // смонтирована, прежде чем ставить фокус и выделять.
  useEffect(() => {
    if (!request) return;
    setValue(request.defaultValue ?? "");
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [request]);

  const submit = () => {
    if (!request) return;
    resolve(value.trim());
  };

  return (
    <Modal
      open={!!request}
      onClose={() => resolve(null)}
      role="dialog"
      ariaLabel={request?.message ?? t("Ввод")}
      panelClassName="w-full max-w-sm bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] rounded-xl shadow-2xl shadow-black/70 p-5"
    >
      <p className="text-[14px] text-zinc-100 leading-relaxed whitespace-pre-line break-words">
        {request?.message}
      </p>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={request?.placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="mt-3 w-full px-3 py-2 rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[14px] text-zinc-100 placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors"
      />
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => resolve(null)}
          className="px-3 py-1.5 rounded-md text-[13px] font-medium text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
        >
          {request?.cancelLabel ?? t("Отмена")}
        </button>
        <button
          type="button"
          onClick={submit}
          className="px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors shadow-lg text-white bg-[var(--color-accent)] hover:bg-indigo-500 shadow-indigo-500/20"
        >
          {request?.confirmLabel ?? "OK"}
        </button>
      </div>
    </Modal>
  );
}
