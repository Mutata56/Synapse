// src/editor2026/backlinks.ts
//
// Чистое вычисление бэклinks без React. Каждая заметка, тело которой
// ссылается на `[[target title]]`. По заголовкам, как wiki-link модель;
// читает только `NoteMeta.links` (уже очищено от code-block, lowercase
// при сохранении), поэтому это быстрый синхронный фильтр по кэшированному
// дереву, без дисковых чтений.
//
// Семантика идентична инлайн-вычислению в src/components/Backlinks.tsx,
// просто вынесена чтобы:
//   - Backlinks.tsx стал тонким рендерером над общим контрактом.
//   - Будущий рендерер (например, вкладка сайдбара "Linked from") мог переиспользовать.
//   - Юнит-тесты могли проверять данные напрямую без React.

import type { NoteMeta, TreeNode } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";

export type Backlink = {
  note: NoteMeta;
  /** Количество различных разрешений `[[...]]` в заметке, попавших на цель.
   *  Сейчас всегда 1, `NoteMeta.links` это дедуплицированное множество,
   *  две скобки в одной заметке складываются. Зарезервировано для будущего
   *  подсчета по вхождениям, рендереры НЕ ДОЛЖНЫ ожидать >1 сегодня. */
  count: number;
};

/**
 * Все заметки с упоминанием `target` через `[[target.title]]`, новые первыми.
 * Возвращает `[]` для null-цели или цели с пустым заголовком.
 */
export function computeBacklinks(
  tree: TreeNode[],
  target: NoteMeta | null,
): Backlink[] {
  if (!target) return [];
  const title = target.title.trim().toLowerCase();
  if (!title) return [];
  return flattenNotes(tree)
    .filter((n) => n.id !== target.id && n.links.includes(title))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((note) => ({ note, count: 1 }));
}
