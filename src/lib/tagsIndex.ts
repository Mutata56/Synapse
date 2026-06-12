/**
 * Подсчёт тегов, общий для полного экрана Tags и таблички Top-tags на
 * дашборде. Держим count и сортировку в одном месте, чтобы у этих двух мест
 * не разъехались правила порядка.
 *
 * Чистая функция, никакого I/O: заметки приходят уже расплющенными.
 */

import type { NoteMeta } from "./storage";

export type TagEntry = readonly [tag: string, count: number];

/**
 * Считает, сколько раз встречается каждый тег в `notes`. Сортировка по убыванию
 * count, при равенстве по алфавиту, чтобы порядок был стабильным. Передай
 * `Infinity` в `n`, чтобы получить весь отсортированный список (экран Tags так
 * и рисует свою полосу чипов).
 *
 * `minCount` отсекает редкие теги: дашборд берёт `minCount=3`, чтобы не тащить
 * одноразовые теги и шум, а экран Tags ставит `1`, чтобы видны были все.
 */
export function topTags(
  notes: NoteMeta[],
  n: number = 8,
  minCount: number = 3,
): TagEntry[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, n);
}
