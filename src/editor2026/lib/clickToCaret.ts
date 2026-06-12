// src/editor2026/lib/clickToCaret.ts
//
// Исправляет баг "кликаю в пустое пространство после последнего блока --
// ничего не происходит / курсор отскакивает обратно".
//
// Когда кликаешь в пустое пространство редактора (padding или область
// после последнего блока), mousedown-таргет -- сам корневой ProseMirror
// (.bn-editor), а не блок. Нативная обработка ProseMirror часто не может
// найти текстовую позицию там, поэтому курсор не ставится (особенно если
// последний блок -- атомный/медиа). Мы перехватываем клики на корневом
// уровне и ставим TextSelection в ближайший текстовый блок.

import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";

const key = new PluginKey("e26-click-to-caret");

const clickToCaretPlugin = new Plugin({
  key,
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        // Обрабатываем клики только на собственном пустом пространстве
        // редактора (корневой contenteditable). Клики на блоке всплывают
        // от дочернего элемента, поэтому target !== view.dom и мы
        // передаем обработку ProseMirror.
        if (event.target !== view.dom) return false;
        const me = event as MouseEvent;
        if (me.button !== 0) return false; // только левый клик

        const docSize = view.state.doc.content.size;
        let pos = view.posAtCoords({ left: me.clientX, top: me.clientY })?.pos;
        if (pos == null) pos = docSize; // клик ниже всего -> конец документа
        pos = Math.max(0, Math.min(pos, docSize));

        // Резолвим в ближайшую текстовую позицию (ищем назад, чтобы клик
        // в нижний padding попал в последний/хвостовой параграф).
        const $pos = view.state.doc.resolve(pos);
        const sel = TextSelection.near($pos, -1);
        view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
        view.focus();
        event.preventDefault(); // гасим сломанное нативное размещение
        return true;
      },
    },
  },
});

export const clickToCaretExtension = createExtension({
  key: "e26-click-to-caret",
  prosemirrorPlugins: [clickToCaretPlugin],
});
