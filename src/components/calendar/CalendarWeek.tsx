import { BookOpen, Check, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dateFromDay, type CalendarDay } from "../../lib/calendarModel";
import { t } from "../../lib/i18n";
import type { CalEvent } from "../../lib/ics";
import { isTaskDoneOn, type Task } from "../../lib/tasks";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourTime = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export function CalendarWeek({ days, today, selected, locale, onSelect, onPlan }: { days: CalendarDay[]; today: string; selected: string; locale: string; onSelect: (day: string) => void; onPlan: (day: string, time: string | null) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(`${selected}/9`);
  const from = days[0]?.key;
  const columns = useMemo(() => days.map(day => {
    const start = dateFromDay(day.key).getTime();
    const allTasks: Task[] = [], allEvents: CalEvent[] = [];
    const hours = new Map<number, { tasks: Task[]; events: CalEvent[] }>();
    const slot = (hour: number) => { let value = hours.get(hour); if (!value) { value = { tasks: [], events: [] }; hours.set(hour, value); } return value; };
    for (const task of day.tasks) { if (task.time) slot(Number(task.time.slice(0, 2))).tasks.push(task); else allTasks.push(task); }
    for (const event of day.events) { if (event.allDay || event.start < start) allEvents.push(event); else slot(new Date(event.start).getHours()).events.push(event); }
    return { ...day, allTasks, allEvents, hours };
  }), [days]);
  const focusInRange = days.some(day => focus.startsWith(day.key + "/"));
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const hour = days.some(day => day.key === today) ? Math.max(0, new Date().getHours() - 1) : 8;
    const row = element.querySelector<HTMLElement>(`[data-week-hour="${hour}"]`);
    if (row) element.scrollTop = Math.max(0, row.offsetTop - 8);
  }, [from, today]);
  const dateFormat = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return <div className="calendar-week" aria-label={t("План недели")}>
    <div className="calendar-week-head"><span className="calendar-week-zone">{t("Часы")}</span>{days.map(day => <button type="button" key={day.key} className={`calendar-week-date${day.key === selected ? " is-selected" : ""}${day.key === today ? " is-today" : ""}`} aria-pressed={day.key === selected} onClick={() => onSelect(day.key)}><span>{dateFormat.format(dateFromDay(day.key))}</span><strong>{dateFromDay(day.key).getDate()}</strong>{day.notes.length ? <small><BookOpen size={11} aria-hidden="true" />{day.notes.length}</small> : <small />}</button>)}</div>
    <div className="calendar-week-all-day"><span className="calendar-week-zone">{t("Весь день")}</span>{columns.map(day => {
      const tasks = day.allTasks, events = day.allEvents;
      return <div key={day.key} className="calendar-week-all-cell">{tasks.slice(0, 2).map(task => <button key={task.id} type="button" className="calendar-week-chip is-task" onClick={() => onSelect(day.key)}>{isTaskDoneOn(task, day.key) ? <Check size={11} aria-hidden="true" /> : null}{task.title}</button>)}{events.slice(0, 1).map(event => <button key={`${event.uid}/${event.start}`} type="button" className="calendar-week-chip is-event" onClick={() => onSelect(day.key)}>{event.summary}</button>)}{tasks.length + events.length > Math.min(tasks.length, 2) + Math.min(events.length, 1) ? <button type="button" className="calendar-more" onClick={() => onSelect(day.key)}>{t("Ещё {n}", { n: tasks.length + events.length - Math.min(tasks.length, 2) - Math.min(events.length, 1) })}</button> : null}<button type="button" className="calendar-week-add" aria-label={t("Задача на весь день: {day}", { day: day.key })} onClick={() => onPlan(day.key, null)}><Plus size={12} aria-hidden="true" /></button></div>;
    })}</div>
    <div className="calendar-week-scroll" ref={scroller}><div className="calendar-week-hours" role="grid" aria-label={t("Часовая сетка недели")}>
      {HOURS.map(hour => <div className="calendar-week-hour-row" role="row" key={hour}><span className="calendar-week-zone" role="rowheader" data-week-hour={hour}>{hourTime(hour)}</span>{columns.map(day => {
        const tasks = day.hours.get(hour)?.tasks ?? [], events = day.hours.get(hour)?.events ?? [];
        const slot = `${day.key}/${hour}`;
        return <div role="gridcell" key={day.key} className={`calendar-week-slot${day.key === today ? " is-today" : ""}`}><button type="button" tabIndex={slot === focus || (!focusInRange && day.key === days[0]?.key && hour === 9) ? 0 : -1} className="calendar-week-slot-hit" data-slot={slot} aria-label={t("Запланировать: {day}, {time}", { day: day.key, time: hourTime(hour) })} onFocus={() => setFocus(slot)} onClick={() => onPlan(day.key, hourTime(hour))} onKeyDown={event => {
          const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (!horizontal && !vertical) return;
          event.preventDefault(); const index = days.findIndex(value => value.key === day.key), nextDay = days[Math.max(0, Math.min(6, index + horizontal))];
          const next = `${nextDay.key}/${Math.max(0, Math.min(23, hour + vertical))}`;
          setFocus(next); scroller.current?.querySelector<HTMLButtonElement>(`[data-slot="${next}"]`)?.focus();
        }} /><div className="calendar-week-slot-items">{tasks.slice(0, 2).map(task => <button key={task.id} type="button" className={`calendar-week-chip is-task${isTaskDoneOn(task, day.key) ? " is-done" : ""}`} onClick={() => onSelect(day.key)}><span>{task.time}</span>{task.title}</button>)}{events.slice(0, 1).map(event => <button key={`${event.uid}/${event.start}`} type="button" className="calendar-week-chip is-event" onClick={() => onSelect(day.key)}>{event.summary}</button>)}{tasks.length + events.length > Math.min(tasks.length, 2) + Math.min(events.length, 1) ? <button type="button" className="calendar-more" onClick={() => onSelect(day.key)}>+{tasks.length + events.length - Math.min(tasks.length, 2) - Math.min(events.length, 1)}</button> : null}</div></div>;
      })}</div>)}
    </div></div>
  </div>;
}
