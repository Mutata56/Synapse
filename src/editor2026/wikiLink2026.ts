// src/editor2026/wikiLink2026.ts
//
// Готовая логика для `getLinkItems` в Editor2026. Возвращает
// `DefaultReactSuggestionItem[]` - умное ранжирование + поддержка алиасов +
// реальный пункт "создать заметку" вместо вставки скобок к фантомному заголовку.
//
// Улучшения по сравнению с инлайн-реализацией:
//   1. МАТЧ ПО АЛИАСУ - у каждой заметки может быть `aliases: string[]`
//      (читается структурно, заметки БЕЗ алиасов работают как раньше).
//      Совпадение по алиасу показывает канонический заголовок с подтекстом
//      "Псевдоним: ..." (стиль Obsidian), а вставляется канонический заголовок,
//      так что wiki-link роунд-трип стабилен.
//   2. ДЕТЕРМИНИРОВАННОЕ РАНЖИРОВАНИЕ - точное совпадение > префикс заголовка >
//      префикс алиаса > подстрока, затем по давности обновления внутри
//      каждого бакета. Навигация с клавиатуры (от BlockNote SuggestionMenuController)
//      попадает на лучшее совпадение первым.
//   3. ПУНКТ "СОЗДАТЬ" - вызывает `createNoteByTitle(t)` (store action с
//      guard от дубликатов) вместо вставки скобок ни на что не ведущих.
//      Пользователь попадает в новую заметку готовым к письму.
//
// ИЗОЛЯЦИЯ: чистый модуль, без React, без импортов редактора. Зависит только
// от типа NoteMeta и маленького `deps` пакета от вызывающего.

import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { NoteMeta } from "../lib/storage";
import { t } from "../lib/i18n";

const MAX_ITEMS = 50;

/** Опциональные алиасы заметки. Читаются структурно чтобы модуль компилировался
 *  до добавления `aliases?: string[]` в storage.ts и чтобы заметки БЕЗ алиасов
 *  (все текущие) работали как старый getLinkItems. Битые значения (строка,
 *  объект, массив не-строк) деградируют в []. */
function aliasesOf(n: NoteMeta): string[] {
  const a = (n as unknown as { aliases?: unknown }).aliases;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
}

/** Бакеты ранжирования, чем меньше тем лучше. Порядок намеренный,
 *  см. файловый docblock для обсуждения дизайна. */
function rank(titleLc: string, aliasHitLc: string | null, q: string): number {
  if (!q) return 3; // пустой запрос, нет ранжирования, только по давности
  if (titleLc === q) return 0;
  if (titleLc.startsWith(q)) return 1;
  if (aliasHitLc && aliasHitLc.startsWith(q)) return 2;
  return 4; // только подстрока
}

export type WikiLinkItemDeps = {
  /** Вставляет `[[canonicalTitle]] ` в позицию курсора (существующее
   *  замыкание из Editor которое поглощает лишнюю `[`). */
  insertWikiLink: (title: string) => void;
  /** Создает новую заметку с этим заголовком (и выделяет её). Оборачивает
   *  одноименный store action, см. store/notes.ts. */
  createNoteByTitle: (title: string) => void;
};

/**
 * Собирает список предложений для `[[`. Готовая логика для `getLinkItems`
 * в Editor2026.
 */
export function buildWikiLinkItems(
  notes: NoteMeta[],
  query: string,
  currentId: string | null,
  deps: WikiLinkItemDeps,
): DefaultReactSuggestionItem[] {
  const q = query.trim().toLowerCase();

  type Cand = { note: NoteMeta; aliasHit: string | null; r: number };
  const cands: Cand[] = [];
  for (const n of notes) {
    const title = n.title.trim();
    if (!title || n.id === currentId) continue;
    const titleLc = title.toLowerCase();
    const aliases = aliasesOf(n);
    // Матч по алиасу как по ПОДСТРОКЕ (как и поиск по заголовку), но
    // ранжирование по префиксу для буста бакета.
    const aliasHit = aliases.find((a) => a.toLowerCase().includes(q)) ?? null;
    const matches = !q || titleLc.includes(q) || aliasHit !== null;
    if (!matches) continue;
    cands.push({
      note: n,
      aliasHit,
      r: rank(titleLc, aliasHit?.toLowerCase() ?? null, q),
    });
  }

  // Сначала по бакету asc, потом по давности desc внутри бакета.
  cands.sort((x, y) =>
    x.r !== y.r ? x.r - y.r : y.note.updatedAt - x.note.updatedAt,
  );

  const items: DefaultReactSuggestionItem[] = [];
  const seenTitles = new Set<string>();
  for (const c of cands) {
    const title = c.note.title.trim();
    const key = title.toLowerCase();
    if (seenTitles.has(key)) continue; // дедупликация по заголовку, линки резолвятся по заголовку
    seenTitles.add(key);
    items.push({
      title,
      // Показываем ПОЧЕМУ появилось неочевидное совпадение (алиас), в стиле Obsidian.
      subtext:
        c.aliasHit && c.aliasHit.toLowerCase() !== key
          ? `Псевдоним: ${c.aliasHit}`
          : undefined,
      onItemClick: () => deps.insertWikiLink(title),
    });
    if (items.length >= MAX_ITEMS) break;
  }

  // "Создать новый" - только когда непустой запрос точно не совпадает с заголовком.
  if (q && !seenTitles.has(q)) {
    const raw = query.trim();
    items.push({
      title: raw,
      subtext: t("Создать заметку"),
      onItemClick: () => deps.createNoteByTitle(raw),
    });
  }
  return items;
}
