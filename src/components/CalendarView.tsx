import { useWorkspaceStore } from "../store/workspace";
import { NoteIcon } from "./NoteIcon";
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, FileText, HelpCircle, List, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, RefreshCw, Search, Settings2, Upload, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { calendarDays, calendarRange, calendarWindow, dateFromDay, DEFAULT_CALENDAR_FILTERS, getCalendarEventDays, getCalendarNoteIndex, getCalendarTaskDays, moveCalendarPeriod, shiftDay, writingStreak, type CalendarDay, type CalendarFilters, type CalendarMode } from "../lib/calendarModel";
import { pushAll } from "../lib/caldav";
import { dailyDateOf, toISODate } from "../lib/daily";
import { getLanguage, t } from "../lib/i18n";
import { moodColor, moodFace } from "../lib/mood";
import { isTaskDoneOn, type Task } from "../lib/tasks";
import { useCalendarStore } from "../store/calendar";
import { useNotesStore } from "../store/notes";
import { watchCalendarClock } from "../lib/calendarClock";
import { useTasksStore } from "../store/tasks";
import { useToastStore } from "../store/toasts";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { CalendarTaskRow } from "./calendar/CalendarTaskRow";
import { CalendarWeek } from "./calendar/CalendarWeek";
import "./calendar.css";

const EMPTY_EVENTS: never[] = [];
const PAGE_SIZE = 20;
let session: { anchor: string; selected: string; mode: CalendarMode; filters: CalendarFilters; pane: "auto" | "open" | "closed" } | null = null;

export function CalendarView() {
  const tree = useNotesStore(state => state.tree);
  const calendarUrl = useNotesStore(state => state.settings.calendarIcsUrl);
  const login = useNotesStore(state => state.settings.caldavLogin), password = useNotesStore(state => state.settings.caldavPassword), caldavUrl = useNotesStore(state => state.settings.caldavUrl);
  const events = useCalendarStore(state => state.events), syncStatus = useCalendarStore(state => state.status), syncError = useCalendarStore(state => state.error), lastSync = useCalendarStore(state => state.lastSync);
  const tasks = useTasksStore(state => state.tasks), loaded = useTasksStore(state => state.loaded), loadError = useTasksStore(state => state.error);
  const [today, setToday] = useState(() => toISODate(new Date()));
  const [zone, setZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [anchor, setAnchor] = useState(() => session?.anchor ?? today), [selected, setSelected] = useState(() => session?.selected ?? today);
  const [mode, setMode] = useState<CalendarMode>(() => session?.mode ?? "month");
  const [filters, setFilters] = useState<CalendarFilters>(() => session?.filters ?? { ...DEFAULT_CALENDAR_FILTERS });
  const [pane, setPane] = useState<"auto" | "open" | "closed">(() => session?.pane ?? "auto");
  const [datePicker, setDatePicker] = useState(false), [pickerDay, setPickerDay] = useState(selected);
  const [help, setHelp] = useState(false), [connections, setConnections] = useState(false), [pushing, setPushing] = useState(false);
  const [composer, setComposer] = useState<{ day: string; time: string | null; nonce: number } | null>(null);
  const [removed, setRemoved] = useState<Task | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; day: string } | null>(null);
  const root = useRef<HTMLElement>(null);
  const dayHeading = useRef<HTMLHeadingElement>(null);
  const focusRequest = useRef<"pane" | "calendar" | null>(null);
  const [compact, setCompact] = useState(false);
  const dayVisible = pane !== "closed" && (!compact || pane === "open");
  const search = useRef<HTMLInputElement>(null), connectionRoot = useRef<HTMLDivElement>(null);
  const locale = getLanguage() === "en" ? "en-GB" : "ru-RU", hasCalendar = Boolean(calendarUrl.trim());
  const deferredQuery = useDeferredValue(filters.query);
  const index = useMemo(() => getCalendarNoteIndex(tree, zone), [tree, zone]);
  const range = useMemo(() => calendarRange(anchor, mode), [anchor, mode]);
  const taskDays = useMemo(() => getCalendarTaskDays(tasks, range.from, range.to), [tasks, range.from, range.to]);
  const eventDays = useMemo(() => getCalendarEventDays(hasCalendar ? events : EMPTY_EVENTS, range.from, range.to, zone), [events, hasCalendar, range.from, range.to, zone]);
  const effectiveFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [filters, deferredQuery]);
  const days = useMemo(() => calendarDays(index, taskDays, eventDays, range, effectiveFilters), [index, taskDays, eventDays, range, effectiveFilters]);
  const chosen = days.find(day => day.key === selected) ?? { key: selected, tasks: [], notes: [], events: [], journal: index.journals.get(selected) };
  const monthDays = days.filter(day => day.key >= range.monthFrom && day.key <= range.monthTo);
  const moodDays = (mode === "week" ? days : monthDays).filter(day => day.journal?.mood);
  const moodAverage = moodDays.length ? moodDays.reduce((sum, day) => sum + day.journal!.mood!, 0) / moodDays.length : null;
  const streak = useMemo(() => writingStreak(index, today), [index, today]);
  const previousNotes = useMemo(() => {
    const result = [];
    for (const note of index.anniversaries.get(selected.slice(5)) ?? []) {
      const day = dailyDateOf(note.id) ?? toISODate(new Date(note.createdAt));
      if (day.slice(0, 4) < selected.slice(0, 4)) result.push(note);
      if (result.length === 6) break;
    }
    return result;
  }, [index, selected]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }), [locale]);
  const monthFormat = useMemo(() => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }), [locale]);
  const weekdayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short" }), [locale]);
  const periodLabel = mode === "week" ? `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(dateFromDay(range.from))} — ${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(dateFromDay(range.to))}` : monthFormat.format(dateFromDay(anchor)).replace(/\s*г\.$/, "");
  const filtered = filters.query || !filters.tasks || !filters.events || !filters.notes || !filters.completed;

  useEffect(() => { const observer = new ResizeObserver(entries => setCompact(entries[0].contentRect.width <= 1000)); if (root.current) observer.observe(root.current); return () => observer.disconnect(); }, []);
  useEffect(() => { session = { anchor, selected, mode, filters, pane }; }, [anchor, selected, mode, filters, pane]);
  useEffect(() => { void useTasksStore.getState().load().catch(() => {}); }, []);
  useEffect(() => { useCalendarStore.getState().syncIfStale(); }, [calendarUrl]);
  useEffect(() => watchCalendarClock(clock => { setToday(clock.day); setZone(clock.zone); }, () => useCalendarStore.getState().syncIfStale()), []);
  useEffect(() => {
    if (!connections) return;
    const close = (event: MouseEvent) => { if (!connectionRoot.current?.contains(event.target as Node)) setConnections(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, [connections]);

  const selectDay = useCallback((day: string, openPane = true) => { setSelected(day); if (openPane) { if (compact) focusRequest.current = "pane"; setPane("open"); } setComposer(null); }, [compact]);
  const closePane = () => { focusRequest.current = "calendar"; setPane("closed"); };
  useLayoutEffect(() => {
    if (focusRequest.current === "pane" && compact && dayVisible) {
      const input = composer ? root.current?.querySelector<HTMLInputElement>(".calendar-composer input:not([disabled])") : null;
      (input ?? dayHeading.current)?.focus(); focusRequest.current = null;
    } else if (focusRequest.current === "calendar" && !dayVisible) {
      const date = root.current?.querySelector<HTMLElement>(`[data-date="${selected}"], [data-agenda-day="${selected}"], [data-week-day="${selected}"]`);
      (date ?? root.current?.querySelector<HTMLElement>(".calendar-pane-toggle"))?.focus(); focusRequest.current = null;
    }
  }, [dayVisible, compact, selected, composer, mode]);
  const goDate = (day: string) => { setAnchor(day); setSelected(day); setComposer(null); };
  const move = (delta: number) => goDate(moveCalendarPeriod(anchor, selected, delta, mode));
  const plan = useCallback((day: string, time: string | null = null) => { setSelected(day); if (compact) focusRequest.current = "pane"; setPane("open"); setComposer({ day, time, nonce: Date.now() }); }, [compact]);
  const openDaily = async (day: string) => { try { await useNotesStore.getState().openDailyNote(dateFromDay(day)); } catch (error) { useToastStore.getState().push(t("Не удалось открыть заметку") + ": " + String(error), "error"); } };
  const openNote = async (id: string, newTab = false) => { try { await useWorkspaceStore.getState().openNote(id, newTab); } catch (error) { useToastStore.getState().push(t("Не удалось открыть заметку") + ": " + String(error), "error"); } };
  const onRemove = async (task: Task) => { await useTasksStore.getState().remove(task.id); setRemoved(task); };
  const undoRemove = async () => { if (!removed) return; try { await useTasksStore.getState().restore(removed); setRemoved(null); } catch (error) { useToastStore.getState().push(t("Не удалось сохранить задачу") + ": " + String(error), "error"); } };
  const push = async () => {
    if (pushing || !login || !password || !caldavUrl || !loaded) return;
    setPushing(true);
    try { const result = await pushAll({ login, password, url: caldavUrl }, tasks); useToastStore.getState().push(result.failed.length ? t("Отправлено: {ok}. Ошибок: {failed}", { ok: result.ok, failed: result.failed.length }) : t("Отправлено задач: {n}", { n: result.ok }), result.failed.length ? "error" : "success"); }
    catch (error) { useToastStore.getState().push(t("Не удалось отправить задачи") + ": " + String(error), "error"); }
    finally { setPushing(false); }
  };
  const contextItems: ContextMenuItem[] = menu ? [{ kind: "item", label: t("Новая задача"), icon: Plus, onClick: () => plan(menu.day) }, { kind: "item", label: t("Заметка дня"), icon: BookOpen, onClick: () => openDaily(menu.day) }] : [];

  return <section className={`calendar-workspace${pane === "open" ? " is-pane-open" : pane === "closed" ? " is-pane-closed" : ""}`} ref={root} aria-label={t("Календарь")} onKeyDown={event => {
    const target = event.target as HTMLElement;
    if ((target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") && event.key !== "Escape") return;
    if (event.key === "Escape") { if (datePicker) setDatePicker(false); else if (connections) setConnections(false); else if (help) setHelp(false); else if (!target.closest(".calendar-task-editor")) closePane(); }
    else if (event.key === "/") { event.preventDefault(); search.current?.focus(); }
  }}>
    <header className="calendar-header"><div><h1>{t("Календарь")}</h1><p>{t("Задачи, встречи и заметки по дням")}</p></div><div className="calendar-header-actions"><button type="button" className="calendar-icon-button" aria-expanded={help} aria-label={t("Как пользоваться календарём")} onClick={() => setHelp(value => !value)}><HelpCircle size={18} aria-hidden="true" /></button><div className="calendar-connections" ref={connectionRoot}><button type="button" className="calendar-icon-button" aria-label={t("Подключения календаря")} aria-expanded={connections} onClick={() => setConnections(value => !value)}><MoreHorizontal size={20} aria-hidden="true" /></button>{connections ? <div className="calendar-connection-menu"><p>{hasCalendar ? t("Внешний календарь подключён") : t("Работает локально")}</p>{hasCalendar ? <button type="button" disabled={syncStatus === "loading"} onClick={() => void useCalendarStore.getState().syncNow()}><RefreshCw size={15} aria-hidden="true" />{syncStatus === "loading" ? t("Обновление…") : t("Обновить календарь")}</button> : null}{login && password && caldavUrl ? <button type="button" disabled={pushing || !loaded} onClick={() => void push()}><Upload size={15} aria-hidden="true" />{pushing ? t("Отправка…") : t("Отправить задачи в Яндекс")}</button> : null}<button type="button" onClick={() => useNotesStore.getState().setView("settings")}><Settings2 size={15} aria-hidden="true" />{t("Настройки календаря")}</button>{lastSync ? <small>{t("Обновлено")} {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(lastSync)}</small> : null}</div> : null}</div><button type="button" className="calendar-button is-primary" disabled={!loaded} onClick={() => plan(selected)}><Plus size={16} aria-hidden="true" />{t("Новая задача")}</button></div></header>
    <div className="calendar-toolbar"><div className="calendar-period"><button type="button" className="calendar-icon-button" aria-label={mode === "week" ? t("Предыдущая неделя") : t("Предыдущий месяц")} onClick={() => move(-1)}><ChevronLeft size={18} aria-hidden="true" /></button><h2>{periodLabel}</h2><button type="button" className="calendar-icon-button" aria-label={mode === "week" ? t("Следующая неделя") : t("Следующий месяц")} onClick={() => move(1)}><ChevronRight size={18} aria-hidden="true" /></button><button type="button" className="calendar-button calendar-today" onClick={() => goDate(today)}>{t("Сегодня")}</button><div className="calendar-date-jump"><button type="button" className="calendar-icon-button" title={t("Перейти к дате")} aria-label={t("Перейти к дате")} aria-expanded={datePicker} onClick={() => { setPickerDay(selected); setDatePicker(value => !value); }}><CalendarDays size={17} aria-hidden="true" /></button>{datePicker ? <form className="calendar-date-popover" onSubmit={event => { event.preventDefault(); const day = String(new FormData(event.currentTarget).get("date") ?? ""); if (day) { goDate(day); setDatePicker(false); } }}><label>{t("Перейти к дате")}<input type="date" name="date" required autoFocus onInput={event => setPickerDay(event.currentTarget.value)} value={pickerDay} onChange={event => setPickerDay(event.target.value)} /></label><button type="submit" className="calendar-button is-primary">{t("Перейти")}</button><button type="button" className="calendar-icon-button" aria-label={t("Закрыть")} onClick={() => setDatePicker(false)}><X size={15} aria-hidden="true" /></button></form> : null}</div></div><div className="calendar-view-controls"><div className="calendar-mode" role="group" aria-label={t("Вид календаря")}>{(["month", "week", "agenda"] as const).map(value => <button type="button" aria-pressed={mode === value} key={value} onClick={() => { setMode(value); setAnchor(selected); }}><span>{t(value === "month" ? "Месяц" : value === "week" ? "Неделя" : "Список")}</span></button>)}</div><button type="button" className="calendar-icon-button calendar-pane-toggle" aria-label={dayVisible ? t("Скрыть план дня") : t("Показать план дня")} aria-expanded={dayVisible} onClick={() => { if (dayVisible) closePane(); else { if (compact) focusRequest.current = "pane"; setPane("open"); } }}>{!dayVisible ? <PanelRightOpen size={18} aria-hidden="true" /> : <PanelRightClose size={18} aria-hidden="true" />}</button></div></div>
    <div className="calendar-filter-bar"><div className="calendar-filters" role="group" aria-label={t("Что показывать")}>{(["tasks", "events", "notes"] as const).map(kind => <button key={kind} type="button" className={`calendar-filter is-${kind}`} aria-pressed={filters[kind]} onClick={() => setFilters(value => ({ ...value, [kind]: !value[kind] }))}><i aria-hidden="true" />{t(kind === "tasks" ? "Задачи" : kind === "events" ? "События" : "Заметки")}</button>)}<button type="button" className="calendar-filter calendar-completed" aria-pressed={filters.completed} onClick={() => setFilters(value => ({ ...value, completed: !value.completed }))}><Check size={13} aria-hidden="true" />{t("Выполненные")}</button></div><div className="calendar-search"><Search size={15} aria-hidden="true" /><input ref={search} aria-label={t("Поиск в периоде")} placeholder={t("Поиск в периоде…")} value={filters.query} onChange={event => setFilters(value => ({ ...value, query: event.target.value }))} />{filters.query ? <button type="button" className="calendar-icon-button" aria-label={t("Очистить поиск")} onClick={() => setFilters(value => ({ ...value, query: "" }))}><X size={13} aria-hidden="true" /></button> : <kbd>/</kbd>}</div></div>
    {help ? <div className="calendar-help" role="region" aria-label={t("Как пользоваться календарём")}><button type="button" className="calendar-icon-button" aria-label={t("Закрыть подсказку")} onClick={() => setHelp(false)}><X size={15} aria-hidden="true" /></button><p>{t("Выбери день — его задачи и заметки появятся рядом. В неделе нажми на час, чтобы запланировать дело.")}</p><p>{t("Заметка дня открывает дневник выбранной даты. Повтор, время, цвет и метки меняются в правке задачи.")}</p><p>{t("iCal показывает внешние события. CalDAV отправляет локальные задачи только по кнопке в подключениях.")}</p></div> : null}
    {loadError ? <div className="calendar-notice is-error" role="alert"><span>{t("Не удалось загрузить задачи. Существующий файл сохранён.")}</span><button type="button" onClick={() => void useTasksStore.getState().load().catch(() => {})}>{t("Повторить")}</button></div> : !loaded ? <div className="calendar-notice" role="status">{t("Загрузка задач…")}</div> : null}
    {hasCalendar && syncStatus === "error" ? <div className="calendar-notice is-error" role="alert"><span>{t("Внешний календарь не обновился")}: {syncError}</span><button type="button" onClick={() => void useCalendarStore.getState().syncNow()}>{t("Повторить")}</button></div> : hasCalendar && syncStatus === "loading" ? <div className="calendar-notice" role="status">{t("Обновляем внешние события…")}</div> : null}
    {removed ? <div className="calendar-notice" role="status"><span>{t("Задача удалена")}: {removed.title}</span><button type="button" onClick={() => void undoRemove()}>{t("Отменить удаление")}</button><button type="button" className="calendar-icon-button" aria-label={t("Закрыть")} onClick={() => setRemoved(null)}><X size={13} aria-hidden="true" /></button></div> : null}
    <div className="calendar-body"><div className="calendar-canvas">
      {mode === "week" ? <CalendarWeek days={days} today={today} selected={selected} locale={locale} onSelect={selectDay} onPlan={plan} /> : mode === "agenda" ? <CalendarAgenda days={monthDays} selected={selected} locale={locale} onSelect={selectDay} filtered={Boolean(filtered)} onReset={() => setFilters({ ...DEFAULT_CALENDAR_FILTERS })} onPlan={() => plan(selected)} /> : <CalendarMonth days={days} selected={selected} today={today} month={range.month} locale={locale} weekdayFormat={weekdayFormat} dateFormat={dateFormat} onSelect={selectDay} onNavigate={goDate} onMenu={(event, day) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, day }); }} />}
      <div className="calendar-footer"><span>{streak ? t("Дневник: {n} {word} подряд", { n: streak, word: getLanguage() === "en" ? (streak === 1 ? "day" : "days") : streak % 100 >= 11 && streak % 100 <= 14 ? "дней" : streak % 10 === 1 ? "день" : streak % 10 >= 2 && streak % 10 <= 4 ? "дня" : "дней" }) : t("Выбери день, чтобы открыть его записи")}</span><div className="calendar-moods" aria-label={t(mode === "week" ? "Настроение за неделю" : "Настроение за месяц")}>{moodAverage !== null ? <span title={t("Среднее настроение")}>{moodFace(Math.round(moodAverage))} {moodAverage.toLocaleString(locale, { maximumFractionDigits: 1 })}</span> : null}{moodDays.map(day => <button type="button" key={day.key} style={{ background: moodColor(day.journal?.mood) }} title={`${day.key}: ${moodFace(day.journal?.mood)}`} aria-label={t("Настроение: {day}, {mood} из 5", { day: day.key, mood: day.journal!.mood! })} onClick={() => selectDay(day.key)} />)}</div><span>{t("Записи по дате создания")}</span></div>
    </div><aside className="calendar-day-pane" aria-label={t("План дня")}><div className="calendar-day-heading"><div><p>{new Intl.DateTimeFormat(locale, { weekday: "long" }).format(dateFromDay(selected))}{selected === today ? ` · ${t("Сегодня")}` : ""}</p><h2 ref={dayHeading} tabIndex={-1}>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(dateFromDay(selected))}</h2></div><button type="button" className="calendar-icon-button" aria-label={t("Скрыть план дня")} onClick={closePane}><X size={17} aria-hidden="true" /></button></div><div className="calendar-day-scroll"><button type="button" className="calendar-journal" onClick={() => void openDaily(selected)}><BookOpen size={18} aria-hidden="true" /><span>{chosen.journal ? t("Открыть заметку дня") : t("Написать заметку дня")}<small>{chosen.journal ? chosen.journal.preview || t("Дневник выбранного дня") : t("Мысли, итоги и настроение")}</small></span>{chosen.journal?.mood ? <span className="calendar-mood-face">{moodFace(chosen.journal.mood)}</span> : <ChevronRight size={15} aria-hidden="true" />}</button>
      <TaskComposer key={selected} day={selected} disabled={!loaded} intent={composer?.day === selected ? composer : null} onAdded={() => { setComposer(null); setFilters(value => ({ ...value, tasks: true, query: "" })); }} />
      <DaySection title={t("Задачи")} total={chosen.tasks.length}>{chosen.tasks.length ? <PagedEntries key={selected} items={chosen.tasks} render={task => <CalendarTaskRow key={task.id} task={task} day={selected} onToggle={(task, day) => useTasksStore.getState().toggle(task.id, day)} onUpdate={(id, patch) => useTasksStore.getState().update(id, patch)} onRemove={onRemove} />} /> : <p className="calendar-empty-copy">{filtered ? t("Задач с такими фильтрами нет") : t("Пока ничего не запланировано")}</p>}</DaySection>
      {hasCalendar && filters.events ? <DaySection title={t("Внешние события")} total={chosen.events.length}>{chosen.events.length ? <PagedEntries key={selected} items={chosen.events} render={event => <div className="calendar-event" key={`${event.uid}/${event.start}`}><Clock3 size={14} aria-hidden="true" /><div><strong>{event.summary}</strong><small>{event.allDay || event.start < dateFromDay(selected).getTime() ? t("Весь день") : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(event.start)}{event.location ? ` · ${event.location}` : ""}</small></div></div>} /> : <p className="calendar-empty-copy">{t("На этот день событий нет")}</p>}</DaySection> : null}
      {filters.notes ? <DaySection title={t("Заметки этого дня")} total={chosen.notes.length}>{chosen.notes.length ? <PagedEntries key={selected} items={chosen.notes} render={note => <button type="button" className="calendar-note" key={note.id} onClick={event => void openNote(note.id, event.metaKey)}><NoteIcon note={note} size={15} /><span>{note.title || t("Без названия")}<small>{note.folder || t("Корень хранилища")}</small></span><ChevronRight size={13} aria-hidden="true" /></button>} /> : <p className="calendar-empty-copy">{t("Записей за этот день пока нет")}</p>}</DaySection> : null}
      {filters.notes && previousNotes.length ? <DaySection title={t("В этот день раньше")}><div>{previousNotes.map(note => <button type="button" className="calendar-note" key={note.id} onClick={event => void openNote(note.id, event.metaKey)}><NoteIcon note={note} size={14} /><span>{note.title || t("Без названия")}<small>{(dailyDateOf(note.id) ?? toISODate(new Date(note.createdAt))).slice(0, 4)}</small></span></button>)}</div></DaySection> : null}
      {filtered ? <button type="button" className="calendar-reset" onClick={() => setFilters({ ...DEFAULT_CALENDAR_FILTERS })}>{t("Сбросить фильтры")}</button> : null}
    </div></aside></div>
    <ContextMenu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} items={contextItems} onClose={() => setMenu(null)} />
  </section>;
}

function CalendarMonth({ days, selected, today, month, locale, weekdayFormat, dateFormat, onSelect, onNavigate, onMenu }: { days: CalendarDay[]; selected: string; today: string; month: string; locale: string; weekdayFormat: Intl.DateTimeFormat; dateFormat: Intl.DateTimeFormat; onSelect: (day: string, open?: boolean) => void; onNavigate: (day: string) => void; onMenu: (event: React.MouseEvent, day: string) => void }) {
  const root = useRef<HTMLDivElement>(null), focusAfterNavigation = useRef<string | null>(null);
  useEffect(() => { if (focusAfterNavigation.current) { root.current?.querySelector<HTMLButtonElement>(`[data-date="${focusAfterNavigation.current}"]`)?.focus(); focusAfterNavigation.current = null; } }, [days]);
  return <div className="calendar-month" role="grid" aria-label={t("Сетка месяца")} ref={root}><div className="calendar-weekdays" role="row">{days.slice(0, 7).map(day => <div key={day.key} role="columnheader">{weekdayFormat.format(dateFromDay(day.key))}</div>)}</div><div className="calendar-month-weeks">{Array.from({ length: 6 }, (_, week) => <div className="calendar-month-row" role="row" key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
    const previews = [...day.tasks.slice(0, 2).map(task => ({ id: task.id, title: task.title, time: task.time, kind: "task", done: isTaskDoneOn(task, day.key) })), ...day.events.slice(0, Math.max(0, 2 - day.tasks.length)).map(event => ({ id: `${event.uid}/${event.start}`, title: event.summary, time: event.allDay ? null : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(event.start), kind: "event", done: false }))];
    const other = day.tasks.length + day.events.length - previews.length;
    return <div className={`calendar-month-cell${day.key.slice(0, 7) !== month ? " is-outside" : ""}${day.key === selected ? " is-selected" : ""}${day.key === today ? " is-today" : ""}`} role="gridcell" key={day.key}><button type="button" data-date={day.key} tabIndex={day.key === selected || (!days.some(value => value.key === selected) && day.key === days[0].key) ? 0 : -1} aria-pressed={day.key === selected} aria-current={day.key === today ? "date" : undefined} aria-label={`${dateFormat.format(dateFromDay(day.key))}, ${t("задач: {n}", { n: day.tasks.length })}, ${t("событий: {n}", { n: day.events.length })}, ${t("записей: {n}", { n: day.notes.length })}`} className="calendar-day-cell" onClick={() => { if (day.key.slice(0, 7) !== month) onNavigate(day.key); onSelect(day.key); }} onContextMenu={event => onMenu(event, day.key)} onKeyDown={event => {
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : event.key === "Home" ? -((dateFromDay(day.key).getDay() + 6) % 7) : event.key === "End" ? 6 - ((dateFromDay(day.key).getDay() + 6) % 7) : null;
      if (delta === null) return; event.preventDefault(); const next = shiftDay(day.key, delta);
      if (days.some(value => value.key === next)) { onSelect(next, false); root.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus(); }
      else { focusAfterNavigation.current = next; onNavigate(next); }
    }}><span className="calendar-day-number">{dateFromDay(day.key).getDate()}</span><span className="calendar-day-previews">{previews.map(preview => <span key={preview.id} className={`calendar-day-preview is-${preview.kind}${preview.done ? " is-done" : ""}`}><i aria-hidden="true" />{preview.time ? <small>{preview.time}</small> : null}<span>{preview.title}</span></span>)}{other > 0 ? <span className="calendar-cell-more">{t("Ещё {n}", { n: other })}</span> : null}</span><span className="calendar-cell-notes">{day.notes.length ? <><FileText size={11} aria-hidden="true" /><span>{day.notes.length}</span></> : null}{day.journal ? <BookOpen size={12} aria-label={t("Есть заметка дня")} /> : null}{day.journal?.mood ? <span className="calendar-mood-face">{moodFace(day.journal.mood)}</span> : null}</span></button></div>;
  })}</div>)}</div></div>;
}

function CalendarAgenda({ days, selected, locale, onSelect, filtered, onReset, onPlan }: { days: CalendarDay[]; selected: string; locale: string; onSelect: (day: string) => void; filtered: boolean; onReset: () => void; onPlan: () => void }) {
  const visible = days.filter(day => day.tasks.length + day.events.length + day.notes.length > 0);
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short" });
  if (!visible.length) return <div className="calendar-agenda-empty"><List size={32} strokeWidth={1.4} aria-hidden="true" /><h3>{filtered ? t("В этом периоде ничего не найдено") : t("Планы ещё впереди")}</h3><p>{filtered ? t("Измени поиск или включи нужные источники") : t("Добавь дело на выбранный день или начни его с заметки")}</p><button type="button" className="calendar-button" onClick={filtered ? onReset : onPlan}>{filtered ? t("Сбросить фильтры") : t("Новая задача")}</button></div>;
  return <div className="calendar-agenda" aria-label={t("Список за месяц")}>{visible.map(day => <button type="button" key={day.key} data-agenda-day={day.key} className={`calendar-agenda-day${day.key === selected ? " is-selected" : ""}`} aria-pressed={day.key === selected} onClick={() => onSelect(day.key)}><span className="calendar-agenda-date"><strong>{dateFromDay(day.key).getDate()}</strong><small>{format.format(dateFromDay(day.key))}</small></span><span className="calendar-agenda-entries">{day.tasks.slice(0, 2).map(task => <span className={`calendar-agenda-entry is-task${isTaskDoneOn(task, day.key) ? " is-done" : ""}`} key={task.id}><i aria-hidden="true" /><span>{task.time ?? t("Весь день")}</span>{task.title}</span>)}{day.events.slice(0, 1).map(event => <span className="calendar-agenda-entry is-event" key={`${event.uid}/${event.start}`}><i aria-hidden="true" />{event.summary}</span>)}{day.notes.length ? <span className="calendar-agenda-note-count"><FileText size={13} aria-hidden="true" />{t("Записей: {n}", { n: day.notes.length })}<span>{day.notes[0].title}</span></span> : null}{day.tasks.length + day.events.length > Math.min(day.tasks.length, 2) + Math.min(day.events.length, 1) ? <small>{t("Ещё {n}", { n: day.tasks.length + day.events.length - Math.min(day.tasks.length, 2) - Math.min(day.events.length, 1) })}</small> : null}</span><ChevronRight size={16} aria-hidden="true" /></button>)}</div>;
}

function DaySection({ title, total, children }: { title: string; total?: number; children: ReactNode }) { return <section className="calendar-day-section"><h3>{title}{total ? <span>{total}</span> : null}</h3>{children}</section>; }

function PagedEntries<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [offset, setOffset] = useState(0);
  const page = calendarWindow(items.length, offset, PAGE_SIZE);

  return <><div>{items.slice(page.offset, page.end).map(render)}</div>{items.length > PAGE_SIZE ? <div className="calendar-pagination"><button type="button" className="calendar-icon-button" disabled={page.offset === 0} aria-label={t("Предыдущие записи")} onClick={() => setOffset(page.offset - PAGE_SIZE)}><ChevronLeft size={15} aria-hidden="true" /></button><span>{page.offset + 1}–{page.end} / {items.length}</span><button type="button" className="calendar-icon-button" disabled={page.end === items.length} aria-label={t("Следующие записи")} onClick={() => setOffset(page.end)}><ChevronRight size={15} aria-hidden="true" /></button></div> : null}</>;
}

function TaskComposer({ day, disabled, intent, onAdded }: { day: string; disabled: boolean; intent: { time: string | null; nonce: number } | null; onAdded: () => void }) {
  const [title, setTitle] = useState(""), [time, setTime] = useState(""), [timed, setTimed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (intent) { setTimed(Boolean(intent.time)); setTime(intent.time ?? ""); input.current?.focus(); } }, [intent?.nonce]);
  return <form className="calendar-composer" aria-label={t("Добавить задачу на выбранный день")} onSubmit={async event => { event.preventDefault(); if (disabled || busy || !title.trim()) return; setBusy(true); setError(""); try { const submittedTime = String(new FormData(event.currentTarget).get("time") ?? ""); await useTasksStore.getState().add(day, title, timed ? submittedTime || null : null); setTime(submittedTime); setTitle(""); onAdded(); input.current?.focus(); } catch (failure) { setError(t("Не удалось сохранить задачу") + ": " + String(failure)); } finally { setBusy(false); } }}><div className="calendar-composer-main"><Plus size={16} aria-hidden="true" /><input ref={input} required disabled={disabled || busy} maxLength={500} aria-label={t("Название новой задачи")} placeholder={t("Что запланировать?")} value={title} onChange={event => setTitle(event.target.value)} /><button type="submit" className="calendar-icon-button" disabled={disabled || busy || !title.trim()} aria-label={t("Добавить задачу")}><ChevronRight size={17} aria-hidden="true" /></button></div><div className="calendar-composer-options"><button type="button" disabled={disabled || busy} aria-pressed={timed} onClick={() => { setTimed(value => !value); if (!time) setTime("09:00"); }}><Clock3 size={12} aria-hidden="true" />{timed ? t("Со временем") : t("Весь день")}</button>{timed ? <input type="time" name="time" onInput={event => setTime(event.currentTarget.value)} aria-label={t("Время новой задачи")} required value={time} onChange={event => setTime(event.target.value)} /> : null}</div>{error ? <p className="calendar-inline-error" role="alert">{error}</p> : null}</form>;
}
