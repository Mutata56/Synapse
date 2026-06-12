import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Flame,
  HelpCircle,
  Plus,
  Repeat,
  RefreshCw,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { dailyDateOf, dayKey, toISODate } from "../lib/daily";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { expandEvents, type CalEvent } from "../lib/ics";
import { t } from "../lib/i18n";
import { moodColor, moodFace } from "../lib/mood";
import {
  compareTasks,
  isTaskDoneOn,
  occurrencesInRange,
  type Recurrence,
  type RecurrenceFreq,
  type Task,
} from "../lib/tasks";
import { FOLDER_COLORS } from "../lib/folderColors";

/** Частичная правка задачи из UI календаря (уходит в стор `update`). */
type TaskPatch = Partial<Pick<Task, "title" | "repeat" | "color" | "tags">>;
import { flattenNotes } from "../lib/treeUtils";
import { useCalendarStore } from "../store/calendar";
import { useNotesStore } from "../store/notes";
import { useTasksStore } from "../store/tasks";
import { useToastStore } from "../store/toasts";
import { pushAll } from "../lib/caldav";
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
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);

  // Внешний календарь поверх (только чтение): Яндекс и прочие через фид iCalendar.
  const calendarUrl = useNotesStore((s) => s.settings.calendarIcsUrl);
  const caldavLogin = useNotesStore((s) => s.settings.caldavLogin);
  const caldavPassword = useNotesStore((s) => s.settings.caldavPassword);
  const caldavUrl = useNotesStore((s) => s.settings.caldavUrl);
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
  const [datePickOpen, setDatePickOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
    // Видимый диапазон: сетка месяца (6 недель) или текущая неделя. Повторы
    // разворачиваем только на него, бесконечные вхождения не плодим.
    let fromIso: string;
    let toIso: string;
    if (mode === "week") {
      const ws = startOfWeek(weekAnchor);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      fromIso = toISODate(ws);
      toIso = toISODate(we);
    } else {
      const gridStart = startOfWeek(new Date(cursor.y, cursor.m, 1));
      const gridEnd = new Date(gridStart);
      gridEnd.setDate(gridStart.getDate() + 41);
      fromIso = toISODate(gridStart);
      toIso = toISODate(gridEnd);
    }
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      for (const day of occurrencesInRange(t, fromIso, toIso)) {
        const arr = m.get(day);
        if (arr) arr.push(t);
        else m.set(day, [t]);
      }
    }
    return m;
  }, [tasks, mode, cursor, weekAnchor]);

  // Задачи видимого месяца, сгруппированы по дням для редактируемой повестки.
  const monthTaskGroups = useMemo(() => {
    const fromIso = toISODate(new Date(cursor.y, cursor.m, 1));
    const toIso = toISODate(new Date(cursor.y, cursor.m + 1, 0));
    const byDay = new Map<string, Task[]>();
    for (const t of tasks) {
      // Повтор в списке не дублируем: одна запись на задачу, на её первое
      // вхождение в месяце. На сетке дни всё равно отмечаются (см. tasksByDay).
      const occ = occurrencesInRange(t, fromIso, toIso);
      if (occ.length === 0) continue;
      const day = occ[0];
      const arr = byDay.get(day);
      if (arr) arr.push(t);
      else byDay.set(day, [t]);
    }
    return [...byDay.keys()].sort().map((day) => ({
      key: day,
      date: dateOfDay(day),
      tasks: byDay.get(day)!.slice().sort(compareTasks),
    }));
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

  // Пуш всех задач в Яндекс.Календарь по CalDAV. Кнопка видна, только когда
  // настроены логин, пароль и календарь (см. Настройки).
  const caldavReady = Boolean(caldavLogin && caldavPassword && caldavUrl);
  const pushToYandex = async () => {
    if (!caldavReady) return;
    setPushing(true);
    try {
      const res = await pushAll(
        { login: caldavLogin, password: caldavPassword, url: caldavUrl },
        tasks,
      );
      if (res.failed.length === 0) {
        useToastStore.getState().push(`Отправлено в Яндекс: ${res.ok}`, "success");
      } else {
        useToastStore
          .getState()
          .push(
            `Отправлено ${res.ok}, ошибок ${res.failed.length}: ${res.failed[0].error}`,
            "error",
          );
      }
    } finally {
      setPushing(false);
    }
  };

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
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title={t("Как пользоваться календарём")}
            aria-label={t("Подсказка")}
            className="flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
          >
            <HelpCircle size={15} strokeWidth={2} />
          </button>
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
          {caldavReady && (
            <button
              type="button"
              onClick={() => void pushToYandex()}
              disabled={pushing}
              title="Отправить задачи в Яндекс.Календарь"
              aria-label="Отправить в Яндекс"
              className="flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors disabled:opacity-50"
            >
              <Upload
                size={14}
                strokeWidth={2}
                className={cn(pushing && "animate-pulse")}
              />
            </button>
          )}
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
            <div className="relative min-w-0">
              <button
                type="button"
                onClick={() => setDatePickOpen((v) => !v)}
                title="Перейти к дате"
                className="flex items-center gap-1.5 max-w-full text-lg font-semibold text-zinc-200 hover:text-white transition-colors"
              >
                <span className="truncate">
                  {mode === "week" ? weekLabel : `${MONTHS[cursor.m]} ${cursor.y}`}
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={2}
                  className="shrink-0 text-zinc-500"
                />
              </button>
              {datePickOpen && (
                <DatePickerPopover
                  initial={
                    mode === "week" ? weekAnchor : new Date(cursor.y, cursor.m, 1)
                  }
                  onPick={(d) => {
                    setCursor({ y: d.getFullYear(), m: d.getMonth() });
                    setWeekAnchor(d);
                    setDatePickOpen(false);
                  }}
                  onClose={() => setDatePickOpen(false)}
                />
              )}
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
          onToggle={(id, date) => void toggleTask(id, date)}
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
            onToggle={(id, date) => void toggleTask(id, date)}
            onRemove={(id) => void removeTask(id)}
            onRename={(id, title) => void updateTask(id, { title })}
            onPatch={(id, patch) => void updateTask(id, patch)}
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

      {helpOpen && <CalendarHelpModal onClose={() => setHelpOpen(false)} />}

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
            onToggle={(id, date) => void toggleTask(id, date)}
            onRemove={(id) => void removeTask(id)}
            onRename={(id, title) => void updateTask(id, { title })}
            onPatch={(id, patch) => void updateTask(id, patch)}
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
  onPatch,
}: {
  groups: { key: string; date: Date; tasks: Task[] }[];
  onToggle: (id: string, date: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPatch: (id: string, patch: TaskPatch) => void;
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
                    date={g.key}
                    onToggle={onToggle}
                    onRemove={onRemove}
                    onRename={onRename}
                    onPatch={onPatch}
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

const REPEAT_FREQS: { freq: RecurrenceFreq; label: string; unit: string }[] = [
  { freq: "daily", label: "День", unit: "дн." },
  { freq: "weekly", label: "Неделя", unit: "нед." },
  { freq: "monthly", label: "Месяц", unit: "мес." },
];

/** Короткая подпись повтора для строки задачи, или null если разовая. */
function repeatShort(rep: Recurrence | null | undefined): string | null {
  if (!rep) return null;
  if (rep.freq === "daily") {
    return rep.every === 1 ? "каждый день" : `каждые ${rep.every} дн.`;
  }
  if (rep.freq === "weekly") {
    return rep.every === 1 ? "каждую нед." : `каждые ${rep.every} нед.`;
  }
  return rep.every === 1 ? "каждый мес." : `каждые ${rep.every} мес.`;
}

/** Видимый контрол повтора: чип со статусом + поповер (день/неделя/месяц и
 *  свой интервал «каждые N»). */
function RepeatPicker({
  repeat,
  onChange,
}: {
  repeat: Recurrence | null | undefined;
  onChange: (repeat: Recurrence | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const freq = repeat?.freq ?? "daily";
  const every = repeat?.every ?? 1;
  const unit = REPEAT_FREQS.find((f) => f.freq === freq)?.unit ?? "дн.";

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4 });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        title="Повтор"
        className={cn(
          "shrink-0 flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors",
          repeat
            ? "text-[var(--color-accent)] hover:bg-[var(--color-accent-bg)]"
            : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.05]",
        )}
      >
        <Repeat size={12} strokeWidth={2} />
        {repeat ? repeatShort(repeat) : "повтор"}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[290]"
            onClick={() => setOpen(false)}
          />
          <div
            style={{ left: pos.x, top: pos.y, zIndex: 300 }}
            className="fixed w-56 p-2.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-float)]"
          >
            <div className="flex items-center gap-1 mb-2">
              {REPEAT_FREQS.map((f) => (
                <button
                  key={f.freq}
                  type="button"
                  onClick={() => onChange({ freq: f.freq, every })}
                  className={cn(
                    "flex-1 text-[12px] py-1 rounded-md border transition-colors",
                    repeat && freq === f.freq
                      ? "border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-zinc-300 hover:bg-white/[0.05]",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-zinc-400">
              <span>каждые</span>
              <input
                type="number"
                min={1}
                max={99}
                value={every}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  if (n >= 1) onChange({ freq, every: n });
                }}
                className="w-14 bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] rounded px-1.5 py-0.5 text-[12px] text-zinc-100 text-center focus:outline-none"
              />
              <span>{unit}</span>
            </div>
            {repeat && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full mt-2 text-[12px] text-zinc-400 hover:text-red-300 py-1 rounded-md hover:bg-white/[0.05] transition-colors"
              >
                Не повторять
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Поповер цвета и меток задачи: палитра-кружки + свободные текстовые метки. */
function TagColorPicker({
  color,
  tags,
  onSetColor,
  onSetTags,
}: {
  color: string | null | undefined;
  tags: string[];
  onSetColor: (color: string | null) => void;
  onSetTags: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4 });
    setOpen(true);
  };

  const addTag = () => {
    const tag = draft.trim().replace(/^#+/, "").trim();
    if (tag && !tags.includes(tag)) onSetTags([...tags, tag]);
    setDraft("");
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        title="Цвет и метки"
        className={cn(
          "shrink-0 transition-colors",
          color || tags.length > 0
            ? "text-zinc-300"
            : "text-zinc-500 hover:text-zinc-300",
        )}
      >
        {color ? (
          <span
            className="block w-3.5 h-3.5 rounded-full border border-black/30"
            style={{ backgroundColor: color }}
          />
        ) : (
          <Tag size={13} strokeWidth={2} />
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[290]"
            onClick={() => setOpen(false)}
          />
          <div
            style={{ left: pos.x, top: pos.y, zIndex: 300 }}
            className="fixed w-60 p-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-float)]"
          >
            <div className="text-[11px] text-zinc-500 mb-1.5">Цвет</div>
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <button
                type="button"
                onClick={() => onSetColor(null)}
                title="По умолчанию"
                className={cn(
                  "w-5 h-5 rounded-full border flex items-center justify-center transition-transform hover:scale-110",
                  !color
                    ? "border-white/70 ring-1 ring-white/40"
                    : "border-white/20",
                )}
              >
                <X size={11} strokeWidth={2.4} className="text-zinc-400" />
              </button>
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => onSetColor(c.hex)}
                  title={c.label}
                  style={{ backgroundColor: c.hex }}
                  className={cn(
                    "w-5 h-5 rounded-full border transition-transform hover:scale-110",
                    color === c.hex
                      ? "border-white ring-2 ring-white/50"
                      : "border-black/20",
                  )}
                />
              ))}
            </div>

            <div className="text-[11px] text-zinc-500 mb-1.5">Метки</div>
            {tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-300 bg-white/[0.06] rounded px-1.5 py-0.5"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => onSetTags(tags.filter((x) => x !== tag))}
                      aria-label={`Убрать метку ${tag}`}
                      className="text-zinc-500 hover:text-red-300"
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
              placeholder="Добавить метку…"
              className="w-full bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] rounded px-2 py-1 text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
          </div>
        </>
      )}
    </>
  );
}

/** Одна задача: чекбокс выполнения (у повтора по дате `date`), заголовок
 *  (клик переименовывает), время, цвет+метки, повтор и удаление. */
function TaskRow({
  task,
  date,
  onToggle,
  onRemove,
  onRename,
  onPatch,
}: {
  task: Task;
  date: string;
  onToggle: (id: string, date: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPatch: (id: string, patch: TaskPatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(task.title);

  const done = isTaskDoneOn(task, date);

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
    <div
      className="group flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2"
      style={
        task.color
          ? { borderLeftColor: task.color, borderLeftWidth: 3 }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => onToggle(task.id, date)}
        aria-label={done ? "Снять отметку" : "Отметить выполненной"}
        className={cn(
          "shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded border transition-colors",
          done
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
            done ? "line-through text-zinc-600" : "text-zinc-200",
          )}
        >
          {task.title}
        </button>
      )}

      {task.tags && task.tags.length > 0 && (
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] text-zinc-400 bg-white/[0.05] rounded px-1.5 py-0.5"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <TagColorPicker
        color={task.color}
        tags={task.tags ?? []}
        onSetColor={(c) => onPatch(task.id, { color: c })}
        onSetTags={(tg) => onPatch(task.id, { tags: tg })}
      />

      <RepeatPicker
        repeat={task.repeat}
        onChange={(r) => onPatch(task.id, { repeat: r })}
      />

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
  onToggle: (id: string, date: string) => void;
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
                    color={t.color ?? undefined}
                    allDay
                    repeating={t.repeat != null}
                    done={isTaskDoneOn(t, c.key)}
                    onToggle={() => onToggle(t.id, c.key)}
                    onClick={() => onOpenDay(c.key)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
          </div>

          {/* Часовая сетка */}
          <div className="relative grid" style={{ gridTemplateColumns: grid7 }}>
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
                          color={t.color ?? undefined}
                          repeating={t.repeat != null}
                          done={isTaskDoneOn(t, c.key)}
                          onToggle={() => onToggle(t.id, c.key)}
                          onClick={() => onOpenDay(c.key)}
                        />
                      ))}
                    </div>
                  );
                })}
              </Fragment>
            ))}
            {/* Плёнка "весь день": полупрозрачная полоса на всю высоту колонки
                для дней, где есть дела на весь день. Лежит под чипами и не ловит
                клики, так что часы под ней кликаются как обычно. */}
            <div className="pointer-events-none absolute inset-0 flex">
              <div className="w-12 shrink-0" />
              {cols.map((c) => (
                <div
                  key={c.key}
                  className={cn(
                    "flex-1",
                    c.allDay.tasks.length > 0 &&
                      "bg-[rgba(245,158,11,0.08)] border-l-2 border-[rgba(245,158,11,0.55)]",
                  )}
                />
              ))}
            </div>
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
  allDay,
  repeating,
  color,
  onToggle,
  onClick,
}: {
  kind: "task" | "event";
  title: string;
  time?: string;
  done?: boolean;
  allDay?: boolean;
  repeating?: boolean;
  color?: string;
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
      style={color && !done ? { borderLeftColor: color } : undefined}
      className={cn(
        "shrink-0 flex items-center gap-1.5 rounded-md border-l-2 pl-1 pr-1.5 py-1 text-[10.5px] leading-tight cursor-pointer",
        done
          ? "bg-[rgba(99,102,241,0.06)] text-zinc-500 border-l-[rgba(99,102,241,0.35)]"
          : allDay
            ? "bg-[rgba(245,158,11,0.16)] text-amber-100 border-l-[rgba(245,158,11,0.75)]"
            : "bg-[rgba(99,102,241,0.14)] text-indigo-100 border-l-[var(--color-accent)]",
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
      <span className={cn("truncate flex-1", done && "line-through")}>
        {title}
      </span>
      {repeating && (
        <Repeat size={9} strokeWidth={2.5} className="shrink-0 opacity-70" />
      )}
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
  onPatch,
  onOpenDailyNote,
}: {
  date: Date;
  isToday: boolean;
  autoAdd: { time: string | null } | null;
  tasks: Task[];
  events: CalEvent[];
  onClose: () => void;
  onAdd: (time: string | null, title: string) => void;
  onToggle: (id: string, date: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPatch: (id: string, patch: TaskPatch) => void;
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
                  date={toISODate(date)}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onRename={onRename}
                  onPatch={onPatch}
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
                        date={toISODate(date)}
                        onToggle={onToggle}
                        onRemove={onRemove}
                        onRename={onRename}
                        onPatch={onPatch}
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

/** Поповер прыжка к дате: мини-календарь со стрелками месяц/год, клик по дню
 *  переносит и месячный, и недельный вид на эту дату. */
function DatePickerPopover({
  initial,
  onPick,
  onClose,
}: {
  initial: Date;
  onPick: (date: Date) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const y = view.getFullYear();
  const m = view.getMonth();
  const shift = (dM: number, dY: number) => setView(new Date(y + dY, m + dM, 1));

  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Пн=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const now = new Date();
  const isToday = (d: number) =>
    y === now.getFullYear() && m === now.getMonth() && d === now.getDate();

  return (
    <>
      <div className="fixed inset-0 z-[290]" onClick={onClose} />
      <div className="absolute left-0 top-full mt-2 z-[300] w-64 p-3 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-float)]">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-0.5">
            <PickerNav onClick={() => shift(0, -1)} label="Предыдущий год">
              <ChevronsLeft size={15} strokeWidth={2} />
            </PickerNav>
            <PickerNav onClick={() => shift(-1, 0)} label="Предыдущий месяц">
              <ChevronLeft size={15} strokeWidth={2} />
            </PickerNav>
          </div>
          <div className="text-[13px] font-semibold text-zinc-200 tabular-nums">
            {MONTHS[m]} {y}
          </div>
          <div className="flex items-center gap-0.5">
            <PickerNav onClick={() => shift(1, 0)} label="Следующий месяц">
              <ChevronRight size={15} strokeWidth={2} />
            </PickerNav>
            <PickerNav onClick={() => shift(0, 1)} label="Следующий год">
              <ChevronsRight size={15} strokeWidth={2} />
            </PickerNav>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-[9px] uppercase tracking-wider text-zinc-600 text-center"
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((d, i) =>
            d == null ? (
              <div key={i} />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => onPick(new Date(y, m, d))}
                className={cn(
                  "h-7 rounded-md text-[12px] tabular-nums transition-colors",
                  isToday(d)
                    ? "bg-[var(--color-accent)] text-white font-semibold"
                    : "text-zinc-300 hover:bg-white/[0.06]",
                )}
              >
                {d}
              </button>
            ),
          )}
        </div>
      </div>
    </>
  );
}

function PickerNav({
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
      className="p-1 rounded-md text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
    >
      {children}
    </button>
  );
}

/** Модалка-подсказка по календарю: как пользоваться, подписка iCal и пуш CalDAV.
 *  Весь текст через t(), так что язык следует за интерфейсом. */
function CalendarHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[82vh] flex flex-col rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-overlay)] shadow-2xl shadow-black/60 overflow-hidden"
      >
        <div className="shrink-0 px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-zinc-100">
            {t("Как пользоваться календарём")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Закрыть")}
            className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-5 text-[13px] text-zinc-300 leading-relaxed">
          <HelpBlock title={t("Задачи")}>
            <p>
              {t(
                "Кликните по дню, чтобы добавить дело: без времени - на весь день, со временем - в часовую сетку.",
              )}
            </p>
            <p>
              {t(
                "Месяц и Неделя переключаются кнопками сверху. Клик по заголовку с датой открывает выбор любой даты.",
              )}
            </p>
            <p>{t("Галочка слева отмечает выполнение.")}</p>
          </HelpBlock>

          <HelpBlock title={t("Повторы, цвета и метки")}>
            <p>
              {t(
                "Повтор: кнопка повтора на задаче - день, неделя или месяц и свой интервал «каждые N».",
              )}
            </p>
            <p>
              {t(
                "Цвет и метки: кнопка-метка на задаче - цвет из палитры и произвольные теги.",
              )}
            </p>
          </HelpBlock>

          <HelpBlock title={t("Подписка на календарь (iCal, только чтение)")}>
            <p>
              {t(
                "Настройки → Календарь: вставьте приватную ссылку iCal (.ics), например из Яндекс.Календаря. Чужие события лягут поверх календаря, без изменения.",
              )}
            </p>
          </HelpBlock>

          <HelpBlock title={t("Пуш в Яндекс.Календарь (CalDAV)")}>
            <p>
              {t(
                "Настройки → Пуш в Яндекс.Календарь: укажите логин и пароль приложения (id.yandex.ru → Пароли приложений → CalDAV), нажмите «Найти календари» и выберите календарь.",
              )}
            </p>
            <p>
              {t(
                "Кнопка отправки вверху календаря шлёт ваши задачи как события. Повторная отправка обновляет их.",
              )}
            </p>
            <p className="text-zinc-500">
              {t(
                "Разница: подписка iCal - только чтение (видеть чужой календарь), CalDAV - запись (отправлять свои задачи в Яндекс).",
              )}
            </p>
          </HelpBlock>
        </div>
      </div>
    </div>
  );
}

function HelpBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[12px] uppercase tracking-wider font-semibold text-zinc-500">
        {title}
      </h3>
      {children}
    </section>
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
