/**
 * Только для чтения -- состояние удаленного календаря. Подтягивает iCalendar-фид,
 * настроенный в settings (`calendarIcsUrl`), через команду Rust `fetch_ics`
 * (в Rust, чтобы обойти CORS-политику webview), парсит его и хранит события
 * для наложения на календарь. Серии (повторяющиеся события) тут не
 * разворачиваются, `CalendarView` делает это на видимом месяце через
 * `expandEvents`.
 *
 * Держим отдельно от стора заметок: события календаря это удаленный
 * временный кэш (никогда не пишется на диск), а стор заметок это источник
 * истины воркспейса.
 */

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { parseIcs, type ParsedEvent } from "../lib/ics";
import { t } from "../lib/i18n";
import { useNotesStore } from "./notes";

type SyncStatus = "idle" | "loading" | "ok" | "error";

type CalendarState = {
  events: ParsedEvent[];
  status: SyncStatus;
  error: string | null;
  /** ms-эпоха последней успешной синхронизации, или null. */
  lastSync: number | null;
  /** Подтянуть и распарсить сейчас. Ничего не делает (чистит события), если URL не задан. */
  syncNow: () => Promise<void>;
  /** Синхронизировать только если события устарели, дешевый вызов при маунте вьюхи. */
  syncIfStale: (maxAgeMs?: number) => void;
};

/** Считаем события свежими в течение 5 минут, `syncIfStale` пропускает в этом окне. */
const FRESH_MS = 5 * 60 * 1000;

export const useCalendarStore = create<CalendarState>((set, get) => ({
  events: [],
  status: "idle",
  error: null,
  lastSync: null,

  syncNow: async () => {
    const url = useNotesStore.getState().settings.calendarIcsUrl.trim();
    if (!url) {
      set({ events: [], status: "idle", error: null, lastSync: null });
      return;
    }
    set({ status: "loading", error: null });
    try {
      const text = await invoke<string>("fetch_ics", { url });
      // Проверка на самую частую ошибку: вставлена ссылка "встроить на сайт"
      // из Яндекса (/embed/...) или обычная страница календаря вместо ссылки
      // экспорта iCal. Они возвращают HTML, а не iCalendar-фид.
      if (!/BEGIN:VCALENDAR/i.test(text)) {
        set({
          status: "error",
          error:
            t("Ссылка не похожа на iCal-фид. Похоже, это ссылка для встраивания (/embed/…), а нужна ссылка экспорта: в Яндекс.Календаре наведите на название календаря , значок настроек , вкладка «Экспорт» , формат iCal."),
        });
        return;
      }
      set({
        events: parseIcs(text),
        status: "ok",
        error: null,
        lastSync: Date.now(),
      });
    } catch (e) {
      // `fetch_ics` отклоняется простой строкой (Result<_, String>).
      set({ status: "error", error: typeof e === "string" ? e : String(e) });
    }
  },

  syncIfStale: (maxAgeMs = FRESH_MS) => {
    const { status, lastSync, syncNow } = get();
    if (status === "loading") return;
    if (!useNotesStore.getState().settings.calendarIcsUrl.trim()) return;
    if (lastSync != null && Date.now() - lastSync < maxAgeMs) return;
    void syncNow();
  },
}));
