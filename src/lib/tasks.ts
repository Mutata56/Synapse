/**
 * Локальные задачи календаря, созданные юзером, редактируемая пара к read-only
 * оверлею внешнего календаря (`lib/ics.ts`). Привязаны к дню, так что прямо
 * ложатся на сетку месяца, а необязательное `time` делает задачу со временем.
 * Намеренно дружелюбны к CalDAV (стабильный `id` заодно будущий iCalendar UID,
 * а `day` + `time` собирают DTSTART), чтобы потом шаг "запушить в Яндекс" мог
 * отзеркалить каждую задачу как VEVENT.
 *
 * Модуль чистый: только типы и хелперы, без импорта storage, чтобы без цикла.
 * Стор (`store/tasks.ts`) связывает его с диском через storage.ts.
 */

export type Task = {
  /** Стабильный локальный id, при синке заодно iCalendar UID. */
  id: string;
  title: string;
  /** Локальный день, `YYYY-MM-DD` (стабильно к таймзоне, как toISODate). */
  day: string;
  /** Локальное время `HH:MM`, или null для задачи на весь день. */
  time: string | null;
  done: boolean;
  /** Правило повтора. null или отсутствует = разовая задача. */
  repeat?: Recurrence | null;
  /** Для повторов: даты `YYYY-MM-DD`, на которые вхождение отмечено выполненным.
   *  У разовой задачи не используется, там обычный `done`. */
  doneDates?: string[];
  /** Цвет-метка задачи (hex `#rrggbb`), null/нет = дефолтный акцент. */
  color?: string | null;
  /** Произвольные текстовые метки (без ведущего #). */
  tags?: string[];
  createdAt: number;
  updatedAt: number;
};

export type RecurrenceFreq = "daily" | "weekly" | "monthly";

export type Recurrence = {
  freq: RecurrenceFreq;
  /** Каждые N дней/недель/месяцев, >= 1. */
  every: number;
  /** Дата конца повтора включительно (`YYYY-MM-DD`), или null = бессрочно. */
  until?: string | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** true для корректного ключа дня `YYYY-MM-DD`. */
export function isValidDay(v: string): boolean {
  return DAY_RE.test(v);
}

/** Нормализует ввод времени к `HH:MM`, или null если пусто/невалидно. */
export function normalizeTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return TIME_RE.test(s) ? s : null;
}

/** Чистит метки: убирает ведущие #, пробелы, пустые и дубли (порядок хранит). */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Сортирует задачи по дню, потом со временем раньше без времени (по времени),
 * потом по порядку создания. Намеренно игнорит `done`, чтобы выполненная задача
 * не прыгала по списку, просто зачёркивается на месте.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.time !== b.time) {
    if (a.time == null) return 1; // без времени уходит вниз
    if (b.time == null) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return a.createdAt - b.createdAt;
}

// ─── Повторы ───────────────────────────────────────────────────────────────

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(aIso: string, bIso: string): number {
  const MS = 86400000;
  return Math.round((parseDay(bIso).getTime() - parseDay(aIso).getTime()) / MS);
}

/** Выпадает ли задача на дату `iso` с учётом повтора. Разовая выпадает только
 *  на свой `day`. */
export function occursOn(task: Task, iso: string): boolean {
  const rep = task.repeat;
  if (!rep) return iso === task.day;
  if (iso < task.day) return false;
  if (rep.until && iso > rep.until) return false;
  const every = Math.max(1, Math.floor(rep.every));
  if (rep.freq === "daily") {
    const diff = daysBetween(task.day, iso);
    return diff >= 0 && diff % every === 0;
  }
  if (rep.freq === "weekly") {
    const diff = daysBetween(task.day, iso);
    return diff >= 0 && diff % 7 === 0 && (diff / 7) % every === 0;
  }
  // monthly: то же число, что у дня старта, и кратно every месяцам. Месяцы, где
  // такого числа нет (31-е в феврале), вхождение пропускают.
  const start = parseDay(task.day);
  const cur = parseDay(iso);
  if (cur.getDate() !== start.getDate()) return false;
  const months =
    (cur.getFullYear() - start.getFullYear()) * 12 +
    (cur.getMonth() - start.getMonth());
  return months >= 0 && months % every === 0;
}

/** Даты (`YYYY-MM-DD`), на которые задача выпадает внутри [from, to] включительно. */
export function occurrencesInRange(
  task: Task,
  fromIso: string,
  toIso: string,
): string[] {
  if (!task.repeat) {
    return task.day >= fromIso && task.day <= toIso ? [task.day] : [];
  }
  const out: string[] = [];
  const startIso = task.day > fromIso ? task.day : fromIso;
  const cur = parseDay(startIso);
  const end = parseDay(toIso);
  // Видимый диапазон это месяц/неделя (десятки дней), так что посуточный проход
  // дешёвый и не требует отдельной математики под каждый freq.
  while (cur.getTime() <= end.getTime()) {
    const iso = toIsoDay(cur);
    if (occursOn(task, iso)) out.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Выполнено ли вхождение на дату `iso`. У разовой это её `done`, у повтора
 *  отметка лежит в `doneDates`. */
export function isTaskDoneOn(task: Task, iso: string): boolean {
  if (!task.repeat) return task.done;
  return Array.isArray(task.doneDates) && task.doneDates.includes(iso);
}

function coerceRecurrence(raw: unknown): Recurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.freq !== "daily" && o.freq !== "weekly" && o.freq !== "monthly") {
    return null;
  }
  const every =
    typeof o.every === "number" && o.every >= 1 ? Math.floor(o.every) : 1;
  const until =
    typeof o.until === "string" && DAY_RE.test(o.until) ? o.until : null;
  return { freq: o.freq, every, until };
}

/**
 * Приводит произвольный JSON (руками правленый или старый `.tasks.json`) к
 * чистым Task, выкидывая кривое, чтобы одна плохая строка не сломала весь список.
 */
export function coerceTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];
  const out: Task[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.title !== "string") continue;
    if (typeof o.day !== "string" || !DAY_RE.test(o.day)) continue;
    const now = Date.now();
    out.push({
      id: o.id,
      title: o.title,
      day: o.day,
      time: normalizeTime(typeof o.time === "string" ? o.time : null),
      done: o.done === true,
      repeat: coerceRecurrence(o.repeat),
      doneDates: Array.isArray(o.doneDates)
        ? o.doneDates.filter(
            (x): x is string => typeof x === "string" && DAY_RE.test(x),
          )
        : [],
      color:
        typeof o.color === "string" && COLOR_RE.test(o.color) ? o.color : null,
      tags: Array.isArray(o.tags)
        ? normalizeTags(o.tags.filter((x): x is string => typeof x === "string"))
        : [],
      createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
      updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : now,
    });
  }
  return out;
}

/** Случайный id, он же iCalendar UID после синка задачи. */
export function newTaskId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
