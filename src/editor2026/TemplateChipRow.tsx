// src/editor2026/TemplateChipRow.tsx
//
// Строка быстрого применения шаблонов, показывается ТОЛЬКО когда текущий
// документ редактора пуст (один пустой параграф). Рендерит 3-4 последних
// отредактированных шаблона как чипы + ссылку "Все шаблоны..." которая
// открывает полный пикер.
//
// Расположение: в потоке документа над BlockNote view, НЕ поверх текста,
// поэтому не наезжает на набранный контент. Строка схлопывается в ноль
// при исчезновении, так что ввод символа не сдвигает область редактора.

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { useTemplatesStore } from "../store/templates";
import { type TemplateMeta } from "../lib/templates";
import { t } from "../lib/i18n";
import { isEmptyDoc } from "./loadDocument";
import { type NotesSchema } from "./schema";

/** Максимум чипов быстрого применения. Удерживает строку в одну линию
 *  на типичных разрешениях, остальные доступны через пикер. */
const MAX_CHIPS = 4;

const FADE_TRANSITION = { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };

/** Свободный хэндлер редактора, используем только `document`,
 *  `tryParseMarkdownToBlocks` и `replaceBlocks`, которые есть у каждого
 *  BlockNote editor. Типизирован как `any` потому что generic-типы BlockNote
 *  не удовлетворяют тут `Promise<unknown[]>`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

export type TemplateChipRowProps = {
  /** True если документ редактора сейчас пуст (`isEmptyDoc(editor.document)`).
   *  Когда false, строка исчезает и схлопывается в ноль. */
  visible: boolean;
  editor: AnyEditor;
  schema: NotesSchema;
};

// ─── Компонент ─────────────────────────────────────────────────────────────

// NOTE: `schema` в сигнатуре оставлен для совместимости с будущими
// schema-aware превью, но больше не читается, путь применения
// делегируется через store action (saveNote -> reloadNonce).

export function TemplateChipRow({ visible, editor, schema: _schema }: TemplateChipRowProps) {
  const templates = useTemplatesStore((s) => s.templates);
  const openTemplatePicker = useTemplatesStore((s) => s.openTemplatePicker);
  const applyTemplateToActiveNote = useTemplatesStore(
    (s) => s.applyTemplateToActiveNote,
  );

  const top = useMemo(() => templates.slice(0, MAX_CHIPS), [templates]);

  const applyTemplate = async (meta: TemplateMeta): Promise<void> => {
    // Еще раз проверяем что документ пуст: между рендером и кликом
    // пользователь мог начать печатать. Применение затрет его ввод.
    if (!isEmptyDoc(editor.document)) return;
    // Делегируем store action, он пишет контент + lossless blocknote
    // + хеш через saveNote() ПЕРВЫМ делом, потом бампает editorReloadNonce
    // для пере-монтирования документа. Это надежный путь: если бы мы
    // вызвали replaceBlocks напрямую и onChange не сработал для
    // программной замены, новый контент жил бы только в памяти до
    // следующего нажатия клавиши, Alt+F4 между = потеря.
    await applyTemplateToActiveNote(meta.id);
  };

  return (
    <AnimatePresence initial={false}>
      {visible && top.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 4, height: 0 }}
          transition={FADE_TRANSITION}
          // pointer-events-none в exit-состоянии был бы идеален, но
          // AnimatePresence размонтирует после завершения exit, промежуточные
          // кадры слишком коротки для кликов. Оставляем aria-hidden=false.
          className="max-w-3xl mx-auto px-6 pt-2 pb-1 overflow-hidden"
        >
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs text-[var(--color-text-tertiary)] mr-1">
              {t("Шаблоны")}
            </span>
            {top.map((meta) => (
              <button
                key={meta.id}
                type="button"
                // Отрицательный tabIndex при скрытии был бы полезен, но
                // родитель схлопывается в 0 высоты + AnimatePresence размонтирует.
                tabIndex={visible ? 0 : -1}
                onClick={() => void applyTemplate(meta)}
                className="px-2.5 py-1 rounded-md text-xs bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                title={`Применить шаблон «${meta.name}»`}
              >
                {meta.icon ? (
                  <span className="mr-1.5">{meta.icon}</span>
                ) : null}
                {meta.name}
              </button>
            ))}
            <button
              type="button"
              tabIndex={visible ? 0 : -1}
              onClick={() => openTemplatePicker("pick")}
              className="px-2 py-1 rounded-md text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-white/[0.04] transition-colors"
            >
              Все шаблоны…
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// (Ранняя реверсия ре-экспортировала `hashString` для удобства инвалидации
// bnHash. Теперь путь применения идет через `applyTemplateToActiveNote`
// который сам считает хеш, поэтому ре-экспорт не нужен.)
