// src/editor2026/loadDocument.ts
//
// Безопасная загрузка/сериализация документов для редактора 2026. Централизует
// пайплайн parse -> normalize -> guarded-apply, чтобы Editor2026 не падал на
// неизвестном типе блока (BlockNote 0.51.2 не имеет встроенного fallback для
// неизвестных блоков, незащищенный `replaceBlocks` с неизвестным типом бросает
// исключение и заметка не открывается).

import type { BlockNoteEditor } from "@blocknote/core";
import {
  knownBlockTypes,
  normalizeLoadedDocument,
  type NotesSchema,
} from "./schema";

/** Свободный хэндлер редактора, нужные методы есть у каждого BlockNote editor
 *  вне зависимости от конкретной схемы. */
type AnyEditor = BlockNoteEditor<any, any, any>;

/**
 * Хеш строки djb2. Канонический производитель `bnHash`, ключ
 * reconciliation между lossless и markdown. Стабилен между версиями, заметки
 * сохраняют этот хеш, смена алгоритма инвалидирует lossless BlockNote JSON
 * для всех существующих заметок.
 */
export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Один пустой параграф, возвращается свежим чтобы вызывающий мог передать
 *  в `replaceBlocks` без shared array identity. */
export function emptyDoc() {
  return [{ type: "paragraph" as const, content: [] }];
}

/**
 * True если документ редактора в канонической пустой форме (один пустой
 * параграф без содержимого и детей). Используется редактором для решения
 * о показе строки шаблонов. Строгое сравнение: строка исчезает при
 * вводе первого символа.
 *
 * Блоки из BlockNote имеют `id` и другие поля которых нет в
 * `LoadableNote`, поэтому принимаем `unknown[]` и смотрим только на
 * поверхность которая нас интересует.
 */
export function isEmptyDoc(doc: unknown): boolean {
  if (!Array.isArray(doc) || doc.length !== 1) return false;
  const block = doc[0] as {
    type?: string;
    content?: unknown;
    children?: unknown;
  } | null;
  if (!block || block.type !== "paragraph") return false;
  const contentLen = Array.isArray(block.content) ? block.content.length : 0;
  const childrenLen = Array.isArray(block.children) ? block.children.length : 0;
  return contentLen === 0 && childrenLen === 0;
}

/** Сохраненные поля заметки (подмножество `Note` из стора). */
export type LoadableNote = {
  content: string;
  blocknote?: string | null;
  bnHash?: number | null;
};

/**
 * Парсит сохраненное содержимое заметки в блоки. Предпочитает lossless
 * BlockNote JSON когда хеш совпадает с markdown телом (тоглы/вложенность/
 * code-блоки сохраняются); иначе парсит markdown заново (например, `.md`
 * редактировали во внешнем приложении).
 */
export async function parseNoteToBlocks(
  editor: AnyEditor,
  note: LoadableNote,
): Promise<unknown[]> {
  let blocks: unknown[] | undefined;
  const { content, blocknote, bnHash } = note;
  if (blocknote && bnHash != null && hashString(content) === bnHash) {
    try {
      blocks = JSON.parse(blocknote);
    } catch (e) {
      console.error("Editor2026: blocknote JSON parse failed:", e);
    }
  }
  if (!blocks) {
    try {
      blocks = content.trim()
        ? await editor.tryParseMarkdownToBlocks(content)
        : emptyDoc();
    } catch (e) {
      console.error("Editor2026: markdown parse failed:", e);
      blocks = emptyDoc();
    }
  }
  return blocks;
}

/**
 * Безопасное применение распарсенных блоков к редактору:
 *   1. деградируем неизвестные/удаленные типы блоков в параграф
 *      (normalizeLoadedDocument), затем
 *   2. replaceBlocks обернут в try/catch, при ошибке (например, битые
 *      пропсы от будущей версии блока) фолбэк на markdown-зеркало,
 *      которое парсится только во встроенные типы. Последний шанс - пустой документ.
 */
export async function applyDocument(
  editor: AnyEditor,
  schema: NotesSchema,
  blocks: unknown[],
  fallbackMarkdown: string,
): Promise<void> {
  const safe = normalizeLoadedDocument(blocks, knownBlockTypes(schema));
  try {
    editor.replaceBlocks(editor.document, safe as never);
    return;
  } catch (e) {
    console.error(
      "Editor2026: replaceBlocks failed; falling back to markdown:",
      e,
    );
  }
  try {
    const md = fallbackMarkdown.trim()
      ? await editor.tryParseMarkdownToBlocks(fallbackMarkdown)
      : emptyDoc();
    editor.replaceBlocks(editor.document, md as never);
  } catch {
    // todo log если markdown fallback тоже упал
    editor.replaceBlocks(editor.document, emptyDoc() as never);
  }
}
