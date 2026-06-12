import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Flame,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { dailyDateOf, dayKey, toISODate } from "../lib/daily";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { expandEvents, type CalEvent } from "../lib/ics";
import { t } from "../lib/i18n";
import { moodColor, moodFace } from "../lib/mood";
import { type Task } from "../lib/tasks";
import { flattenNotes } from "../lib/treeUtils";
import { useCalendarStore } from "../store/calendar";
import { useNotesStore } from "../store/notes";
import { useTasksStore } from "../store/tasks";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
/** Акцент (indigo) как rgb, чтобы heatmap мог играть с alpha. */
const ACCENT_RGB = "99, 102, 241";
/** 0..23, часовая шкала в модалке дня. */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Ниже контекстного меню (z=300), чтобы меню по ПКМ было над модалкой. */
const Z_DAY_MODAL = 250;

/** Прозрачность заливки heatmap для числа заметок за день. */
function heatAlpha(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 0.16;
  if (count <= 3) return 0.32;
  if (count <= 6) return 0.5;
  return 0.68;
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export function CalendarView() {
  const tree = useNotesStore((s) => s.tree);
  const openDailyNote = useNotesStore((s) => s.openDailyNote);
  const openDailyTemplate = useNotesStore((s) => s.openDailyTemplate);
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);

  // Внешний календарь поверх (только чтение): Яндекс и прочие через фид iCalendar.
  const calendarUrl = useNotesStore((s) => s.settings.calendarIcsUrl);
  const calEvents = useCalendarStore((s) => s.events);
  const calStatus = useCalendarStore((s) => s.status);
  const calError = useCalendarStore((s) => s.error);
  const syncIfStale = useCalendarStore((s) => s.syncIfStale);
  const syncNow = useCalendarStore((s) => s.syncNow);
  const hasCalendar = calendarUrl.trim() !== "";

  // Локальные задачи юзера: показываем на сетке и в редактируемой повестке ниже.
  const tasks = useTasksStore((s) => s.tasks);
  const loadTasks = useTasksStore((s) => s.load);
  const addTask = useTasksStore((s) => s.add);
  const updateTask = useTasksStore((s) => s.update);
  const toggleTask = useTasksStore((s) => s.toggle);
  const removeTask = useTasksStore((s) => s.remove);

  const [today, setToday] = useState(() => new Date());
  const todayKey = toISODate(today);
  // Сетка по месяцу или таймлайн на 7 дней недели.
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  // Любой день внутри видимой недели (в раскладке привязка к понедельнику).
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => today);
  // День, у которого открыта модалка (ISO `YYYY-MM-DD`), или null.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Если задано, модалка дня сразу открывается со строкой добавления на это
  // время (`time: null` это весь день). Взводится по ПКМ или клику и "Запланировать".
  const [autoAdd, setAutoAdd] = useState<{ time: string | null } | null>(null);
  // Меню по ПКМ на ячейке дня (отдельно от меню внутри модалки).
  const [gridMenu, setGridMenu] = useState<{
    x: number;
    y: number;
    day: string;
  } | null>(null);

  // Перещёлкиваем `today` в локальную полночь, чтобы ночная сессия обновила
  // кольцо "сегодня", якорь серии и "в этот день", а не залипла на дне, когда
  // вью смонтировался. Перевзводимся от `todayKey`, так что каждый тик ставит
  // следующую полночь.
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    const id = window.setTimeout(
      () => setToday(new Date()),
      nextMidnight - now.getTime() + 50,
    );
    return () => window.clearTimeout(id);
  }, [todayKey]);

  // Обновляем внешний календарь при открытии вью (пропускаем, если свежий или не задан).
  useEffect(() => {
    syncIfStale();
  }, [syncIfStale]);

  // Грузим локальные задачи один раз при первом открытии календаря.
  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const notes = useMemo(() => flattenNotes(tree), [tree]);

  // Заметки по локальным дням (heatmap) и дни, где есть заметка дня.
  const { countByDay, dailyDays, moodByDay } = useMemo(() => {
    const countByDay = new Map<string, number>();
    const dailyDays = new Set<string>();
    const moodByDay = new Map<string, number>();
    for (const n of notes) {
      const k = dayKey(n.createdAt);
      countByDay.set(k, (countByDay.get(k) ?? 0) + 1);
      const dd = dailyDateOf(n.id);
      if (dd) {
        dailyDays.add(dd);
        if (typeof n.mood === "number") moodByDay.set(dd, n.mood);
      }
    }
    return { countByDay, dailyDays, moodByDay };
  }, [notes]);

  // Текущая серия письма: подряд идущие дни с заметкой дня, заканчиваются
  // сегодня (или вчера, если сегодня ещё не записано).
  const streak = useMemo(() => {
    let count = 0;
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!dailyDays.has(toISODate(d))) d.setDate(d.getDate() - 1);
    while (dailyDays.has(toISODate(d))) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }, [dailyDays, today]);

  // "В этот день": заметки, созданные в этот же день календаря в прошлые годы.
  const onThisDay = useMemo(() => {
    const mm = today.getMonth();
    const dd = today.getDate();
    const yy = today.getFullYear();
    return notes
      .filter((n) => {
        const d = new Date(n.createdAt);
        return d.getMonth() === mm && d.getDate() === dd && d.getFullYear() !== yy;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, today]);

  // Сетка месяца с понедельника. `null` это пустые ячейки до 1-го числа.
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7; // Пн=0 .. Вс=6
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(new Date(cursor.y, cursor.m, d));
    return out;
  }, [cursor]);

  // Повторяющиеся серии, развёрнутые в конкретные вхождения внутри видимого месяца.
  const monthEvents = useMemo(() => {
    if (!hasCalendar) return [];
    const start = new Date(cursor.y, cursor.m, 1).getTime();
    const end = new Date(cursor.y, cursor.m + 1, 1).getTime();
    return expandEvents(calEvents, start, end);
  }, [calEvents, cursor, hasCalendar]);

  // Дни (ISO-ключ), где есть хотя бы одно событие, ставим точку на ячейке.
  const eventDays = useMemo(
    () => new Set(monthEvents.map((ev) => toISODate(new Date(ev.start)))),
    [monthEvents],
  );

  // События по дням подряд для списка повестки (уже отсортированы).
  const agenda = useMemo(() => {
    const groups: { key: string; date: Date; events: CalEvent[] }[] = [];
    for (const ev of monthEvents) {
      const k = toISODate(new Date(ev.start));
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.events.push(ev);
      else groups.push({ key: k, date: new Date(ev.start), events: [ev] });
    }
    return groups;
  }, [monthEvents]);

  // Локальные задачи по дням (для маркера на сетке). `tasks` уже глобально
  // отсортирован, так что срез каждого дня сохраняет порядок показа.
  const tasksByDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const arr = m.get(t.day);
      if (arr) arr.push(t);
      else m.set(t.day, [t]);
    }
    return m;
  }, [tasks]);

  // Задачи видимого месяца, сгруппированы по дням для редактируемой повестки.
  const monthTaskGroups = useMemo(() => {
    const prefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-`;
    const groups: { key: string; date: Date; tasks: Task[] }[] = [];
    for (const t of tasks) {
      if (!t.day.startsWith(prefix)) continue;
      const last = groups[groups.length - 1];
      if (last && last.key === t.day) last.tasks.push(t);
      else groups.push({ key: t.day, date: dateOfDay(t.day), tasks: [t] });
    }
    return groups;
  }, [tasks, cursor]);

  // ─ Режим недели ─
  // 7 дней видимой недели, с понедельника.
  const weekDays = useMemo(() => {
    const start = startOfWeek(weekAnchor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [weekAnchor]);

  const weekLabel = useMemo(() => weekRangeLabel(weekDays), [weekDays]);

  // Внешние события на видимую неделю: разворачиваем разом и группируем по дням.
  const weekEventsByDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    if (!hasCalendar) return m;
    const start = weekDays[0].getTime();
    const last = weekDays[6];
    const end = new Date(
      last.getFullYear(),
      last.getMonth(),
      last.getDate() + 1,
    ).getTime();
    for (const ev of expandEvents(calEvents, start, end)) {
      const k = toISODate(new Date(ev.start));
      const arr = m.get(k);
      if (arr) arr.push(ev);
      else m.set(k, [ev]);
    }
    return m;
  }, [calEvents, weekDays, hasCalendar]);

  // Внешние события открытого дня, идут в таймлайн модалки. Разворачиваем
  // только для этого дня, чтобы было верно, даже если открытый день вне
  // видимого месяца (например, открыт из режима недели).
  const selEvents = useMemo(() => {
    if (!selectedDay || !hasCalendar) return [];
    const d = dateOfDay(selectedDay);
    const start = d.getTime();
    const end = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + 1,
    ).getTime();
    return expandEvents(calEvents, start, end);
  }, [calEvents, selectedDay, hasCalendar]);

  const shiftMonth = (delta: number) =>
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const goToday = () =>
    setCursor({ y: today.getFullYear(), m: today.getMonth() });
  const shiftWeek = (delta: number) =>
    setWeekAnchor((w) => {
      const d = new Date(w);
      d.setDate(d.getDate() + delta * 7);
      return d;
    });
  // Назад/вперёд/"сегодня" работают в зависимости от активного режима.
  const goPrev = () => (mode === "week" ? shiftWeek(-1) : shiftMonth(-1));
  const goNext = () => (mode === "week" ? shiftWeek(1) : shiftMonth(1));
  const goCurrent = () => (mode === "week" ? setWeekAnchor(today) : goToday());

  const openNote = (id: string) => {
    setView("notes");
    void selectNote(id);
  };

  const closeDay = () => {
    setSelectedDay(null);
    setAutoAdd(null);
  };

  // Открыть модалку дня, взведённую на добавление в заданное время (null это весь день).
  const planOnDay = (day: string, time: string | null = null) => {
    setAutoAdd({ time });
    setSelectedDay(day);
  };

  // Пункты меню по ПКМ на ячейке дня (собираем, когда оно открыто).
  const gridMenuItems: ContextMenuItem[] = [];
  if (gridMenu) {
    const day = gridMenu.day;
    gridMenuItems.push({
      kind: "item",
      label: t("Запланировать дело"),
      icon: Plus,
      onClick: () => {
        planOnDay(day, null);
        setGridMenu(null);
      },
    });
    gridMenuItems.push({
      kind: "item",
      label: t("Заметка дня"),
      icon: FileText,
      onClick: () => {
        setGridMenu(null);
        void openDailyNote(dateOfDay(day));
      },
    });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 flex items-end justify-between border-b border-[var(--color-border)] shrink-0">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Календарь
          </h2>
          <p className="text-[13px] text-zinc-500 mt-1 flex items-center gap-1.5">
            <Flame
              size={13}
              strokeWidth={2}
              className={streak > 0 ? "text-orange-400" : "text-zinc-600"}
            />
            {streak > 0
              ? `Серия: ${streak} ${pluralDays(streak)} подряд`
              : "Запиши день, чтобы начать серию"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasCalendar && (
            <button
              type="button"
              onClick={() => void syncNow()}
              title={
                calStatus === "error"
                  ? `Ошибка синхронизации календаря: ${calError}`
                  : "Обновить календарь"
              }
              aria-label="Обновить календарь"
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-md transition-colors",
                calStatus === "error"
                  ? "text-red-400/80 hover:bg-white/[0.05]"
                  : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]",
              )}
            >
              <RefreshCw
                size={14}
                strokeWidth={2}
                className={cn(calStatus === "loading" && "animate-spin")}
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => void openDailyTemplate()}
            title="Изменить шаблон заметки дня"
            className="flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-zinc-100 px-3 py-1.5 rounded-md hover:bg-white/[0.05] transition-colors font-medium"
          >
            <LayoutTemplate size={14} strokeWidth={2} />
            Шаблон
          </button>
          <button
            type="button"
            onClick={() => void openDailyNote(new Date())}
            className="flex items-center gap-1.5 text-[13px] text-white bg-[var(--color-accent)] hover:bg-indigo-500 px-3 py-1.5 rounded-md font-medium shadow-lg shadow-indigo-500/20 transition-colors"
          >
            {t("Заметка дня")}
          </button>
        </div>
      </header>

      {/* Навигация и переключатель месяц/неделя */}
      <div className="px-10 pt-6 pb-4 shrink-0">
        <div className={cn(mode === "month" && "max-w-3xl mx-auto")}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-zinc-200 truncate min-w-0">
              {mode === "week" ? weekLabel : `${MONTHS[cursor.m]} ${cursor.y}`}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-0.5">
                <ModeTab active={mode === "month"} onClick={() => setMode("month")}>
                  Месяц
                </ModeTab>
                <ModeTab active={mode === "week"} onClick={() => setMode("week")}>
                  Неделя
                </ModeTab>
              </div>
              <div className="flex items-center gap-1">
                <NavBtn
                  onClick={goPrev}
                  label={mode === "week" ? t("Предыдущая неделя") : t("Предыдущий месяц")}
                >
                  <ChevronLeft size={16} strokeWidth={2} />
                </NavBtn>
                <button
                  type="button"
                  onClick={goCurrent}
                  className="text-[12px] text-zinc-400 hover:text-zinc-100 px-2.5 py-1.5 rounded-md hover:bg-white/[0.05] transition-colors font-medium"
                >
                  Сегодня
                </button>
                <NavBtn
                  onClick={goNext}
                  label={mode === "week" ? "Следующая неделя" : "Следующий месяц"}
                >
                  <ChevronRight size={16} strokeWidth={2} />
                </NavBtn>
              </div>
            </div>
          </div>
        </div>
      </div>

      {mode === "week" ? (
        <WeekView
          weekDays={weekDays}
          todayKey={todayKey}
          tasksByDay={tasksByDay}
          eventsByDay={weekEventsByDay}
          onOpenDay={(day) => setSelectedDay(day)}
          onPlan={planOnDay}
          onToggle={(id) => void toggleTask(id)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-10 pb-6">
          <div className="max-w-3xl mx-auto">
            {/* Шапка с днями недели */}
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 text-center py-1"
              >
                {w}
              </div>
            ))}
          </div>

          {/* Сетка дней */}
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((date, i) => {
              if (!date) return <div key={`blank-${i}`} />;
              const key = toISODate(date);
              const count = countByDay.get(key) ?? 0;
              const hasDaily = dailyDays.has(key);
              const mood = moodByDay.get(key);
              const isToday = key === todayKey;
              const dayTasks = tasksByDay.get(key);
              const hasOpenTask = dayTasks?.some((t) => !t.done) ?? false;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setGridMenu({ x: e.clientX, y: e.clientY, day: key });
                  }}
                  title={
                    count > 0
                      ? `${count} ${pluralNotes(count)}${hasDaily ? " · есть заметка дня" : ""}`
                      : "Открыть · ПКМ , запланировать"
                  }
                  style={{
                    backgroundColor: count
                      ? `rgba(${ACCENT_RGB}, ${heatAlpha(count)})`
                      : undefined,
                  }}
                  className={cn(
                    "relative aspect-square rounded-lg flex items-center justify-center text-[13px] transition-colors",
                    "border",
                    isToday
                      ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent-border)]"
                      : "border-transparent hover:border-[var(--color-border-strong)]",
                    count
                      ? "text-white font-medium"
                      : "text-zinc-400 hover:bg-white/[0.04]",
                  )}
                >
                  {date.getDate()}
                  {mood != null ? (
                    <span
                      className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] leading-none select-none"
                      style={{ fontFamily: EMOJI_FONT_STACK }}
                    >
                      {moodFace(mood)}
                    </span>
                  ) : hasDaily ? (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white/90" />
                  ) : null}
                  {eventDays.has(key) && (
                    <span
                      className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-sky-400"
                      title="Есть события календаря"
                    />
                  )}
                  {dayTasks && dayTasks.length > 0 && (
                    <span
                      className={cn(
                        "absolute top-1 left-1 w-1.5 h-1.5 rounded-full",
                        hasOpenTask ? "bg-amber-400" : "bg-emerald-400/70",
                      )}
                      title={`${dayTasks.length} ${pluralTasks(dayTasks.length)}${
                        hasOpenTask ? "" : " · выполнено"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Локальные задачи видимого месяца: обзор с правкой. Добавляют не
              здесь, а в модалке дня (клик по дню). */}
          <TasksSection
            groups={monthTaskGroups}
            onToggle={(id) => void toggleTask(id)}
            onRemove={(id) => void removeTask(id)}
            onRename={(id, title) => void updateTask(id, { title })}
          />

          {/* События внешнего календаря за видимый месяц */}
          {hasCalendar && (
            <CalendarAgenda groups={agenda} status={calStatus} error={calError} />
          )}

          {/* Тренд настроения за видимый месяц */}
          <MoodTrend year={cursor.y} month={cursor.m} moodByDay={moodByDay} />

          {/* В этот день */}
          {onThisDay.length > 0 && (
            <section className="mt-8">
              <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3">
                В этот день · ранее
              </h3>
              <div className="flex flex-col gap-1.5">
                {onThisDay.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => openNote(note.id)}
                    className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)] transition-colors text-left"
                  >
                    <span className="shrink-0 w-5 flex justify-center">
                      {note.icon ? (
                        <span
                          style={{ fontFamily: EMOJI_FONT_STACK }}
                          className="text-base leading-none select-none"
                        >
                          {note.icon}
                        </span>
                      ) : (
                        <FileText
                          size={15}
                          strokeWidth={1.8}
                          className="text-zinc-500"
                        />
                      )}
                    </span>
                    <span className="text-[13px] text-zinc-200 truncate flex-1">
                      {note.title || DEFAULT_NOTE_TITLE}
                    </span>
                    <span className="text-[11px] text-zinc-600 shrink-0 tabular-nums">
                      {new Date(note.createdAt).getFullYear()}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedDay && (
          <DayDetailModal
            key={selectedDay}
            date={dateOfDay(selectedDay)}
            isToday={selectedDay === todayKey}
            autoAdd={autoAdd}
            tasks={tasksByDay.get(selectedDay) ?? []}
            events={selEvents}
            onClose={closeDay}
            onAdd={(time, title) => void addTask(selectedDay, title, time)}
            onToggle={(id) => void toggleTask(id)}
            onRemove={(id) => void removeTask(id)}
            onRename={(id, title) => void updateTask(id, { title })}
            onOpenDailyNote={() => {
              const d = dateOfDay(selectedDay);
              closeDay();
              void openDailyNote(d);
            }}
          />
        )}
      </AnimatePresence>

      {/* Меню по ПКМ для ячеек дней на сетке. */}
      <ContextMenu
        open={gridMenu != null}
        x={gridMenu?.x ?? 0}
        y={gridMenu?.y ?? 0}
        items={gridMenuItems}
        onClose={() => setGridMenu(null)}
      />
    </div>
  );
}

// ─── Подкомпоненты и хелперы ─────────────────────────────────────────────────

/** Столбики настроения по дням видимого месяца (цвет это настроение), плюс
 *  средняя рожица за месяц. Скрыто, если ни у одного дня настроения нет. */
function MoodTrend({
  year,
  month,
  moodByDay,
}: {
  year: number;
  month: number;
  moodByDay: Map<string, number>;
}) {
  const days = new Date(year, month + 1, 0).getDate();
  const points = useMemo(() => {
    const out: { d: number; mood: number }[] = [];
    for (let d = 1; d <= days; d++) {
      const m = moodByDay.get(toISODate(new Date(year, month, d)));
      if (typeof m === "number") out.push({ d, mood: m });
    }
    return out;
  }, [year, month, days, moodByDay]);

  if (points.length === 0) return null;
  const avg = points.reduce((s, p) => s + p.mood, 0) / points.length;

  return (
    <section className="mt-8">
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3 flex items-center gap-1.5">
        Настроение · среднее
        <span
          style={{ fontFamily: EMOJI_FONT_STACK }}
          className="text-sm leading-none"
        >
          {moodFace(Math.round(avg))}
        </span>
        <span className="text-zinc-500 tabular-nums normal-case tracking-normal">
          {avg.toFixed(1)}
        </span>
      </h3>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
        <svg
          viewBox={`0 0 ${days} 5`}
          preserveAspectRatio="none"
          className="w-full h-16"
        >
          {points.map((p) => (
            <rect
              key={p.d}
              x={p.d - 1 + 0.15}
              y={5 - p.mood}
              width={0.7}
              height={p.mood}
              fill={moodColor(p.mood)}
              opacity={0.85}
            />
          ))}
        </svg>
      </div>
    </section>
  );
}

/** Повестка событий внешнего календаря за видимый месяц (только чтение),
 *  по дням. Если показывать нечего, рисуем состояние синхронизации или "пусто". */
function CalendarAgenda({
  groups,
  status,
  error,
}: {
  groups: { key: string; date: Date; events: CalEvent[] }[];
  status: "idle" | "loading" | "ok" | "error";
  error: string | null;
}) {
  return (
    <section className="mt-8">
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3">
        События календаря
      </h3>
      {status === "error" ? (
        <p className="text-[13px] text-red-400/90 break-words">
          Не удалось загрузить: {error}
        </p>
      ) : groups.length === 0 ? (
        <p className="text-[13px] text-zinc-600">
          {status === "loading" ? "Синхронизация…" : "В этом месяце событий нет"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.key} className="flex gap-3">
              <div className="shrink-0 w-12 pt-0.5 text-right">
                <div className="text-[14px] font-semibold text-zinc-300 tabular-nums leading-none">
                  {g.date.getDate()}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-600 mt-1">
                  {g.date.toLocaleDateString("ru-RU", { weekday: "short" })}
                </div>
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                {g.events.map((ev, i) => (
                  <div
                    key={`${ev.uid}-${i}`}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[12px] text-[var(--color-accent)] font-medium tabular-nums">
                        {fmtEventTime(ev)}
                      </span>
                      <span className="text-[13px] text-zinc-200 break-words min-w-0">
                        {ev.summary}
                      </span>
                    </div>
                    {ev.location && (
                      <div className="text-[12px] text-zinc-500 mt-0.5 break-words">
                        {ev.location}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** "весь день" для событий на весь день, иначе локальное время начала (ЧЧ:ММ). */
function fmtEventTime(ev: CalEvent): string {
  if (ev.allDay) return "весь день";
  return new Date(ev.start).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Обзор своих задач юзера за видимый месяц с правкой, по дням. Локальный
 *  редактируемый аналог CalendarAgenda выше (та только на чтение). Новые
 *  задачи добавляют в модалке дня, не здесь. */
function TasksSection({
  groups,
  onToggle,
  onRemove,
  onRename,
}: {
  groups: { key: string; date: Date; tasks: Task[] }[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  return (
    <section className="mt-8">
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3">
        Задачи
      </h3>

      {groups.length === 0 ? (
        <p className="text-[13px] text-zinc-600">В этом месяце задач нет</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.key} className="flex gap-3">
              <div className="shrink-0 w-12 pt-1 text-right">
                <div className="text-[14px] font-semibold text-zinc-300 tabular-nums leading-none">
                  {g.date.getDate()}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-600 mt-1">
                  {g.date.toLocaleDateString("ru-RU", { weekday: "short" })}
                </div>
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                {g.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={onToggle}
                    onRemove={onRemove}
                    onRename={onRename}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Одна задача: чекбокс для выполнения, заголовок (клик переименовывает),
 *  необязательное время и удаление, которое всплывает при наведении. */
function TaskRow({
  task,
  onToggle,
  onRemove,
  onRename,
}: {
  task: Task;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(task.title);

  const startEdit = () => {
    setVal(task.title);
    setEditing(true);
  };
  const commit = () => {
    const t = val.trim();
    if (t && t !== task.title) onRename(task.id, t);
    setEditing(false);
  };

  return (
    <div className="group flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2">
      <button
        type="button"
        onClick={() => onToggle(task.id)}
        aria-label={task.done ? "Снять отметку" : "Отметить выполненной"}
        className={cn(
          "shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded border transition-colors",
          task.done
            ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
            : "border-[var(--color-border-strong)] text-transparent hover:border-zinc-400",
        )}
      >
        <Check size={12} strokeWidth={3} />
      </button>

      {task.time && (
        <span className="shrink-0 text-[12px] text-[var(--color-accent)] font-medium tabular-nums">
          {task.time}
        </span>
      )}

      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          className="flex-1 min-w-0 bg-transparent border-b border-[var(--color-border-strong)] text-[13px] text-zinc-100 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className={cn(
            "flex-1 min-w-0 text-left text-[13px] break-words",
            task.done ? "line-through text-zinc-600" : "text-zinc-200",
          )}
        >
          {task.title}
        </button>
      )}

      <button
        type="button"
        onClick={() => onRemove(task.id)}
        aria-label="Удалить задачу"
        className="shrink-0 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
      >
        <Trash2 size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

/** Таймлайн недели на 7 дней (в духе Google Calendar): строка с днями,
 *  необязательная полоса "весь день", затем прокручиваемая сетка на 24 часа.
 *  Клик по пустому слоту (или ПКМ для меню) планирует задачу на этот час, клик
 *  по шапке дня открывает его модалку. */
function WeekView({
  weekDays,
  todayKey,
  tasksByDay,
  eventsByDay,
  onOpenDay,
  onPlan,
  onToggle,
}: {
  weekDays: Date[];
  todayKey: string;
  tasksByDay: Map<string, Task[]>;
  eventsByDay: Map<string, CalEvent[]>;
  onOpenDay: (day: string) => void;
  onPlan: (day: string, time: string | null) => void;
  onToggle: (id: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    day: string;
    hour: number | null;
  } | null>(null);

  // Задачи и события каждой колонки делим на "весь день" и по часам.
  const cols = useMemo(
    () =>
      weekDays.map((date) => {
        const key = toISODate(date);
        const allDay: { tasks: Task[]; events: CalEvent[] } = {
          tasks: [],
          events: [],
        };
        const byHour = new Map<number, { tasks: Task[]; events: CalEvent[] }>();
        const slot = (h: number) => {
          let s = byHour.get(h);
          if (!s) {
            s = { tasks: [], events: [] };
            byHour.set(h, s);
          }
          return s;
        };
        for (const t of tasksByDay.get(key) ?? []) {
          if (t.time) slot(Number(t.time.slice(0, 2))).tasks.push(t);
          else allDay.tasks.push(t);
        }
        for (const ev of eventsByDay.get(key) ?? []) {
          if (ev.allDay) allDay.events.push(ev);
          else slot(new Date(ev.start).getHours()).events.push(ev);
        }
        return { date, key, allDay, byHour };
      }),
    [weekDays, tasksByDay, eventsByDay],
  );

  const hasAllDay = cols.some(
    (c) => c.allDay.tasks.length > 0 || c.allDay.events.length > 0,
  );

  // При смене недели скроллим к текущему часу (если сегодня в кадре) или к ~07:00,
  // оставляя липкую шапку (дни и полосу "весь день") над ним свободной.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const includesToday = weekDays.some((d) => toISODate(d) === todayKey);
    const h = includesToday ? new Date().getHours() : 7;
    const row = el.querySelector<HTMLElement>(`[data-hour="${h}"]`);
    const head = el.querySelector<HTMLElement>("[data-weekhead]");
    if (row) {
      el.scrollTop = Math.max(0, row.offsetTop - (head?.offsetHeight ?? 0) - 8);
    }
  }, [weekDays, todayKey]);

  const openMenu = (e: React.MouseEvent, day: string, hour: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, day, hour });
  };

  const menuItems: ContextMenuItem[] = [];
  if (menu) {
    const { day, hour } = menu;
    if (hour != null) {
      const t = `${pad2(hour)}:00`;
      menuItems.push({
        kind: "item",
        label: `Запланировать в ${t}`,
        icon: Plus,
        onClick: () => onPlan(day, t),
      });
    }
    menuItems.push({
      kind: "item",
      label: "Запланировать на весь день",
      icon: Plus,
      onClick: () => onPlan(day, null),
    });
    menuItems.push({ kind: "separator" });
    menuItems.push({
      kind: "item",
      label: "Открыть день",
      icon: FileText,
      onClick: () => onOpenDay(day),
    });
  }

  const grid7 = "3rem repeat(7, minmax(0, 1fr))";
  const nowHour = new Date().getHours();

  return (
    <div className="flex-1 flex flex-col overflow-hidden px-10 pb-6">
      <div className="flex-1 flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-hidden">
        {/* Шапка (дни и полоса "весь день") и часовая сетка в одной области
            скролла, чтобы колонки не разъезжались: скроллбар срезает ширину у
            всех одинаково. Шапка остаётся липкой. */}
        <div ref={gridRef} className="relative flex-1 overflow-y-auto">
          <div
            data-weekhead
            className="sticky top-0 z-10 bg-[var(--color-bg-elevated)]"
          >
            {/* Шапки дней */}
            <div
              className="grid border-b border-[var(--color-border)]"
              style={{ gridTemplateColumns: grid7 }}
            >
          <div className="border-r border-white/[0.04]" />
          {cols.map((c) => {
            const isToday = c.key === todayKey;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onOpenDay(c.key)}
                onContextMenu={(e) => openMenu(e, c.key, null)}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 border-r border-white/[0.04] last:border-r-0 transition-colors hover:bg-white/[0.03]",
                  isToday && "bg-[rgba(99,102,241,0.06)]",
                )}
              >
                <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-600">
                  {WEEKDAYS[(c.date.getDay() + 6) % 7]}
                </span>
                <span
                  className={cn(
                    "flex items-center justify-center w-6 h-6 rounded-full text-[13px] tabular-nums",
                    isToday
                      ? "bg-[var(--color-accent)] text-white font-semibold"
                      : "text-zinc-300",
                  )}
                >
                  {c.date.getDate()}
                </span>
              </button>
            );
          })}
        </div>

        {/* Полоса "весь день": только если хотя бы у одного дня есть такие дела */}
        {hasAllDay && (
          <div
            className="grid border-b border-[var(--color-border)] shrink-0 max-h-24 overflow-y-auto"
            style={{ gridTemplateColumns: grid7 }}
          >
            <div className="flex items-start justify-end pr-1.5 pt-1.5 border-r border-white/[0.04]">
              <span className="text-[9px] uppercase tracking-wider text-zinc-600 text-right leading-tight">
                весь
                <br />
                день
              </span>
            </div>
            {cols.map((c) => (
              <div
                key={c.key}
                onContextMenu={(e) => openMenu(e, c.key, null)}
                className={cn(
                  "min-h-[2.25rem] p-1 flex flex-col gap-0.5 border-r border-white/[0.04] last:border-r-0",
                  c.key === todayKey && "bg-[rgba(99,102,241,0.04)]",
                )}
              >
                {c.allDay.events.map((ev, i) => (
                  <WeekChip
                    key={`ev-${ev.uid}-${i}`}
                    kind="event"
                    title={ev.summary}
                  />
                ))}
                {c.allDay.tasks.map((t) => (
                  <WeekChip
                    key={t.id}
                    kind="task"
                    title={t.title}
                    done={t.done}
                    onToggle={() => onToggle(t.id)}
                    onClick={() => onOpenDay(c.key)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
          </div>

          {/* Часовая сетка */}
          <div className="grid" style={{ gridTemplateColumns: grid7 }}>
            {HOURS.map((h) => (
              <Fragment key={h}>
                <div
                  data-hour={h}
                  className="h-14 pr-1.5 pt-0.5 text-right text-[11px] tabular-nums text-zinc-600 select-none border-r border-t border-white/[0.04]"
                >
                  {pad2(h)}:00
                </div>
                {cols.map((c) => {
                  const slot = c.byHour.get(h);
                  const isToday = c.key === todayKey;
                  return (
                    <div
                      key={c.key}
                      onClick={() => onPlan(c.key, `${pad2(h)}:00`)}
                      onContextMenu={(e) => openMenu(e, c.key, h)}
                      className={cn(
                        "h-14 p-0.5 flex flex-col gap-0.5 border-r border-t border-white/[0.04] last:border-r-0 overflow-hidden hover:bg-white/[0.03] cursor-pointer",
                        isToday && "bg-[rgba(99,102,241,0.04)]",
                        isToday && h === nowHour && "bg-[rgba(99,102,241,0.09)]",
                      )}
                    >
                      {slot?.events.map((ev, i) => (
                        <WeekChip
                          key={`ev-${ev.uid}-${i}`}
                          kind="event"
                          title={ev.summary}
                          time={fmtEventTime(ev)}
                        />
                      ))}
                      {slot?.tasks.map((t) => (
                        <WeekChip
                          key={t.id}
                          kind="task"
                          title={t.title}
                          time={t.time ?? undefined}
                          done={t.done}
                          onToggle={() => onToggle(t.id)}
                          onClick={() => onOpenDay(c.key)}
                        />
                      ))}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <ContextMenu
        open={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

/** Компактный чип события или задачи в ячейке недельной сетки. У задач есть
 *  мелкий чекбокс, по клику открывают день, события только на чтение. Цвета
 *  заданы литералами rgba (var-opacity Tailwind не всегда нормально парсит). */
function WeekChip({
  kind,
  title,
  time,
  done,
  onToggle,
  onClick,
}: {
  kind: "task" | "event";
  title: string;
  time?: string;
  done?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
}) {
  if (kind === "event") {
    return (
      <div
        title={time ? `${time} · ${title}` : title}
        className="shrink-0 rounded px-1 py-0.5 text-[10.5px] leading-tight truncate bg-[rgba(56,189,248,0.14)] text-sky-200 border border-[rgba(56,189,248,0.22)]"
      >
        {time && <span className="tabular-nums opacity-80">{time} </span>}
        {title}
      </div>
    );
  }
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={time ? `${time} · ${title}` : title}
      className={cn(
        "shrink-0 flex items-center gap-1 rounded px-1 py-0.5 text-[10.5px] leading-tight cursor-pointer",
        done
          ? "bg-[rgba(99,102,241,0.10)] text-zinc-500"
          : "bg-[rgba(99,102,241,0.18)] text-indigo-100 border border-[rgba(99,102,241,0.28)]",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label={done ? "Снять отметку" : "Отметить выполненной"}
        className={cn(
          "shrink-0 flex items-center justify-center w-3 h-3 rounded-[3px] border transition-colors",
          done
            ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
            : "border-zinc-500 text-transparent hover:border-zinc-300",
        )}
      >
        <Check size={8} strokeWidth={3.5} />
      </button>
      {time && <span className="tabular-nums opacity-80 shrink-0">{time}</span>}
      <span className={cn("truncate", done && "line-through")}>{title}</span>
    </div>
  );
}

/** Детали дня: часовой таймлайн задач дня и внешних событий. ПКМ по слоту
 *  открывает меню, чтобы добавить задачу на этот час или на весь день.
 *  Добавление теперь живёт тут, а не в форме снизу. */
function DayDetailModal({
  date,
  isToday,
  autoAdd,
  tasks,
  events,
  onClose,
  onAdd,
  onToggle,
  onRemove,
  onRename,
  onOpenDailyNote,
}: {
  date: Date;
  isToday: boolean;
  autoAdd: { time: string | null } | null;
  tasks: Task[];
  events: CalEvent[];
  onClose: () => void;
  onAdd: (time: string | null, title: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenDailyNote: () => void;
}) {
  const hoursRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    hour: number | null;
  } | null>(null);
  // Что сейчас добавляем, если добавляем: `time` это `ЧЧ:00` или null (весь день).
  // Взводится заранее (из `autoAdd`), если пришли через "Запланировать" с сетки/недели.
  const [adding, setAdding] = useState<{ time: string | null } | null>(autoAdd);

  // Раскладываем задачи и события дня по слотам "весь день" и по часам.
  const { allDayTasks, allDayEvents, byHour } = useMemo(() => {
    const allDayTasks: Task[] = [];
    const allDayEvents: CalEvent[] = [];
    const byHour = new Map<number, { tasks: Task[]; events: CalEvent[] }>();
    const slot = (h: number) => {
      let s = byHour.get(h);
      if (!s) {
        s = { tasks: [], events: [] };
        byHour.set(h, s);
      }
      return s;
    };
    for (const t of tasks) {
      if (t.time) slot(Number(t.time.slice(0, 2))).tasks.push(t);
      else allDayTasks.push(t);
    }
    for (const ev of events) {
      if (ev.allDay) allDayEvents.push(ev);
      else slot(new Date(ev.start).getHours()).events.push(ev);
    }
    return { allDayTasks, allDayEvents, byHour };
  }, [tasks, events]);

  // Закрытие по Esc, но сначала даём контекстному меню обработать свой Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !menu) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu, onClose]);

  // При открытии скроллим таймлайн к взведённому часу добавления, иначе к
  // текущему часу (если сегодня), иначе к ~07:00.
  useEffect(() => {
    const el = hoursRef.current;
    if (!el) return;
    const h = autoAdd?.time
      ? Number(autoAdd.time.slice(0, 2))
      : isToday
        ? new Date().getHours()
        : 7;
    const row = el.querySelector<HTMLElement>(`[data-hour="${h}"]`);
    if (row) el.scrollTop = Math.max(0, row.offsetTop - 8);
  }, [isToday, autoAdd]);

  const openMenu = (e: React.MouseEvent, hour: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, hour });
  };

  const startAdd = (time: string | null) => {
    setAdding({ time });
    setMenu(null);
  };
  const commitAdd = (title: string) => {
    if (adding && title.trim()) onAdd(adding.time, title.trim());
    setAdding(null);
  };

  const menuItems: ContextMenuItem[] = [];
  if (menu) {
    if (menu.hour != null) {
      const t = `${pad2(menu.hour)}:00`;
      menuItems.push({
        kind: "item",
        label: `Запланировать в ${t}`,
        icon: Plus,
        onClick: () => startAdd(t),
      });
    }
    menuItems.push({
      kind: "item",
      label: "Запланировать на весь день",
      icon: Plus,
      onClick: () => startAdd(null),
    });
  }

  const fullDate = date.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const nowHour = isToday ? new Date().getHours() : -1;
  const addingAllDay = adding != null && adding.time === null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        style={{ zIndex: Z_DAY_MODAL }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 6 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md max-h-[82vh] flex flex-col rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-overlay)] shadow-2xl shadow-black/60 overflow-hidden"
        >
          {/* Шапка */}
          <div className="shrink-0 px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-zinc-100 capitalize truncate">
                {fullDate}
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenDailyNote}
              className="shrink-0 flex items-center gap-1.5 text-[12px] text-zinc-300 hover:text-zinc-100 px-2.5 py-1.5 rounded-md hover:bg-white/[0.06] transition-colors font-medium"
            >
              <FileText size={13} strokeWidth={2} />
              Заметка дня
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {/* Секция "весь день" */}
          <div
            onContextMenu={(e) => openMenu(e, null)}
            className="shrink-0 px-4 py-2.5 border-b border-[var(--color-border)]"
          >
            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-600 mb-1.5">
              Весь день
            </div>
            <div className="flex flex-col gap-1.5">
              {allDayEvents.map((ev, i) => (
                <EventChip key={`ev-${ev.uid}-${i}`} event={ev} />
              ))}
              {allDayTasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onRename={onRename}
                />
              ))}
              {addingAllDay && (
                <InlineAdd onCommit={commitAdd} onCancel={() => setAdding(null)} />
              )}
              {allDayEvents.length === 0 &&
                allDayTasks.length === 0 &&
                !addingAllDay && (
                  <div className="text-[12px] text-zinc-600 select-none">,</div>
                )}
            </div>
          </div>

          {/* Часовой таймлайн */}
          <div ref={hoursRef} className="relative flex-1 overflow-y-auto">
            {HOURS.map((h) => {
              const slot = byHour.get(h);
              const addingHere = adding != null && adding.time === `${pad2(h)}:00`;
              return (
                <div
                  key={h}
                  data-hour={h}
                  onContextMenu={(e) => openMenu(e, h)}
                  className="flex gap-2 px-4 py-1 min-h-[2rem] border-b border-white/[0.04] hover:bg-white/[0.02]"
                >
                  <div
                    className={cn(
                      "shrink-0 w-10 pt-1 text-right text-[11px] tabular-nums select-none",
                      h === nowHour
                        ? "text-[var(--color-accent)] font-semibold"
                        : "text-zinc-600",
                    )}
                  >
                    {pad2(h)}:00
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1 py-0.5">
                    {slot?.events.map((ev, i) => (
                      <EventChip key={`ev-${ev.uid}-${i}`} event={ev} />
                    ))}
                    {slot?.tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onToggle={onToggle}
                        onRemove={onRemove}
                        onRename={onRename}
                      />
                    ))}
                    {addingHere && (
                      <InlineAdd
                        onCommit={commitAdd}
                        onCancel={() => setAdding(null)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>

      <ContextMenu
        open={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </>
  );
}

/** Внешнее событие календаря (Яндекс и прочие) в модалке дня, только чтение. */
function EventChip({ event }: { event: CalEvent }) {
  return (
    <div className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2.5 py-1">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[11px] text-sky-300/90 font-medium tabular-nums">
          {fmtEventTime(event)}
        </span>
        <span className="text-[12.5px] text-zinc-200 break-words min-w-0">
          {event.summary}
        </span>
      </div>
      {event.location && (
        <div className="text-[11px] text-zinc-500 mt-0.5 break-words">
          {event.location}
        </div>
      )}
    </div>
  );
}

/** Временный инлайн-инпут для добавления задачи: пишет по Enter/blur, отменяет
 *  по Esc или если пусто. Реф `done` страхует от двойного сохранения, когда за
 *  Enter идёт blur на размонтировании. */
function InlineAdd({
  onCommit,
  onCancel,
}: {
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState("");
  const done = useRef(false);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && val.trim()) onCommit(val);
    else onCancel();
  };

  return (
    <input
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      placeholder="Запланировать дело…"
      className="w-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)] rounded-md px-2.5 py-1 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
    />
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Парсит ключ дня `YYYY-MM-DD` в локальный Date (полночь). */
function dateOfDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Понедельник 00:00 недели, в которую попадает `d` (локально). */
function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (r.getDay() + 6) % 7; // Пн=0 .. Вс=6
  r.setDate(r.getDate() - offset);
  return r;
}

/** Подпись недели в духе "30 июн - 6 июл 2025" (схлопывает общий месяц/год). */
function weekRangeLabel(days: Date[]): string {
  const a = days[0];
  const b = days[6];
  const day = (d: Date) => d.getDate();
  const mon = (d: Date) =>
    d.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
  if (a.getFullYear() !== b.getFullYear()) {
    return `${day(a)} ${mon(a)} ${a.getFullYear()} - ${day(b)} ${mon(b)} ${b.getFullYear()}`;
  }
  if (a.getMonth() !== b.getMonth()) {
    return `${day(a)} ${mon(a)} - ${day(b)} ${mon(b)} ${b.getFullYear()}`;
  }
  return `${day(a)} - ${day(b)} ${mon(b)} ${b.getFullYear()}`;
}

/** Вкладка сегментированного переключателя месяц/неделя. */
function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
        active
          ? "bg-[var(--color-accent)] text-white shadow-sm"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]",
      )}
    >
      {children}
    </button>
  );
}

function NavBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
    >
      {children}
    </button>
  );
}

function pluralDays(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "дня";
  return "дней";
}

function pluralNotes(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "заметка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "заметки";
  return "заметок";
}

function pluralTasks(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "задача";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "задачи";
  return "задач";
}
