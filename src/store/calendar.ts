/** Read-only iCal cache. Requests for one feed are shared and old feeds cannot publish late results. */
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { parseIcs, type ParsedEvent } from "../lib/ics";
import { t } from "../lib/i18n";
import { useNotesStore } from "./notes";

type CalendarState = { events: ParsedEvent[]; status: "idle" | "loading" | "ok" | "error"; error: string | null; lastSync: number | null; syncNow: () => Promise<void>; syncIfStale: (maxAgeMs?: number) => void };
const FRESH_MS = 5 * 60 * 1000;

export const useCalendarStore = create<CalendarState>((set, get) => {
  let current: { url: string; request: Promise<void> } | null = null;
  let lastUrl = "";
  const configuredUrl = () => useNotesStore.getState().settings.calendarIcsUrl.trim();
  return {
    events: [], status: "idle", error: null, lastSync: null,
    syncNow: () => {
      const url = configuredUrl();
      if (!url) { current = null; lastUrl = ""; set({ events: [], status: "idle", error: null, lastSync: null }); return Promise.resolve(); }
      if (current?.url === url) return current.request;
      const pending = { url, request: null! as Promise<void> };
      current = pending;
      set({ status: "loading", error: null, ...(lastUrl === url ? {} : { events: [], lastSync: null }) });
      pending.request = (async () => {
        try {
          const text = await invoke<string>("fetch_ics", { url });
          if (current !== pending || configuredUrl() !== url) return;
          if (!/BEGIN:VCALENDAR/i.test(text)) { set({ status: "error", error: t("Ссылка не похожа на iCal-фид. Выбери ссылку экспорта .ics в настройках внешнего календаря.") }); return; }
          lastUrl = url;
          set({ events: parseIcs(text), status: "ok", error: null, lastSync: Date.now() });
        } catch (error) {
          if (current === pending && configuredUrl() === url) set({ status: "error", error: typeof error === "string" ? error : String(error) });
        } finally { if (current === pending) current = null; }
      })();
      return pending.request;
    },
    syncIfStale: (maxAgeMs = FRESH_MS) => {
      const url = configuredUrl();
      if (current?.url === url) return;
      if (url && lastUrl === url && get().lastSync !== null && Date.now() - get().lastSync! < maxAgeMs) return;
      void get().syncNow();
    },
  };
});
