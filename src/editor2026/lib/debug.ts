// src/editor2026/lib/debug.ts
//
// Диагностика редактора 2026 по запросу. Включается в консоли devtools через
//   localStorage.setItem("e26debug", "1")   // потом перезагрузить
// выключается через
//   localStorage.removeItem("e26debug")
//
// При включении логирует (с высоким разрешением по времени) каждое изменение
// выделения, фокус/размытие, mousedown и транзакцию контента/выделения
// внутри редактора, чтобы точно видеть, что сбрасывает курсор после клика.

import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";

export const E26_DEBUG =
  typeof localStorage !== "undefined" &&
  localStorage.getItem("e26debug") === "1";

function now(): string {
  return (typeof performance !== "undefined" ? performance.now() : 0).toFixed(1);
}

/** Лог в консоль с таймстемпом, no-op если `e26debug` не включен. */
export function dlog(...args: unknown[]): void {
  if (E26_DEBUG) console.log(`[e26 ${now()}]`, ...args);
}

const key = new PluginKey("e26-debug");

const debugPlugin = new Plugin({
  key,
  view() {
    return {
      update(view, prevState) {
        const sel = view.state.selection;
        const prev = prevState.selection;
        if (sel.from !== prev.from || sel.to !== prev.to || sel.empty !== prev.empty) {
          dlog(
            `selection ${prev.from}-${prev.to} -> ${sel.from}-${sel.to}`,
            `empty=${sel.empty} kind=${sel.constructor?.name} focus=${view.hasFocus()}`,
          );
        }
      },
    };
  },
  props: {
    handleDOMEvents: {
      mousedown(_view, e) {
        const t = e.target as HTMLElement | null;
        dlog("mousedown on", t?.className || t?.nodeName || t);
        return false;
      },
      focus() {
        dlog("FOCUS");
        return false;
      },
      blur() {
        dlog("BLUR");
        return false;
      },
    },
  },
  appendTransaction(trs) {
    for (const tr of trs) {
      if (tr.docChanged || tr.selectionSet) {
        dlog(
          `tx docChanged=${tr.docChanged} selSet=${tr.selectionSet}`,
          `steps=${tr.steps.length} -> sel ${tr.selection.from}-${tr.selection.to}`,
        );
      }
    }
    return null;
  },
});

export const debugExtension = createExtension({
  key: "e26-debug",
  prosemirrorPlugins: [debugPlugin],
});
