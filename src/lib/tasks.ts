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
  createdAt: number;
  updatedAt: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
