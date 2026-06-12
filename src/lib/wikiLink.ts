/**
 * Wiki-ссылки `[[Заголовок заметки]]` между заметками, задел под будущий граф.
 *
 * Сделано декорацией ProseMirror, а не своим inline-типом: `[[...]]` остаётся
 * обычным текстом в документе и без изменений переживает markdown импорт/экспорт
 * BlockNote. Мы только рисуем декорации поверх скобок (подсветка) и перехватываем
 * клики (переход). Резолвим по заголовку, как в Obsidian.
 */

import { createExtension } from "@blocknote/core";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { useNotesStore } from "../store/notes";
import { flattenNotes } from "./treeUtils";

// `[[Цель]]`, ловим внутренний текст, вложенные скобки нельзя.
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;
const DATA_ATTR = "data-wikilink";

export const wikiLinkPluginKey = new PluginKey<DecorationSet>("wikiLink");

/**
 * Проходит по всем текстовым нодам, ищет `[[...]]` и возвращает DecorationSet
 * со стилем для каждого совпадения. Рабочая ссылка или битая решаем по текущему
 * дереву заметок. Строим заново на каждое изменение документа (и на смену
 * заметки, ведь replaceBlocks это тоже изменение), для заметок это дёшево.
 */
function buildDecorations(doc: PMNode): DecorationSet {
  // Разворачиваем набор заголовков один раз за проход: buildDecorations
  // зовётся на каждое изменение, гонять обход дерева на каждое совпадение жалко.
  const titles = new Set(
    flattenNotes(useNotesStore.getState().tree).map((n) =>
      n.title.trim().toLowerCase(),
    ),
  );
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    // Код пропускаем: `[[x]]` внутри код-блока или инлайн-кода это просто текст,
    // не ссылка (как в extractLinks, который вырезает код для графа).
    if (node.marks.some((mark) => mark.type.name === "code")) return;
    if (/code/i.test(parent?.type.name ?? "")) return;
    const text = node.text;
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const target = m[1].trim();
      const from = pos + m.index;
      const to = from + m[0].length;
      const resolved = titles.has(target.toLowerCase());
      decorations.push(
        Decoration.inline(from, to, {
          class: resolved ? "bn-wikilink" : "bn-wikilink bn-wikilink--broken",
          [DATA_ATTR]: target,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

const wikiLinkPlugin = new Plugin<DecorationSet>({
  key: wikiLinkPluginKey,
  state: {
    init: (_config, state) => buildDecorations(state.doc),
    // Пересобираем на реальную правку или по запросу через refreshWikiLinks
    // (дерево заметок изменилось, статус рабочая/битая мог поменяться). Иначе
    // просто прогоняем старые декорации через транзакцию.
    apply: (tr, old) =>
      tr.docChanged || tr.getMeta(wikiLinkPluginKey)
        ? buildDecorations(tr.doc)
        : old.map(tr.mapping, tr.doc),
  },
  props: {
    decorations(state) {
      return wikiLinkPluginKey.getState(state);
    },
    // Что значит клик решает стор: перейти (совпал один заголовок), открыть
    // пикер выбора (совпало несколько) или вернуть false. В последнем случае
    // клик уходит в обычное редактирование (для битой ссылки или ссылки на
    // саму себя), чтобы каретка встала на текст и его можно было поправить, а
    // не утыкаться в мёртвый клик.
    handleClick(_view, _pos, event) {
      const el = (event.target as HTMLElement | null)?.closest?.(
        `[${DATA_ATTR}]`,
      );
      const target = el?.getAttribute(DATA_ATTR);
      if (!target) return false;
      return useNotesStore.getState().openNoteByTitle(target);
    },
  },
});

export const wikiLinkExtension = createExtension({
  key: "wikiLink",
  prosemirrorPlugins: [wikiLinkPlugin],
});

/**
 * Заставляет декорации пересобраться, зови при изменении дерева заметок
 * (заголовок добавили/переименовали/удалили), чтобы стиль рабочая/битая был
 * актуальным даже без правки открытого документа. Транзакция не трогает контент,
 * так что onChange BlockNote (завязанный на docChanged) не срабатывает и ничего
 * не сохраняется.
 */
export function refreshWikiLinks(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(wikiLinkPluginKey, true));
}

