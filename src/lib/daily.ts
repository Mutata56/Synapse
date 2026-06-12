/**
 * Соглашения по заметкам дня, общие для стора (openDailyNote) и Календаря.
 * Заметка дня лежит в `Дневник/<год>/<YYYY-MM-DD>`, путь детерминированный,
 * так что "сегодня" всегда указывает на одну и ту же заметку, а имя файла
 * сортируется по дате и без изменений живёт в Obsidian.
 */

// todo DIARY_ROOT как настройка пользователя
export const DIARY_ROOT = "Дневник";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Локальный день как `YYYY-MM-DD` (по местному времени, не UTC). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ключ локального дня для таймстампа, группирует заметки по дню создания. */
export function dayKey(ts: number): string {
  return toISODate(new Date(ts));
}

/** Папка с заметкой дня для даты, например `Дневник/2026`. */
export function dailyNoteFolder(d: Date): string {
  return `${DIARY_ROOT}/${d.getFullYear()}`;
}

/** Полный id/путь заметки дня для даты, например `Дневник/2026/2026-06-01`. */
export function dailyNoteId(d: Date): string {
  return `${dailyNoteFolder(d)}/${toISODate(d)}`;
}

/** Если `id` это заметка дня (имя `YYYY-MM-DD` под корнем дневника), вернёт
 *  её `YYYY-MM-DD`, иначе `null`. */
export function dailyDateOf(id: string): string | null {
  if (!id.startsWith(`${DIARY_ROOT}/`)) return null;
  const base = id.slice(id.lastIndexOf("/") + 1);
  return /^\d{4}-\d{2}-\d{2}$/.test(base) ? base : null;
}

/**
 * Id редактируемого шаблона заметки дня, скрытая заметка под `.templates/`
 * (дотдир, не виден дереву). Открывается через "Шаблон заметки дня" и копируется
 * в каждую новую заметку дня, чтобы день начинался с одной структуры.
 */
export const DAILY_TEMPLATE_ID = ".templates/daily";

/** Встроенная структура, пока юзер не настроил шаблон под себя. */
export const DEFAULT_DAILY_TEMPLATE =
  "## Как прошёл день\n\n## Что сделал\n\n## Благодарность\n\n## Мысли\n";
