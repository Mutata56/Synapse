/**
 * Кросс-платформенный стек эмодзи-шрифтов. Инлайн-стиль тут намеренно: Mantine
 * и BlockNote иногда рисуют поповеры через React-порталы, куда CSS-переменная
 * `--font-emoji` не наследуется. А `style={{ fontFamily: EMOJI_FONT_STACK }}`
 * работает везде.
 */
export const EMOJI_FONT_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

export const DEFAULT_NOTE_TITLE = "Без названия";

export const EMPTY_NOTE_PREVIEW = "Пустая заметка";

/**
 * Склонение русских существительных по числу: выбирает форму по обычной
 * грамматике (1, 2-4, 5+).
 *
 * @example pluralRu(5, "файл", "файла", "файлов") даёт "файлов"
 *
 * `n` должно быть неотрицательным целым (счётчики, длины), для отрицательных
 * не определено.
 */
export function pluralRu(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * Превращает число байтов в читаемую строку. Считаем по 1024 (как `ls -lh` и
 * большинство дев-тулзов, не SI по 1000).
 *
 *   до 1 КБ:  "512 B"
 *   до 1 МБ:  "256.0 KB"
 *   до 1 ГБ:  "1.5 MB"
 *   от 1 ГБ:  "2.3 GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

// ─── Относительные даты ─────────────────────────────────────────────

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const DATE_SAME_YEAR: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
};
const DATE_OTHER_YEAR: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

/**
 * Человеко-понятное относительное время для чипов в карточках:
 *   "только что"    меньше минуты
 *   "5 мин назад"   меньше часа
 *   "3 ч назад"     меньше суток
 *   "вторник"       за прошлую неделю
 *   "12 мар"        старее, тот же год
 *   "12 мар 2023"   старее, другой год
 *
 * Параметр `now` нужен для детерминированных тестов, в проде его не передаём.
 */
export function formatRelativeDate(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < MINUTE) return "только что";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} мин назад`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ч назад`;

  const d = new Date(ts);
  if (diff < WEEK) {
    return d.toLocaleDateString("ru-RU", { weekday: "long" });
  }

  // Для старых записей показываем год, если он отличается от текущего, чтобы
  // в долгом дневнике "12 мар 2023" и "12 мар 2025" не слились в одну подпись.
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(
    "ru-RU",
    sameYear ? DATE_SAME_YEAR : DATE_OTHER_YEAR,
  );
}
