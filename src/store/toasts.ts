import { create } from "zustand";

// ─── Тост-уведомления ────────────────────────────────────────────────────────
// Маленький глобальный канал для вывода мимолетных сообщений (ошибки
// валидации, сбои IPC) пользователю. Рендерится <Toaster/> (смонтирован
// в App).

export type ToastKind = "error" | "success" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

const AUTO_DISMISS_MS = 4000;

let nextId = 0;
// Таймеры авто-скрытия, ключ по id тоста. Очищаются при ручном скрытии,
// также предотвращают обработку уже скрытого id.
const timers = new Map<number, number>();

type ToastStore = {
  toasts: Toast[];
  /** Показывает тост. Идентичные (тот же kind + message) тосты уже на экране
   *  склеиваются, чтобы повторное действие не стакало дубли. */
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
};

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (message, kind = "error") => {
    if (
      get().toasts.some((t) => t.message === message && t.kind === kind)
    ) {
      return;
    }
    const id = ++nextId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    const handle = window.setTimeout(() => {
      timers.delete(id);
      get().dismiss(id);
    }, AUTO_DISMISS_MS);
    timers.set(id, handle);
  },
  dismiss: (id) => {
    const handle = timers.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
