import { createExtension } from "@blocknote/core";
import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { resolveIcon } from "./iconize";
import { builtinIcon, customIconUrl, emojiCodepoint, iconAsset, iconShortcodes, isEmojiIcon, sanitizeIconSvg } from "./iconizeCatalog";
import { useIconizeStore } from "../store/iconize";
import { useNotesStore } from "../store/notes";
import { flattenNotes } from "./treeUtils";

export function iconDom(icon: string, color?: string | null): HTMLElement {
  const span = document.createElement("span");
  span.className = "iconize-inline"; span.contentEditable = "false"; span.setAttribute("aria-label", icon); span.title = icon;
  if (color) span.style.color = color;
  const state = useIconizeStore.getState().data, custom = state.customIcons.find(item => item.id === icon);
  const svg = custom?.svg ? sanitizeIconSvg(custom.svg) : null;
  if (svg || custom?.png || isEmojiIcon(icon) && state.settings.emojiStyle === "twemoji") {
    const img = document.createElement("img"); img.alt = ""; img.style.width = "1em"; img.style.height = "1em";
    img.src = svg ? customIconUrl(svg, color) : custom?.png || iconAsset("twemoji/" + emojiCodepoint(icon) + ".svg");
    img.onerror = () => { span.textContent = isEmojiIcon(icon) ? icon : ""; };
    span.append(img);
  } else if (isEmojiIcon(icon)) span.textContent = icon;
  else {
    const glyph = builtinIcon(icon);
    if (glyph) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("width", "1em"); svg.setAttribute("height", "1em");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", iconAsset(glyph.pack + ".svg#" + glyph.id)); svg.append(use); span.append(svg);
    }
  }
  return span;
}
const key = new PluginKey<DecorationSet>("iconize");
const revisions = new WeakMap<object, number>(); let nextRevision = 0;
function decorations(doc: PMNode, selection: { from: number; to: number }) {
  const state = useIconizeStore.getState().data;
  if (!revisions.has(state)) revisions.set(state, ++nextRevision);
  const revision = revisions.get(state);
  if (!state.settings.iconsInNotesEnabled && !state.settings.iconsInLinksEnabled) return DecorationSet.empty;
  const knownTitles = new Map<string, ReturnType<typeof flattenNotes>[number] | null>();
  for (const note of flattenNotes(useNotesStore.getState().tree)) for (const name of [note.title, note.id, ...(note.aliases ?? [])]) {
    const title = name.toLocaleLowerCase(); knownTitles.set(title, knownTitles.has(title) ? null : note);
  }
  const result: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text || node.marks.some(mark => mark.type.name === "code") || /code/i.test(parent?.type.name ?? "")) return;
    if (state.settings.iconsInNotesEnabled) {
      let offset = 0;
      for (const part of iconShortcodes(node.text, state.settings.iconIdentifier)) {
        const from = pos + offset, to = from + part.text.length; offset += part.text.length;
        if (!part.icon || selection.from > from && selection.from < to || selection.to > from && selection.to < to) continue;
        const glyph = builtinIcon(part.icon);
        if (!state.customIcons.some(item => item.id === part.icon) && (!glyph || glyph.id !== part.icon)) continue;
        result.push(Decoration.inline(from, to, { class: "iconize-shortcode-source" }));
        result.push(Decoration.widget(from, () => iconDom(part.icon!, state.settings.iconColor), { side: -1, key: part.icon + ":" + from + ":" + revision, ignoreSelection: true }));
      }
    }
    if (state.settings.iconsInLinksEnabled) for (const match of node.text.matchAll(/\[\[([^\[\]]+)\]\]/g)) {
      const target = match[1].split("|")[0].split("#")[0].replace(/\.md$/i, "").trim().toLocaleLowerCase();
      const note = knownTitles.get(target); if (!note) continue;
      const icon = resolveIcon(state, "file", note.id + ".md", note);
      if (icon?.icon) result.push(Decoration.widget(pos + match.index!, () => iconDom(icon.icon!, icon.color), { side: -1, key: "link:" + note.id + ":" + icon.icon + ":" + icon.color + ":" + revision + ":" + match.index, ignoreSelection: true }));
    }
  });
  return DecorationSet.create(doc, result);
}
const plugin = new Plugin<DecorationSet>({
  key,
  state: { init: (_, state) => decorations(state.doc, state.selection), apply: (tr, previous) => tr.docChanged || tr.selectionSet || tr.getMeta(key) ? decorations(tr.doc, tr.selection) : previous.map(tr.mapping, tr.doc) },
  props: { decorations: state => key.getState(state) },
  view: view => {
    const update = () => { if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true)); };
    const iconUnsubscribe = useIconizeStore.subscribe(update);
    const noteUnsubscribe = useNotesStore.subscribe((next, prev) => { if (next.tree !== prev.tree) update(); });
    return { destroy: () => { iconUnsubscribe(); noteUnsubscribe(); } };
  },
});
export const iconizeExtension = createExtension({ key: "iconize", prosemirrorPlugins: [plugin] });
