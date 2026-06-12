/**
 * Чистая (без I/O и React) статистика для дашборда писательства / "Год в
 * обзоре".
 *
 * Календарь уже сам считает heatmap (заметок в день) и текущий стрик прямо на
 * месте. Тут те же идеи вынесены в переиспользуемые функции плюс добавлены две,
 * которые нужны дашборду: рекордный стрик за всё время и сумма слов по месяцам.
 * Чистота означает, что про это легко рассуждать и легко тестировать, и оно не
 * завязано на то, откуда взялись тела заметок (дашборд скармливает сюда уже
 * посчитанные слова из кэша полнотекстовых тел).
 */

import { dailyDateOf, toISODate } from "./daily";
import type { NoteMeta } from "./storage";

/** Число слов в заметке плюс когда её написали. Дашборд собирает их из кэша
 *  тел, агрегациям ниже хватает этих двух полей. */
export type WordEntry = { createdAt: number; words: number };

/**
 * Считает слова в markdown-теле как максимальные непробельные куски.
 * Markdown-пунктуация (`#`, `*`, `-`) прилипает к соседним словам, так что счёт
 * чуть пляшет относительно чистой прозы, зато стабильный и быстрый. Для крупной
 * цифры "написано слов" этого и надо.
 */
export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Набор локальных дней (`YYYY-MM-DD`), у которых есть дневниковая заметка. Это
 *  и есть дни письма, по которым считаются стрики. */
export function dailyDaySet(notes: NoteMeta[]): Set<string> {
  const days = new Set<string>();
  for (const note of notes) {
    const day = dailyDateOf(note.id);
    if (day) days.add(day);
  }
  return days;
}

/**
 * Подряд идущие дни письма, заканчивая сегодня (или вчера, если сегодня ещё не
 * писали, чтобы непрописанное утро не выглядело сорванным стриком). Ровно то же
 * определение, что в Календаре.
 */
export function currentStreak(days: Set<string>, today: Date = new Date()): number {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(toISODate(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(toISODate(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/**
 * Самая длинная цепочка дней письма за всё время, рекордный стрик. Строки
 * `YYYY-MM-DD` сортируются хронологически, так что сортируем один раз и ищем
 * самый длинный непрерывный отрезок.
 */
export function longestStreak(days: Set<string>): number {
  if (days.size === 0) return 0;
  const sorted = [...days].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (isNextDay(sorted[i - 1], sorted[i])) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

/** Сумма слов по каждому месяцу `year` (индекс 0 это январь). */
export function wordsByMonth(entries: WordEntry[], year: number): number[] {
  const months = new Array<number>(12).fill(0);
  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    if (date.getFullYear() === year) months[date.getMonth()] += entry.words;
  }
  return months;
}

/** Сумма слов по каждому дню месяца `month` в году `year` (индекс 0 это 1-е). */
export function wordsByDay(
  entries: WordEntry[],
  year: number,
  month: number,
): number[] {
  const dayCount = new Date(year, month + 1, 0).getDate();
  const days = new Array<number>(dayCount).fill(0);
  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    if (date.getFullYear() === year && date.getMonth() === month) {
      days[date.getDate() - 1] += entry.words;
    }
  }
  return days;
}

/** Корзина недели: день начала (локальные ms, для подписи) и сумма слов. */
export type WeekBucket = { startMs: number; words: number };

/**
 * Сумма слов по каждой неделе `year`. Недели это простые корзины по 7 дней,
 * считая от 1 января (неделя 0 это дни 1..7 и так далее). Не ISO-недели, зато
 * стабильно и понятно. Возвращаем все недели, что охватывает год, с нулями, так
 * что ось графика не дёргается при переключении лет.
 */
export function wordsByWeek(entries: WordEntry[], year: number): WeekBucket[] {
  const weekCount = Math.ceil(daysInYear(year) / 7);
  const words = new Array<number>(weekCount).fill(0);
  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    if (date.getFullYear() !== year) continue;
    const week = Math.floor(dayOfYear(date) / 7);
    if (week >= 0 && week < weekCount) words[week] += entry.words;
  }
  return words.map((w, i) => ({
    startMs: new Date(year, 0, 1 + i * 7).getTime(),
    words: w,
  }));
}

/** Уникальные годы, где есть хоть одна запись, по возрастанию. Питают пикер
 *  года, чтобы юзер попадал только на годы, где реально что-то писалось. */
export function yearsWithEntries(entries: WordEntry[]): number[] {
  const years = new Set<number>();
  for (const entry of entries) years.add(new Date(entry.createdAt).getFullYear());
  return [...years].sort((a, b) => a - b);
}

/**
 * Сумма слов за `year`. Один проход с фильтром по году, как проверка
 * `getFullYear()` в `wordsByMonth`. То же, что
 * `wordsByMonth(entries, year).reduce((s, w) => s + w, 0)`, но без
 * промежуточного массива на 12 элементов. Вынесено из WritingDashboard, где
 * раньше жило инлайном как `yearWords`.
 */
export function wordsInYear(entries: WordEntry[], year: number): number {
  let sum = 0;
  for (const entry of entries) {
    if (new Date(entry.createdAt).getFullYear() === year) sum += entry.words;
  }
  return sum;
}

/**
 * Сколько записей создано в `year`. Тот же приём с фильтром по году, что в
 * `wordsByMonth` / `yearsWithEntries`. Вынесено из WritingDashboard, где
 * раньше жило инлайном как `yearEntries`.
 */
export function entriesInYear(entries: WordEntry[], year: number): number {
  let count = 0;
  for (const entry of entries) {
    if (new Date(entry.createdAt).getFullYear() === year) count++;
  }
  return count;
}

/**
 * Покрытие привычки писать с самого первого дня: в скольких днях вообще что-то
 * писалось против того, сколько дней юзер "мог бы" писать (дней с первого дня
 * письма, включительно). Заодно отдаёт самый длинный пропуск (в днях) между
 * соседними днями письма, полезное дополнение к `longestStreak`, который видит
 * только сами цепочки.
 *
 * На пустом наборе дней возвращает null, чтобы вызывающий мог спрятать подпись,
 * а не рисовать "0/1 (0%)" на свежей установке.
 */
export function coverageStats(
  days: Set<string>,
  today: Date = new Date(),
): { written: number; total: number; pct: number; longestGap: number } | null {
  if (days.size === 0) return null;
  const sorted = [...days].sort();
  const firstMs = parseISODate(sorted[0]).getTime();
  const todayMid = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const total = Math.max(1, Math.round((todayMid - firstMs) / 86_400_000) + 1);
  const written = Math.min(days.size, total);
  let longestGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseISODate(sorted[i - 1]).getTime();
    const cur = parseISODate(sorted[i]).getTime();
    const gap = Math.round((cur - prev) / 86_400_000) - 1;
    if (gap > longestGap) longestGap = gap;
  }
  const pct = Math.round((written / total) * 100);
  return { written, total, pct, longestGap };
}

/**
 * Сумма слов по всем записям. Вынесено из WritingDashboard, где раньше жило
 * инлайном как `totalWords` (однострочный reduce).
 */
export function totalWords(entries: WordEntry[]): number {
  let sum = 0;
  for (const entry of entries) sum += entry.words;
  return sum;
}

/**
 * Сумма слов за день `dayIso` (локальный YYYY-MM-DD). Один проход с фильтром,
 * как проверка `getFullYear()` в `wordsByMonth`. Использует то же соглашение
 * `toISODate`, что и `dailyDaySet`, чтобы ключ дня везде совпадал.
 */
export function wordsInDay(entries: WordEntry[], dayIso: string): number {
  let sum = 0;
  for (const entry of entries) {
    if (toISODate(new Date(entry.createdAt)) === dayIso) sum += entry.words;
  }
  return sum;
}

/**
 * Слова по каждому из последних `n` дней, по порядку (сначала старые, сегодня
 * последним), чтобы результат читался слева направо как спарклайн. Один проход
 * по `entries` через мапу "ISO-ключ это индекс"; дни без письма дают ноль.
 * Стабильный дефолт `today`, как в `currentStreak` / `currentStreakRange`.
 */
export function wordsLastNDays(
  entries: WordEntry[],
  n: number,
  today: Date = new Date(),
): number[] {
  const out = new Array<number>(n).fill(0);
  if (n <= 0) return out;
  // Строим мапу "ISO-ключ это индекс слота", гоняя курсор дня от
  // (n-1) дней назад до сегодня. Слот 0 самый старый, слот n-1 это сегодня.
  const indexByKey = new Map<string, number>();
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  cursor.setDate(cursor.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    indexByKey.set(toISODate(cursor), i);
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const entry of entries) {
    const key = toISODate(new Date(entry.createdAt));
    const slot = indexByKey.get(key);
    if (slot !== undefined) out[slot] += entry.words;
  }
  return out;
}

/**
 * Медиана `values`: копируем, сортируем, берём середину. На пустом входе
 * возвращает 0, чтобы тем, кто считает дельты, не ловить NaN отдельно. Алгоритм
 * тот же, что во внутреннем блоке `trailingMedian`, вынесен, чтобы дашборд мог
 * его звать, не лезя в механику скользящего окна.
 */
export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Скользящая медиана по окну. На недозаполненном начале возвращает null, чтобы
 * вызывающий нарисовал пропуск. Чистая, не аллоцирует ничего сверх буфера под
 * сортировку каждого окна. Рассчитана на короткие ряды (не больше 370 ячеек на
 * год).
 */
export function trailingMedian(
  values: number[],
  window: number,
): (number | null)[] {
  if (window <= 0) return values.map(() => null);
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) continue;
    const slice = values.slice(i - window + 1, i + 1).sort((a, b) => a - b);
    const mid = Math.floor(slice.length / 2);
    out[i] =
      slice.length % 2 === 1 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2;
  }
  return out;
}

// ЗАМЕТКА: тут раньше жил общий хелпер `peakIndex` (argmax). Убрали, потому что
// единственный вызыватель (`Bars` в WritingDashboard) сворачивает total + max +
// peakIdx в один проход ради скорости, а отдельный `peakIndex(bars)` заставил
// бы пройтись по массиву второй раз. Вернуть, только если появится второй
// вызыватель.

/** Цепочка дней письма подряд: концы в локальных ms (00:00 по локали с обеих
 *  сторон, включительно). `length` это число дней. */
export type StreakRange = { startMs: number; endMs: number; length: number };

/**
 * Диапазон текущего стрика, заканчивая сегодня (или вчера, если сегодня ещё не
 * писали). Зеркалит `currentStreak`, но отдаёт ещё и сам отрезок, чтобы по
 * клику на дашборде подсветить его в YearHeatmap. Возвращает null, если
 * активного стрика нет.
 */
export function currentStreakRange(
  days: Set<string>,
  today: Date = new Date(),
): StreakRange | null {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(toISODate(cursor))) cursor.setDate(cursor.getDate() - 1);
  const endIso = toISODate(cursor);
  if (!days.has(endIso)) return null;
  let length = 0;
  while (days.has(toISODate(cursor))) {
    length++;
    cursor.setDate(cursor.getDate() - 1);
  }
  // `cursor` сейчас на день раньше первого дня стрика, сдвигаем обратно.
  const startCursor = new Date(cursor);
  startCursor.setDate(startCursor.getDate() + 1);
  return {
    startMs: parseISODate(toISODate(startCursor)).getTime(),
    endMs: parseISODate(endIso).getTime(),
    length,
  };
}

/**
 * Диапазон самой длинной цепочки дней письма за всё время. Зеркалит
 * `longestStreak`, но отдаёт ещё и отрезок для клика на дашборде. Возвращает
 * null, если дней письма нет.
 */
export function longestStreakRange(days: Set<string>): StreakRange | null {
  if (days.size === 0) return null;
  const sorted = [...days].sort();
  let bestStart = sorted[0];
  let bestEnd = sorted[0];
  let bestLen = 1;
  let runStart = sorted[0];
  let runLen = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (isNextDay(sorted[i - 1], sorted[i])) {
      runLen++;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
        bestEnd = sorted[i];
      }
    } else {
      runStart = sorted[i];
      runLen = 1;
    }
  }
  return {
    startMs: parseISODate(bestStart).getTime(),
    endMs: parseISODate(bestEnd).getTime(),
    length: bestLen,
  };
}

// ─── Внутреннее ──────────────────────────────────────────────────────────────

/** true, когда `b` это календарный день сразу после `a` (оба `YYYY-MM-DD`).
 *  Идёт через Date, чтобы корректно отработать переходы через месяц/год. */
function isNextDay(a: string, b: string): boolean {
  const next = parseISODate(a);
  next.setDate(next.getDate() + 1);
  return toISODate(next) === b;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Номер дня в году для `date`, с нуля. Считаем в UTC, чтобы переход на летнее
 *  время не перекинул день через границу недели. */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day - start) / 86_400_000);
}

function daysInYear(year: number): number {
  return Math.round(
    (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000,
  );
}
