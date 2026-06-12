// src/editor2026/lib/pasteImages.ts
//
// onPaste перехватчик для BlockNote, обрабатывает необработанные
// image/blob из буфера обмена, когда юзер сделал Print Screen /
// Snipping Tool / Cmd+Shift+4 и делает Ctrl+V в редакторе. Встроенный
// хук `uploadFile` BlockNote срабатывает только для File-дропов/вставок,
// чистые image/* blob из буфера приходят через
// `ClipboardEvent.items[i].getAsFile()` и требуют ручной обработки.
//
// Повторяет проверенный паттерн из CaptureWindow.tsx (там он вынесен для
// textarea быстрого захвата). Синхронный этап извлечения обязателен:
// `clipboardData.items` обнуляются после возврата React-обработчика,
// поэтому если ждать до извлечения File-хендлов, они теряются.
//
// Правила выхода (должны пропустить дефолтную вставку):
//   1. Нет image blob -> это не наша задача.
//   2. В буфере есть text/html или text/plain -> юзер вставляет из
//      форматированного источника (Word, веб со скриншотом). Текст/HTML
//      то, что нужно, а картинка -- метаданные.
//   3. Курсор в code block -> вставляется base64 / URL строкой.
//
// Иначе: preventDefault (чтобы дефолтная вставка не дублировалась),
// загружаем каждую картинку через SHA-дедуплицированный пайплайн
// ассетов, потом добавляем один image-блок на файл ПОСЛЕ текущего блока.

import type { BlockNoteEditor } from "@blocknote/core";
import { useToastStore } from "../../store/toasts";
import { importFile } from "./assets";

/** Истина, если текстовый контент в буфере похож на настоящий.
 *  trim нужен, потому что Snipping Tool / некоторые браузеры кладут
 *  пустой text/plain рядом с картинкой, и мы не должны считать это
 *  "наличием форматированного контента". */
function hasRichText(cd: DataTransfer): boolean {
  return (
    cd.getData("text/html").trim().length > 0 ||
    cd.getData("text/plain").trim().length > 0
  );
}

/**
 * Пытается обработать вставку как вставку изображения. Возвращает `true`,
 * если событие поглощено (вызван preventDefault), `false` -- пускаем
 * дефолтный пайплайн вставки BlockNote.
 *
 * Никогда не бросает ошибок: каждый путь сбоев логируется через toasts
 * и деградирует до "вставка не происходит".
 */
export async function tryHandleImagePaste(
  e: React.ClipboardEvent,
  // У BlockNoteEditor дженерик по умолчанию -- DefaultBlockSchema, но наша
  // схема содержит кастомные блоки (callout, gallery, whiteboard...).
  // Используем BlockNoteEditor<any> для гибкости, нужные методы
  // (getTextCursorPosition / insertBlocks) есть у любого варианта.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any, any, any>,
): Promise<boolean> {
  const cd = e.clipboardData;
  if (!cd) return false;

  // ШАГ 1 -- синхронное извлечение. items[i].getAsFile() возвращает null
  // после возврата обработчика (DataTransferItemList недействителен).
  // Извлекаем все File-хендоны СЕЙЧАС, до любого await.
  const files: File[] = [];
  for (const it of Array.from(cd.items)) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length === 0) return false;

  // ШАГ 2 -- выход, если есть форматированный контент. Юзер вставил
  // форматированный текст (веб, Word), который случайно несет миниатюру.
  if (hasRichText(cd)) return false;

  // ШАГ 3 -- выход, если мы в code block (скорее всего вставляется
  // base64 или путь к файлу).
  let cursorBlock;
  try {
    cursorBlock = editor.getTextCursorPosition().block;
  } catch {
    return false; // редактор не в фокусе / нет курсора
  }
  if (cursorBlock && cursorBlock.type === "codeBlock") return false;

  // Дальше мы перехватываем вставку -- блокируем дефолт, чтобы не
  // дублировался alt-text или сама картинка.
  e.preventDefault();

  // ШАГ 4 -- загрузка + сбор вставленных блоков. Каждый файл
  // независим: если один упал (диск полон / нет прав), логируем +
  // тостим и продолжаем с остальными. Лучше вернуть частичный
  // результат, чем потерять всё при одной ошибке.
  const push = useToastStore.getState().push;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [];
  for (const file of files) {
    try {
      const asset = await importFile(file);
      blocks.push({
        type: "image",
        props: { url: asset.url, name: asset.name, caption: "" },
      });
    } catch (err) {
      console.error("tryHandleImagePaste: import failed:", err);
      push("Не удалось вставить изображение", "error");
    }
  }
  if (blocks.length === 0) return true; // событие всё равно поглощено

  // ШАГ 5 -- вставляем все блоки ПОСЛЕ курсорного блока (такова
  // конвенция BlockNote для нового контента из вставки). Один вызов
  // insertBlocks -- одна транзакция (группировка отмены лучше, чем N
  // отдельных вставок).
  try {
    editor.insertBlocks(blocks, cursorBlock, "after");
  } catch (err) {
    console.error("tryHandleImagePaste: insertBlocks failed:", err);
    push("Не удалось вставить изображение в редактор", "error");
  }

  return true;
}
