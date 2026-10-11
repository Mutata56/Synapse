import { dailyDateOf, dayKey, toISODate } from "./daily";
import { expandEvents, type CalEvent, type ParsedEvent } from "./ics";
import type { NoteMeta, TreeNode } from "./storage";
import { isValidDay, isTaskDoneOn, occurrencesInRange, type Task } from "./tasks";

export type CalendarMode = "month" | "week" | "agenda";
export type CalendarFilters = { tasks: boolean; events: boolean; notes: boolean; completed: boolean; query: string };
export type CalendarNoteIndex = { byDay: Map<string, NoteMeta[]>; journals: Map<string, NoteMeta>; anniversaries: Map<string, NoteMeta[]> };
export type CalendarRange = { days: string[]; from: string; to: string; month: string; monthFrom: string; monthTo: string };
export type CalendarDay = { key: string; notes: NoteMeta[]; tasks: Task[]; events: CalEvent[]; journal?: NoteMeta };

const noteIndexes = new WeakMap<TreeNode[], CalendarNoteIndex>();
const taskIndexes = new WeakMap<Task[], Map<string, Map<string, Task[]>>>();
const eventIndexes = new WeakMap<ParsedEvent[], Map<string, Map<string, CalEvent[]>>>();
export const DEFAULT_CALENDAR_FILTERS: CalendarFilters = { tasks: true, events: true, notes: true, completed: true, query: "" };

export function dateFromDay(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function shiftDay(key: string, days: number): string {
  const date = dateFromDay(key);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function shiftPeriod(key: string, delta: number, mode: CalendarMode): string {
  if (mode === "week") return shiftDay(key, delta * 7);
  const date = dateFromDay(key), day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  return toISODate(date);
}

export function calendarRange(anchor: string, mode: CalendarMode): CalendarRange {
  const date = dateFromDay(anchor);
  const monthFirst = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthLast = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const first = mode === "week" ? date : monthFirst;
  const from = shiftDay(toISODate(first), -((first.getDay() + 6) % 7));
  const days = Array.from({ length: mode === "week" ? 7 : 42 }, (_, i) => shiftDay(from, i));
  return { days, from, to: days[days.length - 1], month: anchor.slice(0, 7), monthFrom: toISODate(monthFirst), monthTo: toISODate(monthLast) };
}

function append<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

/** Tree revisions are immutable in the notes store. Browsing never reads note bodies. */
export function getCalendarNoteIndex(tree: TreeNode[]): CalendarNoteIndex {
  const cached = noteIndexes.get(tree);
  if (cached) return cached;
  const byDay = new Map<string, NoteMeta[]>(), journals = new Map<string, NoteMeta>(), anniversaries = new Map<string, NoteMeta[]>();
  const stack = [...tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "folder") { for (const child of node.children) stack.push(child); continue; }
    const note = node.note;
    const journalDay = dailyDateOf(note.id);
    if (!journalDay && !Number.isFinite(note.createdAt)) continue;
    const day = journalDay ?? dayKey(note.createdAt);
    if (!isValidDay(day)) continue;
    append(byDay, day, note);
    append(anniversaries, day.slice(5), note);
    if (journalDay) journals.set(journalDay, note);
  }
  for (const notes of byDay.values()) notes.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const notes of anniversaries.values()) notes.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const result = { byDay, journals, anniversaries };
  noteIndexes.set(tree, result);
  return result;
}

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  // Only four visited ranges per source revision; old arrays are weakly held.
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

export function getCalendarTaskDays(tasks: Task[], from: string, to: string): Map<string, Task[]> {
  let cache = taskIndexes.get(tasks);
  if (!cache) { cache = new Map(); taskIndexes.set(tasks, cache); }
  const key = `${from}/${to}`, cached = cache.get(key);
  if (cached) return cached;
  const days = new Map<string, Task[]>();
  for (const task of tasks) for (const day of occurrencesInRange(task, from, to)) append(days, day, task);
  for (const values of days.values()) values.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return remember(cache, key, days);
}

/** Include every visible day touched by an event; DTEND is exclusive. */
export function getCalendarEventDays(events: ParsedEvent[], from: string, to: string): Map<string, CalEvent[]> {
  let cache = eventIndexes.get(events);
  if (!cache) { cache = new Map(); eventIndexes.set(events, cache); }
  const key = `${from}/${to}`, cached = cache.get(key);
  if (cached) return cached;
  const start = dateFromDay(from).getTime(), end = dateFromDay(shiftDay(to, 1)).getTime();
  const days = new Map<string, CalEvent[]>();
  for (const event of expandEvents(events, start, end)) {
    const first = Math.max(start, event.start), last = Math.min(end - 1, Math.max(event.start, event.end - 1));
    for (let day = dayKey(first); day <= dayKey(last); day = shiftDay(day, 1)) append(days, day, event);
  }
  return remember(cache, key, days);
}

export function calendarDays(index: CalendarNoteIndex, taskDays: Map<string, Task[]>, eventDays: Map<string, CalEvent[]>, range: CalendarRange, filters: CalendarFilters): CalendarDay[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const matches = (values: (string | undefined)[]) => !query || values.some(value => value?.toLocaleLowerCase().includes(query));
  return range.days.map(key => {
    let tasks = filters.tasks ? taskDays.get(key) ?? [] : [];
    let events = filters.events ? eventDays.get(key) ?? [] : [];
    let notes = filters.notes ? index.byDay.get(key) ?? [] : [];
    if (!filters.completed || query) tasks = tasks.filter(task => (filters.completed || !isTaskDoneOn(task, key)) && matches([task.title, ...(task.tags ?? [])]));
    if (query) { events = events.filter(event => matches([event.summary, event.location])); notes = notes.filter(note => matches([note.title, note.folder, ...note.tags])); }
    return { key, tasks, events, notes, journal: filters.notes ? index.journals.get(key) : undefined };
  });
}

export function writingStreak(index: CalendarNoteIndex, today: string): number {
  let cursor = index.journals.has(today) ? today : shiftDay(today, -1), count = 0;
  while (index.journals.has(cursor)) { count++; cursor = shiftDay(cursor, -1); }
  return count;
}

export function calendarWindow(total: number, offset: number, count = 20): { offset: number; end: number } {
  const start = Math.min(Math.max(0, Math.floor(offset)), Math.max(0, Math.ceil(total / count) - 1) * count);
  return { offset: start, end: Math.min(total, start + count) };
}
