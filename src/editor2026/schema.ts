// src/editor2026/schema.ts
//
// Ключевой модуль схемы редактора, регистрирует все встроенные и
// кастомные блоки приложения + нормализатор обратной совместимости.
//
// Задачи:
//   1. Собрать схему редактора через фабрику (createNotesSchema):
//      полный набор `defaultBlockSpecs` (параграфы, заголовки, списки,
//      таблица, изображение, файл, видео, аудио, toggleListItem, разделитель...),
//      подсвечиваемый синтаксис code-block и кастомные блки (callout, gallery,
//      fileCard, dataTable, multi-column, whiteboard).
//   2. Гарантировать обратную совместимость через normalizeLoadedDocument(),
//      деградирует неизвестные/удаленные типы блоков в параграфы ДО передачи
//      в editor.replaceBlocks(...). BlockNote 0.51.2 не имеет встроенного
//      fallback для неизвестных блоков, незащищенный replaceBlocks бросает
//      исключение и заметка не открывается. todo убрать normalizeLoadedDocument
//      когда BlockNote добавит fallback

import { codeBlockOptions } from "@blocknote/code-block";
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
} from "@blocknote/core";
import type { PartialBlock } from "@blocknote/core";
import { ColumnBlock, ColumnListBlock } from "@blocknote/xl-multi-column";
import { calloutBlock } from "./blocks/callout";
import { fileCardBlock } from "./blocks/fileCard";
import { galleryBlock } from "./blocks/gallery";
import { whiteboardBlock } from "./blocks/whiteboard/whiteboardBlock";
import { dataTableBlock } from "./dataTable/spec";

// ── Сборка схемы ───────────────────────────────────────────────────────────

/**
 * Собирает полную схему редактора.
 *
 * `defaultBlockSpecs` уже содержит встроенные блоки которые мы РАСШИРЯЕМ,
 * а не переобъявляем: `image`, `file`, `video`, `audio`, набор
 * list/heading/quote/divider/table/paragraph и `toggleListItem` (встроенный toggle).
 *
 * `codeBlock` переопределяется спекой с подсветкой синтаксиса.
 *
 * Про фабрики: `createReactBlockSpec(config, impl)` возвращает ФАБРИКУ
 * `(options?) => BlockSpec`, а `BlockNoteSchema.create` ждет уже собранные
 * `BlockSpec` объекты. Поэтому каждый кастомный блок нужно ВЫЗВАТЬ тут
 * (`calloutBlock()` и т.д.), как и `createCodeBlockSpec(codeBlockOptions)`.
 */
export function createNotesSchema() {
  return BlockNoteSchema.create({
    blockSpecs: {
      // Встроенные (image/file/video/audio/toggleListItem/table/...), расширяем,
      // не переименовываем.
      ...defaultBlockSpecs,

      // Переопределение: подсвечиваемый синтаксисом code-block.
      codeBlock: createCodeBlockSpec(codeBlockOptions),

      // ── Кастомные блоки (добавляются по фазам) ────────────────────────────
      // Каждый должен быть фабрикой, ВЫЗВАННОЙ тут, ключ совпадает с
      // `config.type` блока.

      // Фаза 1:
      callout: calloutBlock(),

      // Фаза 2:
      gallery: galleryBlock(),
      fileCard: fileCardBlock(),

      // Фаза 3:
      dataTable: dataTableBlock(),

      // Фаза 5: multi-column, официальные блоки @blocknote/xl-multi-column
      // (уже собранные BlockSpecs, регистрируются напрямую, владеют
      // зарезервированными именами column/columnList и логикой нормализации колонок).
      columnList: ColumnListBlock,
      column: ColumnBlock,

      // Фаза 6: бесконечный холст whiteboard (наш Canvas-2D движок, ленивая загрузка).
      whiteboard: whiteboardBlock(),

      // Раскомментировать по мере создания спек:
      //   Фаза 6:  whiteboard: whiteboardBlock(),
      //
      // (column/columnList - зарезервированные внутренние имена узлов в @blocknote/core,
      //  см. docs/editor-2026/README.md §3.)
    },
  });
}

/** Конкретный тип экземпляра схемы (выведен из фабрики). */
export type NotesSchema = ReturnType<typeof createNotesSchema>;

/**
 * Ленивый синглтон. Схема это чистое описание, безопасно шарить по
 * приложению; создание один раз избегает пересборки при каждом монтировании.
 */
let _schema: NotesSchema | null = null;
export function getNotesSchema(): NotesSchema {
  if (_schema === null) _schema = createNotesSchema();
  return _schema;
}

// Удобные алиасы типов для модулей editor2026.
export type NotesBlockSchema = NotesSchema["blockSchema"];
export type NotesInlineSchema = NotesSchema["inlineContentSchema"];
export type NotesStyleSchema = NotesSchema["styleSchema"];

// ── Нормализатор обратной совместимости ─────────────────────────────────────

/**
 * Множество строк `type` блоков, зарегистрированных в схеме. Получается
 * из живого экземпляра (`schema.blockSpecs` - публичное поле), поэтому
 * никогда не расходится с тем что реально зарегистрировано.
 */
export function knownBlockTypes(schema: NotesSchema): Set<string> {
  return new Set(Object.keys(schema.blockSpecs));
}

/** Минимальная форма inline-content, безопасная для деградированного параграфа. */
type LooseInline = { type: string; text?: string; [k: string]: unknown };

/** Распарсенный блок как приходит из `JSON.parse(note.blocknote)`, обрабатывается
 *  свободно, потому что по определению может содержать неизвестные типы. */
type LooseBlock = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
};

/**
 * Извлекает текстовый контент из неизвестного блока, чтобы деградация
 * в параграф не теряла текст пользователя. Сохраняет только записи с
 * полем `text`, экзотика отбрасывается (и так не прокатит через параграф).
 * Заметка: marks/links теряются у НЕИЗВЕСТНЫХ блоков, известные блоки
 * проходят без изменений.
 */
function recoverInline(content: unknown): LooseInline[] {
  if (!Array.isArray(content)) return [];
  const out: LooseInline[] = [];
  for (const node of content) {
    if (
      node &&
      typeof node === "object" &&
      typeof (node as LooseInline).text === "string"
    ) {
      out.push({ type: "text", text: (node as LooseInline).text });
    }
  }
  return out;
}

/**
 * Обходит распарсенный BlockNote документ и деградирует каждый блок с
 * `type` не из `known` в параграф. Возвращает НОВЫЙ массив (вход
 * никогда не мутируется). Запускать между `JSON.parse(note.blocknote)`
 * и `editor.replaceBlocks(...)`.
 *
 * Правила деградации:
 *   - Неизвестный/отсутствующий тип -> становится `paragraph`: сохраняем `id`,
 *     отбрасываем неизвестные `props`, извлекаем текст, РЕКУРСИВНО обходим
 *     `children` (дети сохраняются чтобы вложенный контент не потерялся).
 *   - Известный тип -> проходит как есть, но РЕКУРСИВНО обходим `children`
 *     чтобы глубоко вложенный неизвестный блок тоже поймать.
 */
export function normalizeLoadedDocument<T = PartialBlock>(
  blocks: unknown,
  known: Set<string>,
): T[] {
  if (!Array.isArray(blocks)) return [] as unknown as T[];
  const walk = (list: LooseBlock[]): LooseBlock[] =>
    list.map((block) => {
      if (!block || typeof block !== "object") {
        return { type: "paragraph", content: [] };
      }
      const children = Array.isArray(block.children) ? walk(block.children) : [];
      const type = block.type;
      if (typeof type === "string" && known.has(type)) {
        return children.length || block.children
          ? { ...block, children }
          : block;
      }
      const degraded: LooseBlock = {
        type: "paragraph",
        content: recoverInline(block.content),
      };
      if (typeof block.id === "string") degraded.id = block.id;
      if (children.length) degraded.children = children;
      return degraded;
    });
  return walk(blocks as LooseBlock[]) as unknown as T[];
}
