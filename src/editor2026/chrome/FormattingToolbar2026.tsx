// src/editor2026/chrome/FormattingToolbar2026.tsx
//
// Хром фазы 4: плавающая панель форматирования выделения. Сохраняет все
// стандартные кнопки BlockNote и добавляет наши: Выделение, Wiki-link
// обертка, "превратить в выноску" и выравнивание изображений (только когда
// выбрана картинка).
//
// Рендерится как дочерний элемент <BlockNoteView formattingToolbar={false}>,
// поэтому заменяет (а не дублирует) встроенный тулбар. Кастомные кнопки
// должны передавать `label` (иконка без текста требует его в 0.51.2).

import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useSelectedBlocks,
} from "@blocknote/react";
import { Highlighter, Link2, MessageSquareQuote } from "lucide-react";

const HIGHLIGHT_COLOR = "yellow"; // значение из палитры backgroundColor BlockNote
const CALLOUT_CONVERTIBLE = new Set([
  "paragraph",
  "heading",
  "quote",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

function HighlightButton() {
  // todo нужен правильный Generic для NotesSchema
  const editor = useBlockNoteEditor() as any;
  const Components = useComponentsContext()!;
  const isOn = Boolean(editor.getActiveStyles?.().backgroundColor);
  return (
    <Components.FormattingToolbar.Button
      label="Выделить"
      mainTooltip="Выделить фон"
      icon={<Highlighter size={16} />}
      isSelected={isOn}
      onClick={() => {
        if (isOn) editor.removeStyles({ backgroundColor: HIGHLIGHT_COLOR });
        else editor.addStyles({ backgroundColor: HIGHLIGHT_COLOR });
        editor.focus();
      }}
    />
  );
}

function WikiLinkButton() {
  const editor = useBlockNoteEditor() as any;
  const Components = useComponentsContext()!;
  return (
    <Components.FormattingToolbar.Button
      label="Wiki-ссылка"
      mainTooltip="Обернуть в [[ссылку]]"
      icon={<Link2 size={16} />}
      onClick={() => {
        const view = editor.prosemirrorView;
        if (!view) return;
        const { state } = view;
        const { from, to } = state.selection;
        const text = from === to ? "" : state.doc.textBetween(from, to);
        const wrapped = `[[${text}]]`;
        const tr = state.tr.insertText(wrapped, from, to);
        view.dispatch(tr);
        view.focus();
      }}
    />
  );
}

function CalloutConvertButton() {
  const editor = useBlockNoteEditor() as any;
  const Components = useComponentsContext()!;
  const blocks = useSelectedBlocks(editor);
  const single = blocks.length === 1 ? blocks[0] : undefined;
  const canConvert =
    "callout" in editor.schema.blockSchema &&
    single !== undefined &&
    CALLOUT_CONVERTIBLE.has(single.type);
  if (!canConvert || !single) return null;
  return (
    <Components.FormattingToolbar.Button
      label="В выноску"
      mainTooltip="Превратить в выноску"
      icon={<MessageSquareQuote size={16} />}
      onClick={() => {
        editor.updateBlock(single, { type: "callout" });
        editor.focus();
      }}
    />
  );
}

export function FormattingToolbar2026() {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <FormattingToolbar>
          {...getFormattingToolbarItems()}
          <HighlightButton key="e26-highlight" />
          <WikiLinkButton key="e26-wikilink" />
          <CalloutConvertButton key="e26-callout" />
        </FormattingToolbar>
      )}
    />
  );
}
