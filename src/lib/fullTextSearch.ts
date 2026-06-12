/**
 * Глобальный полнотекстовый поиск по телам заметок. Раньше "global" в палитре
 * команд фаззил только заголовки и превью на 240 символов, а тут ищем по всему
 * телу каждой заметки.
 *
 * Читать все заметки с диска на каждое нажатие было бы дико медленно, поэтому
 * держим модульный кэш тел по ключу `updatedAt`. Каждое сохранение поднимает
 * `updatedAt` заметки, так что закэшированное тело валидно ровно до следующей
 * правки: кэш сам себя инвалидирует и перечитываем только реально изменившиеся
 * заметки. (По сути как материализованное представление, которое обновляем
 * построчно только для строк со сменившейся версией, а не пересобираем целиком.)
 */

import { readNote, type NoteMeta } from "./storage";
import { countWords, type WordEntry } from "./writingStats";

// todo persistent word-count cache на диске чтобы холодный старт дашборда был мгновенный
// ─── ЗАГЛУШКА: word-count на диске рядом с заметками ─────────────────────────
// Идея на будущее: класть `wordCountCache` в `$appData/word-counts.json` по
// ключу `{ [noteId]: { updatedAt, words } }`, чтобы холодный старт был мгновенный
// даже при первом открытии Обзора. Пока не делаем: модульный кэш и так покрывает
// возврат на тёплую вкладку (это ~95% боли), а холодный скан укладывается в
// <100ms на типичных библиотеках, плюс запись на диск каждое сохранение это
// лишняя возня. Если делать: писать кэш при выходе (Tauri `onCloseRequested`) и
// на `visibilitychange=hidden` с дебаунсом, читать на старте до `warmIndex`.
// Повод вернуться: кто-то жалуется, что дашборд рендерит записи дольше 300ms на
// холодную при библиотеке больше 5k заметок.

/** Сколько символов контекста оставляем с каждой стороны совпадения в теле для
 *  сниппета. Совпадает с поиском внутри заметки (`noteSearch.ts`) ради единого вида. */
const SNIPPET_CONTEXT_CHARS = 48;

/** Сколько `readNote` гоняем параллельно при (пере)сборке. Ограничивает разовый
 *  всплеск IO, когда греем холодный кэш на большом воркспейсе. */
const READ_CONCURRENCY = 8;

/** Сдвиги счёта, чтобы любое попадание в заголовок было строго выше любого
 *  попадания только в тело. Внутри тира раньшее совпадение даёт больше очков. */
const TITLE_TIER = 1_000_000;
const BODY_TIER = 1_000;

export type Snippet = {
  /** Контекст перед совпадением (уже схлопнут и с многоточием). */
  before: string;
  /** Само совпадение, в исходном регистре тела. */
  text: string;
  /** Контекст после совпадения. */
  after: string;
};

export type FullTextHit = {
  note: NoteMeta;
  /** Сниппет тела, когда совпало в теле; `null`, когда запрос совпал только с
   *  заголовком (заголовок и так показан в строке, сниппет не нужен). */
  snippet: Snippet | null;
};

/** Одна заметка для поиска: живая мета плюс её закэшированное тело. Непрозрачна
 *  для вызывающих: создаёт `buildSearchDocs`, потребляет `searchFullText`. */
export type SearchDoc = {
  note: NoteMeta;
  body: string;
  bodyLower: string;
  titleLower: string;
};

// ─── Кэш тел ──────────────────────────────────────────────────────────────

type CachedBody = { updatedAt: number; body: string; bodyLower: string };

/** id это последнее прочитанное тело. Живёт между открытиями палитры всю жизнь приложения. */
const bodyCache = new Map<string, CachedBody>();

/** id это последний посчитанный word count, по тому же `updatedAt`, что и
 *  `bodyCache`. Держит горячий путь дашборда (ряды по дням, суммы за год,
 *  скользящая медиана) подальше от диска при возврате на тёплую вкладку: переход
 *  на Обзор целиком разруливается из этой мапы. Чистится вместе с `bodyCache`,
 *  чтобы удалённые заметки не утекали. */
const wordCountCache = new Map<string, { updatedAt: number; words: number }>();

/**
 * Собирает список doc'ов для поиска по `notes`, читая с диска только те
 * заметки, чьего тела нет в кэше под текущим `updatedAt`. Тела заметок, которых
 * больше нет, выкидываем, чтобы кэш не рос бесконечно.
 *
 * Поля для показа (title / folder / icon) всегда берём свежими из переданной
 * `NoteMeta`, а не из кэша, чтобы переименование или перемещение отображалось
 * правильно, даже если само тело не менялось.
 */
export async function buildSearchDocs(notes: NoteMeta[]): Promise<SearchDoc[]> {
  const docs: SearchDoc[] = [];
  const misses: NoteMeta[] = [];
  const present = new Set<string>();

  for (const note of notes) {
    present.add(note.id);
    const cached = bodyCache.get(note.id);
    if (cached && cached.updatedAt === note.updatedAt) {
      docs.push(toDoc(note, cached.body, cached.bodyLower));
    } else {
      misses.push(note);
    }
  }

  await pooledForEach(misses, READ_CONCURRENCY, async (note) => {
    const full = await readNote(note.id);
    const body = full?.content ?? "";
    const bodyLower = body.toLowerCase();
    bodyCache.set(note.id, { updatedAt: note.updatedAt, body, bodyLower });
    docs.push(toDoc(note, body, bodyLower));
  });

  // Выкидываем из кэша удалённые и отправленные в корзину заметки.
  for (const id of bodyCache.keys()) {
    if (!present.has(id)) bodyCache.delete(id);
  }

  return docs;
}

/**
 * Заполняет кэш тел в фоне, чтобы первый поиск в палитре был мгновенным. Можно
 * звать в стиле fire-and-forget: свои ошибки глотает сам.
 */
export async function warmIndex(notes: NoteMeta[]): Promise<void> {
  try {
    await buildSearchDocs(notes);
  } catch (e) {
    console.error("warmIndex failed:", e);
  }
}

/**
 * Отдаёт по одному `{ createdAt, words }` на заметку, опираясь на общий
 * `bodyCache` и отдельный `wordCountCache`, чтобы не токенизировать заново тело,
 * которое уже считали. Три уровня:
 *
 *   1. Попали в `wordCountCache` под нужным `updatedAt`: отдаём сразу.
 *   2. Попали в `bodyCache` под нужным `updatedAt`: пересчитываем `countWords`,
 *      кладём в `wordCountCache`. (С диска не читаем.)
 *   3. Промах в оба: читаем с диска тем же ограниченным пулом, что и
 *      `buildSearchDocs`, заполняя ОБА кэша.
 *
 * Оба кэша чистятся по набору текущих id, чтобы удалённые заметки не утекали.
 * Возврат на дашборд не делает ничего, пока ни одна заметка не менялась.
 */
export async function wordCountsFor(notes: NoteMeta[]): Promise<WordEntry[]> {
  const out: WordEntry[] = [];
  const misses: NoteMeta[] = [];
  const present = new Set<string>();

  for (const note of notes) {
    present.add(note.id);
    const cachedCount = wordCountCache.get(note.id);
    if (cachedCount && cachedCount.updatedAt === note.updatedAt) {
      out.push({ createdAt: note.createdAt, words: cachedCount.words });
      continue;
    }
    const cachedBody = bodyCache.get(note.id);
    if (cachedBody && cachedBody.updatedAt === note.updatedAt) {
      const words = countWords(cachedBody.body);
      wordCountCache.set(note.id, { updatedAt: note.updatedAt, words });
      out.push({ createdAt: note.createdAt, words });
      continue;
    }
    misses.push(note);
  }

  await pooledForEach(misses, READ_CONCURRENCY, async (note) => {
    const full = await readNote(note.id);
    const body = full?.content ?? "";
    const bodyLower = body.toLowerCase();
    bodyCache.set(note.id, { updatedAt: note.updatedAt, body, bodyLower });
    const words = countWords(body);
    wordCountCache.set(note.id, { updatedAt: note.updatedAt, words });
    out.push({ createdAt: note.createdAt, words });
  });

  // Выкидываем удалённые и отправленные в корзину заметки, так же как чистим
  // body-cache в `buildSearchDocs`, чтобы оба кэша шли нога в ногу.
  for (const id of wordCountCache.keys()) {
    if (!present.has(id)) wordCountCache.delete(id);
  }

  return out;
}

// ─── Поиск ─────────────────────────────────────────────────────────────────

/**
 * Поиск подстроки по заголовку и телу, регистр игнорим. Попадания в заголовок
 * стоят выше попаданий только в тело; при равенстве выигрывает раньшее
 * совпадение, затем более свежая заметка. Возвращает не больше `limit`
 * попаданий, лучшие первыми.
 */
export function searchFullText(
  docs: SearchDoc[],
  query: string,
  limit: number,
): FullTextHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { hit: FullTextHit; score: number; updatedAt: number }[] = [];
  for (const doc of docs) {
    const titleIdx = doc.titleLower.indexOf(q);
    const bodyIdx = doc.bodyLower.indexOf(q);
    if (titleIdx === -1 && bodyIdx === -1) continue;

    let score = 0;
    if (titleIdx !== -1) score += TITLE_TIER - Math.min(titleIdx, TITLE_TIER - 1);
    if (bodyIdx !== -1) score += BODY_TIER - Math.min(bodyIdx, BODY_TIER - 1);

    const snippet = bodyIdx === -1 ? null : makeSnippet(doc.body, bodyIdx, q.length);
    scored.push({ hit: { note: doc.note, snippet }, score, updatedAt: doc.note.updatedAt });
  }

  scored.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  return scored.slice(0, limit).map((s) => s.hit);
}

function toDoc(note: NoteMeta, body: string, bodyLower: string): SearchDoc {
  return { note, body, bodyLower, titleLower: note.title.toLowerCase() };
}

/**
 * Строит однострочный сниппет вокруг совпадения в теле. Пробельные куски
 * (включая переносы строк, ведь тела это сырой Markdown) схлопываются в один
 * пробел, чтобы сниппет читался одной строкой. Markdown-синтаксис (`**`, `#` и
 * прочее) оставляем как есть.
 */
function makeSnippet(body: string, idx: number, len: number): Snippet {
  const start = Math.max(0, idx - SNIPPET_CONTEXT_CHARS);
  const end = idx + len;
  const before = body.slice(start, idx).replace(/\s+/g, " ");
  const after = body.slice(end, end + SNIPPET_CONTEXT_CHARS).replace(/\s+/g, " ");
  return {
    before: (start > 0 ? "…" : "") + before,
    text: body.slice(idx, end),
    after: after + (end + SNIPPET_CONTEXT_CHARS < body.length ? "…" : ""),
  };
}

/**
 * Гоняет `fn` по `items`, держа в полёте максимум `limit` за раз. Воркеры тянут
 * задачи из общего курсора, так что медленное чтение не мешает остальным стартовать.
 */
async function pooledForEach<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  };
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, worker));
}
