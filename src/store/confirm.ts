import { create } from "zustand";

// todo удалить когда Tauri поддержит window.confirm
// ─── Диалог подтверждения ────────────────────────────────────────────────────
// Tauri webview перехватывает нативный `window.confirm` и роутит в диалог-
// плагин, который тут не зарегистрирован, поэтому каждый вызов отклоняется
// с ошибкой "dialog.confirm not allowed. Command not found", И (поскольку
// шиммированная функция возвращает truthy Promise) синхронный
// `if (!confirm(...))` проходит, тихо *пропуская* подтверждение. Это риск
// потери данных для необратимых действий (очистка корзины / удалить навсегда).
// Этот стор + <ConfirmDialog/> в корне приложения заменяют его на настоящий
// awaited-модал.

export type ConfirmOptions = {
  confirmLabel?: string;
  cancelLabel?: string;
  /** Стилизует кнопку подтверждения как опасную (красная). По умолчанию true. */
  danger?: boolean;
};

type ConfirmRequest = ConfirmOptions & {
  message: string;
  resolve: (ok: boolean) => void;
};

type ConfirmState = {
  request: ConfirmRequest | null;
  ask: (message: string, opts?: ConfirmOptions) => Promise<boolean>;
  /** Завершает открытый запрос (диалог вызывает это при нажатии кнопки / Esc / бэкдропе). */
  resolve: (ok: boolean) => void;
};

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (message, opts) =>
    new Promise<boolean>((resolve, reject) => {
      // Если диалог каким-то образом уже открыт, ОТКЛОНЯЕМ нового вызывающего
      // (и оставляем текущий промпт видимым) вместо тихой отмены как раньше,
      // что интерпретировало бы отмену как "пользователь сказал нет" для
      // действия, которое он никогда не видел. Вызывающие могут ловить через
      // try/catch, стандартный паттерн `if (!(await confirmDialog(...))) return;`
      // покажет проблему как громкий unhandled rejection при разработке.
      if (get().request) {
        reject(new Error("Confirm dialog already open"));
        return;
      }
      set({ request: { message, ...opts, resolve } });
    }),
  resolve: (ok) => {
    const req = get().request;
    if (!req) return;
    set({ request: null });
    req.resolve(ok);
  },
}));

/**
 * Async-замена `window.confirm`. Возвращает Promise, который резолвится в
 * true (подтверждено) / false (отменено). Требует <ConfirmDialog/> однажды
 * смонтированным в корне приложения.
 */
export function confirmDialog(
  message: string,
  opts?: ConfirmOptions,
): Promise<boolean> {
  return useConfirmStore.getState().ask(message, opts);
}

// Братец confirmDialog для случая "спросить у пользователя строку" (например,
// имя шаблона). Та же модель ин-апп-модала, чтобы не зависеть от Tauri
// dialog-плагина, и чтобы семантика отмены по Esc/бэкдропу совпадала.
// Возвращает введенный текст (trimнутый) при подтверждении, или null при
// отмене.

export type PromptOptions = {
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PromptRequest = PromptOptions & {
  message: string;
  resolve: (value: string | null) => void;
};

type PromptState = {
  request: PromptRequest | null;
  ask: (message: string, opts?: PromptOptions) => Promise<string | null>;
  /** Завершает открытый запрос (диалог вызывает это при нажатии кнопки / Esc / бэкдропе). */
  resolve: (value: string | null) => void;
};

export const usePromptStore = create<PromptState>((set, get) => ({
  request: null,
  ask: (message, opts) =>
    new Promise<string | null>((resolve, reject) => {
      if (get().request) {
        reject(new Error("Prompt dialog already open"));
        return;
      }
      set({ request: { message, ...opts, resolve } });
    }),
  resolve: (value) => {
    const req = get().request;
    if (!req) return;
    set({ request: null });
    req.resolve(value);
  },
}));

/**
 * Async-диалог с одним полем ввода. Резолвится в trimнутую строку при
 * подтверждении (пустая строка допустима, вызывающий может валидировать
 * дальше) или `null` при отмене. Требует <PromptDialog/> смонтированным
 * в корне приложения.
 */
export function promptDialog(
  message: string,
  opts?: PromptOptions,
): Promise<string | null> {
  return usePromptStore.getState().ask(message, opts);
}
