import { useWorkspaceStore } from "../store/workspace";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BarChart3, CalendarDays, CircleMinus, Clock3, FileText, Folder, Hash, LayoutDashboard, Plus, Search, Star, X } from "lucide-react";
import { openCommandPalette } from "../lib/commandPaletteEvents";
import { dailyNoteId, toISODate } from "../lib/daily";
import { formatRelativeDate } from "../lib/format";
import { overviewCount, overviewExcerpt } from "../lib/overviewFormat";
import { getLanguage, t } from "../lib/i18n";
import { buildOverviewModel, overviewActivity, overviewSelection, type OverviewFilter, type OverviewModel } from "../lib/overviewModel";
import type { OverviewWordLoader } from "../lib/overviewWords";
import type { TreeNode } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";
import { OverviewNoteRow } from "./dashboard/OverviewNoteRow";
import "./dashboard/overview.css";

const Analytics = lazy(() => import("./dashboard/OverviewAnalytics"));
const models = new WeakMap<TreeNode[], OverviewModel>();
function modelFor(tree: TreeNode[]) {
  let model = models.get(tree);
  if (!model) { model = buildOverviewModel(flattenNotes(tree)); models.set(tree, model); }
  return model;
}

function useLocalDay() {
  const [today, setToday] = useState(() => toISODate(new Date()));
  useEffect(() => {
    let timer = 0;
    const update = () => {
      setToday(toISODate(new Date()));
      clearTimeout(timer);
      const now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = window.setTimeout(update, midnight.getTime() - now.getTime());
    };
    update();
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  return today;
}

export function WritingDashboard({ loadWords }: { loadWords?: OverviewWordLoader }) {
  const tree = useNotesStore(state => state.tree);
  const activeId = useNotesStore(state => state.activeId);
  const folderColors = useNotesStore(state => state.folderColors);
  const model = useMemo(() => modelFor(tree), [tree]);
  const today = useLocalDay();
  const [panel, setPanel] = useState<"desk" | "analytics">("desk");
  const [filter, setFilter] = useState<OverviewFilter>("recent");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [busy, setBusy] = useState<"note" | "daily" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const activityScroll = useRef<HTMLDivElement>(null);
  const creating = useRef(false);
  const continueNote = (activeId && model.byId.get(activeId)) || model.recent[0] || null;
  const dayDate = useMemo(() => new Date(`${today}T12:00:00`), [today]);
  const daily = model.byId.get(dailyNoteId(dayDate));
  const activity = useMemo(() => overviewActivity(model, today), [model, today]);
  const selection = useMemo(() => overviewSelection(model, filter, selectedDay, filter === "recent" && !selectedDay ? continueNote?.id ?? null : null), [model, filter, selectedDay, continueNote?.id]);
  const maxActivity = Math.max(1, ...activity.map(day => day.count));
  const activityTotal = activity.reduce((sum, day) => sum + day.count, 0);
  const locale = getLanguage() === "en" ? "en-GB" : "ru-RU";
  const dateLabel = dayDate.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const selectedDateLabel = selectedDay ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" }) : "";
  useEffect(() => {
    const scroll = activityScroll.current;
    if (!scroll) return;
    const revealToday = () => { scroll.scrollLeft = scroll.scrollWidth; };
    const observer = new ResizeObserver(revealToday);
    observer.observe(scroll); revealToday();
    return () => observer.disconnect();
  }, [panel, today]);

  const openNote = useCallback(async (id: string, newTab = false) => {
    setError(null);
    try {
      await useWorkspaceStore.getState().openNote(id, newTab);
    } catch { setError(t("Не удалось открыть заметку")); }
  }, []);
  const openCollection = useCallback(async (path: string | null) => {
    try {
      const store = useNotesStore.getState();
      await store.closeActiveNote(); store.setCurrentFolder(path ?? ""); store.setView(path === null ? "notes" : "files");
    } catch { setError(t("Не удалось открыть раздел")); }
  }, []);
  const openTag = useCallback((tag: string) => { const store = useNotesStore.getState(); store.setCurrentTag(tag); store.setView("tags"); }, []);
  const create = async (kind: "note" | "daily") => {
    if (creating.current) return;
    creating.current = true;
    setBusy(kind); setError(null);
    try {
      if (kind === "daily") {
        await useNotesStore.getState().openDailyNote(dayDate);
        if (useNotesStore.getState().activeId === dailyNoteId(dayDate)) useNotesStore.getState().setView("notes");
        else setError(t("Не удалось открыть заметку дня"));
      }
      else {
        const id = await useNotesStore.getState().createNote("");
        if (id && useNotesStore.getState().activeId === id) useNotesStore.getState().setView("notes");
      }
    } catch { setError(t("Не удалось создать заметку")); }
    finally { creating.current = false; setBusy(null); }
  };

  return <section className="overview" aria-label={t("Обзор")}>
    <header className="overview-header">
      <div className="overview-title"><h1>{t("Обзор")}</h1><span>{dateLabel}</span></div>
      <div className="overview-actions"><button className="overview-search" type="button" aria-label={t("Поиск заметок")} onClick={openCommandPalette}><Search size={17} /><span>{t("Поиск заметок")}</span><kbd>⌘ / Ctrl K</kbd></button><button className="overview-primary" type="button" disabled={!!busy} onClick={() => void create("note")}><Plus size={16} />{busy === "note" ? t("Создаём…") : t("Новая заметка")}</button></div>
      <div className="overview-tabs" ref={tabs} role="tablist" aria-label={t("Режим обзора")} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const next = event.key === "Home" ? "desk" : event.key === "End" ? "analytics" : panel === "desk" ? "analytics" : "desk";
        setPanel(next); tabs.current?.querySelector<HTMLButtonElement>(`[data-panel="${next}"]`)?.focus();
      }}>
        <button id="overview-desk-tab" data-panel="desk" type="button" role="tab" aria-selected={panel === "desk"} aria-controls="overview-desk" tabIndex={panel === "desk" ? 0 : -1} onClick={() => setPanel("desk")}><LayoutDashboard size={15} />{t("Рабочий стол")}</button>
        <button id="overview-analytics-tab" data-panel="analytics" type="button" role="tab" aria-selected={panel === "analytics"} aria-controls="overview-analytics" tabIndex={panel === "analytics" ? 0 : -1} onClick={() => setPanel("analytics")}><BarChart3 size={15} />{t("Статистика")}</button>
        <span className="overview-inventory">{`${overviewCount(model.notes.length, "note")} · ${overviewCount(model.tagCount, "tag")}`}</span>
      </div>
    </header>
    {error && <div className="overview-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label={t("Закрыть")}><X size={15} /></button></div>}
    {panel === "analytics" ? <div id="overview-analytics" className="overview-scroll" role="tabpanel" aria-labelledby="overview-analytics-tab"><Suspense fallback={<div className="overview-loading" role="status">{t("Загрузка статистики…")}</div>}><Analytics notes={model.notes} today={today} loadWords={loadWords} onOpen={openNote} /></Suspense></div> : <div id="overview-desk" className="overview-scroll" role="tabpanel" aria-labelledby="overview-desk-tab" onKeyDown={event => { if (event.key === "Escape" && selectedDay) setSelectedDay(null); }}>
      <div className="overview-sheet">
        <div className="overview-start">
          <section className="overview-continue">
            <div className="overview-section-heading"><h2>{continueNote ? t("Продолжить работу") : t("Место для твоих идей")}</h2>{continueNote && <span>{formatRelativeDate(continueNote.updatedAt)}</span>}</div>
            {continueNote ? <><div className="overview-note-context"><Folder size={13} /><span>{continueNote.folder || t("Без папки")}</span>{continueNote.favorite && <Star size={13} />}</div><h3>{continueNote.title || t("Без названия")}</h3><p className="overview-preview">{overviewExcerpt(continueNote.preview) || t("Открой заметку, чтобы продолжить писать и связывать идеи.")}</p><button className="overview-text-action" type="button" onClick={() => void openNote(continueNote.id)}>{t("Продолжить")}<ArrowRight size={16} /></button></> : <><h3>{t("Начни с одной заметки")}</h3><p className="overview-preview">{t("Сохрани мысль, материал для учёбы или рабочий вопрос. Здесь появятся твои заметки и темы.")}</p><button className="overview-text-action" type="button" onClick={() => void create("note")}>{t("Создать заметку")}<ArrowRight size={16} /></button></>}
          </section>
          <section className="overview-today"><CalendarDays size={22} /><div><h2>{t("Заметка дня")}</h2><p>{daily ? t("Сегодняшняя запись уже ждёт тебя.") : t("Что хочется сохранить о сегодняшнем дне?")}</p></div><button className="overview-secondary" type="button" disabled={!!busy} onClick={() => void create("daily")}>{busy === "daily" ? t("Открываем…") : daily ? t("Открыть запись") : t("Записать день")}<ArrowRight size={15} /></button></section>
        </div>
        <div className="overview-columns">
          <div className="overview-main-column">
            <section className="overview-activity" aria-label={t("Последние изменения за 30 дней")}>
              <div className="overview-section-heading"><h2>{t("Последние изменения")}</h2><span>{`${t("30 дней")} · ${overviewCount(activityTotal, "note")}`}</span></div>
              <div className="overview-activity-scroll" ref={activityScroll}><div className="overview-activity-inner"><div className="overview-activity-strip">{activity.map(day => <button key={day.key} className="overview-day" type="button" disabled={!day.count} aria-current={day.key === today ? "date" : undefined} aria-pressed={selectedDay === day.key} aria-label={`${new Date(`${day.key}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" })}: ${overviewCount(day.count, "note")}`} title={`${day.key} · ${day.count}`} onClick={() => setSelectedDay(selectedDay === day.key ? null : day.key)}><span style={{ height: `${Math.max(3, day.count / maxActivity * 28)}px`, opacity: day.count ? 1 : 0.12 }} /></button>)}</div>
              <div className="overview-activity-axis"><span>{new Date(`${activity[0].key}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}</span><span>{t("Сегодня")}</span></div></div></div>
            </section>
            <section className="overview-recent">
              <div className="overview-section-heading"><h2>{t("Заметки под рукой")}</h2><button type="button" className="overview-quiet-action" onClick={() => void openCollection(null)}>{t("Все заметки")}<ArrowRight size={14} /></button></div>
              <div className="overview-list-toolbar"><div className="overview-list-filters" aria-label={t("Фильтр заметок")}>{(["recent", "favorites", "untagged"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "recent" ? <Clock3 size={13} /> : value === "favorites" ? <Star size={13} /> : <CircleMinus size={13} />}{value === "recent" ? t("Недавнее") : value === "favorites" ? t("Избранное") : t("Без тегов")}</button>)}</div>{selectedDay && <button type="button" className="overview-date-filter" onClick={() => setSelectedDay(null)}>{selectedDateLabel}<X size={13} /></button>}</div>
              {selection.notes.length ? <div className="overview-note-list">{selection.notes.map(note => <OverviewNoteRow key={note.id} note={note} onOpen={openNote} />)}</div> : <div className="overview-list-empty"><FileText size={22} /><p>{selectedDay ? t("В этот день нет заметок с выбранным фильтром.") : filter === "favorites" ? t("Отметь важные заметки звёздочкой — они будут здесь.") : filter === "untagged" ? t("Все заметки уже имеют теги.") : t("Новые изменения появятся здесь.")}</p>{selectedDay && <button type="button" className="overview-text-action" onClick={() => setSelectedDay(null)}>{t("Убрать фильтр даты")}</button>}</div>}
            </section>
          </div>
          <aside className="overview-rail">
            <section><div className="overview-section-heading"><h2>{t("Разделы базы")}</h2><span>{model.collectionCount}</span></div>{model.collections.length ? <div className="overview-collections">{model.collections.map(collection => <button type="button" key={collection.path} onClick={() => void openCollection(collection.path)}><Folder size={16} style={{ color: folderColors[collection.path] || "var(--color-text-muted)" }} /><span>{collection.path || t("Без папки")}</span><span className="overview-row-count">{collection.count}</span><ArrowRight size={13} className="overview-row-arrow" /></button>)}</div> : <p className="overview-muted">{t("Разделы появятся вместе с заметками.")}</p>}</section>
            <section><div className="overview-section-heading"><h2>{t("Темы")}</h2><button type="button" className="overview-quiet-action" onClick={() => { const store = useNotesStore.getState(); store.setCurrentTag(null); store.setView("tags"); }}>{t("Все теги")}<ArrowRight size={13} /></button></div>{model.topics.length ? <div className="overview-topics">{model.topics.map(topic => <button key={topic.tag} type="button" onClick={() => openTag(topic.tag)}><Hash size={14} /><span>{topic.tag}</span><span>{topic.count}</span></button>)}</div> : <p className="overview-muted">{t("Добавь #тег в заметку, чтобы собирать темы.")}</p>}</section>
            {model.favorites.length > 0 && <section><div className="overview-section-heading"><h2>{t("Избранное")}</h2><span>{model.favoriteCount}</span></div><div className="overview-favorites">{model.favorites.map(note => <button type="button" key={note.id} onClick={() => void openNote(note.id)}><Star size={13} /><span>{note.title || t("Без названия")}</span><ArrowRight size={13} className="overview-row-arrow" /></button>)}</div></section>}
          </aside>
        </div>
      </div>
    </div>}
  </section>;
}
