/**
 * Подсветка `#тег` внутри редактора.
 *
 * Как и `lib/wikiLink.ts`, это декорация ProseMirror, а не свой inline-нод:
 * `#тег` остаётся обычным текстом, без изменений переживает markdown
 * импорт/экспорт BlockNote, и extractTags (storage.ts) находит его для меты
 * заметки. Мы только рисуем декорацию поверх совпадения.
 */

import { createExtension } from "@blocknote/core";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { useNotesStore } from "../store/notes";

// Как extractTags в storage.ts: тег это `#` (перед ним не словесный символ),
// потом буква, дальше буквы / цифры / `_` / `-` / `/`. Негативный lookbehind
// держит начало совпадения на `#`, так декорация покрывает ровно "#тег" (а
// `#1`, `#999` не теги, должна быть буква).
const TAG_RE = /(?<![A-Za-z0-9_/])#([\p{L}][\p{L}\p{N}_/-]{0,40})/gu;
// Хранит тег (в нижнем регистре), чтобы по клику открыть вид Тегов с фильтром
// по нему. Нижний регистр, как extractTags хранит их в мете заметки.
const DATA_ATTR = "data-tag";

const tagPluginKey = new PluginKey<DecorationSet>("hashtag");

/** Проходит по текстовым нодам, ищет `#тег` и возвращает DecorationSet.
 *  Пересобирается на каждое изменение документа, для заметок дёшево. */
function buildTagDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    // Код пропускаем: `#x` внутри инлайн-кода или код-блока это просто текст
    // (как декорации в wikiLink).
    if (node.marks.some((mark) => mark.type.name === "code")) return;
    if (/code/i.test(parent?.type.name ?? "")) return;
    const text = node.text;
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      decorations.push(
        Decoration.inline(from, to, {
          class: "bn-tag",
          [DATA_ATTR]: m[1].toLowerCase(),
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

const tagPlugin = new Plugin<DecorationSet>({
  key: tagPluginKey,
  state: {
    init: (_config, state) => buildTagDecorations(state.doc),
    apply: (tr, old) =>
      tr.docChanged
        ? buildTagDecorations(tr.doc)
        : old.map(tr.mapping, tr.doc),
  },
  props: {
    decorations(state) {
      return tagPluginKey.getState(state);
    },
    // Клик по #тегу открывает вид Тегов с фильтром по нему. Возвращаем true,
    // чтобы поглотить клик (как в wiki-ссылках).
    handleClick(_view, _pos, event) {
      const el = (event.target as HTMLElement | null)?.closest?.(
        `[${DATA_ATTR}]`,
      );
      const tag = el?.getAttribute(DATA_ATTR);
      if (!tag) return false;
      const store = useNotesStore.getState();
      store.setCurrentTag(tag);
      store.setView("tags");
      return true;
    },
  },
});

export const tagExtension = createExtension({
  key: "hashtag",
  prosemirrorPlugins: [tagPlugin],
});
