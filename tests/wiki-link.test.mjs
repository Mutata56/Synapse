import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Exercise the real ProseMirror plugin with an isolated note index; no vault I/O.
const compiled = await build({
  stdin: {
    contents: `export * from './src/lib/wikiLink.ts';
      export { Schema } from 'prosemirror-model';
      export { EditorState, TextSelection } from 'prosemirror-state';`,
    resolveDir: new URL("..", import.meta.url).pathname,
  },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "isolated-note-index", setup(builder) {
    builder.onResolve({ filter: /\/store\/notes$/ }, () => ({ path: "notes", namespace: "test-store" }));
    builder.onLoad({ filter: /.*/, namespace: "test-store" }, () => ({
      contents: "export const useNotesStore = { getState: () => globalThis.__wikiLinkTestStore };",
    }));
  } }],
});
const { wikiLinkExtension, wikiLinkPluginKey, refreshWikiLinks, Schema, EditorState, TextSelection } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const plugin = wikiLinkExtension().prosemirrorPlugins[0];
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    codeBlock: { group: "block", content: "text*", code: true },
    text: { group: "inline" },
  },
  marks: { code: {} },
});
function fixture(doc) {
  let indexReads = 0;
  const calls = [];
  const store = {
    get tree() { indexReads++; return [{ kind: "note", note: { title: "Заметка" } }]; },
    openNoteByTitle: (target, newTab) => { calls.push({ target, newTab }); return target === "Заметка"; },
  };
  globalThis.__wikiLinkTestStore = store;
  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  return { state, calls, store, reads: () => indexReads };
}
const paragraph = text => schema.node("paragraph", null, text ? schema.text(text) : undefined);
const links = state => wikiLinkPluginKey.getState(state).find().filter(decoration => decoration.spec.wikiLink);

test("link decorations retain source exactly and leave inline/fenced code and incomplete links alone", () => {
  const raw = "До [[Заметка]] и [[Нет заметки]], потом [[незакрытая";
  const doc = schema.node("doc", null, [
    paragraph(raw),
    schema.node("paragraph", null, schema.text("[[literal]]", [schema.mark("code")])),
    schema.node("codeBlock", null, schema.text("[[literal]]")),
  ]);
  const { state } = fixture(doc);
  assert.equal(state.doc.child(0).textContent, raw);
  const targets = wikiLinkPluginKey.getState(state).find().filter(decoration => decoration.type.attrs["data-wikilink"]);
  assert.deepEqual(targets.map(link => link.type.attrs["data-wikilink"]), ["Заметка", "Нет заметки"]);
  assert.deepEqual(targets.map(link => doc.textBetween(link.from, link.to)), ["Заметка", "Нет заметки"]);
  const syntax = wikiLinkPluginKey.getState(state).find().filter(decoration => decoration.type.attrs.class === "bn-wikilink-syntax");
  assert.deepEqual(syntax.map(decoration => doc.textBetween(decoration.from, decoration.to)), ["[[", "]]", "[[", "]]"]);
  assert.match(links(state)[1].type.attrs.class, /broken/);
});

test("caret exposes only the active link and reuses the index without editing or saving text", () => {
  const { state, reads } = fixture(schema.node("doc", null, paragraph("До [[Заметка]] и [[Заметка]].")));
  const first = links(state)[0];
  const tr = state.tr.setSelection(TextSelection.create(state.doc, first.from + 3));
  assert.equal(tr.docChanged, false);
  const editing = state.apply(tr);
  assert.equal(wikiLinkPluginKey.getState(editing), wikiLinkPluginKey.getState(state));
  const active = plugin.props.decorations(editing).find().filter(decoration => decoration.type.attrs.class === "bn-wikilink--editing");
  assert.deepEqual(active.map(decoration => [decoration.from, decoration.to]), [[first.from, first.to]]);
  const outside = editing.apply(editing.tr.setSelection(TextSelection.create(editing.doc, 1)));
  assert.equal(plugin.props.decorations(outside).find().some(decoration => decoration.type.attrs.class === "bn-wikilink--editing"), false);
  assert.equal(outside.doc, state.doc);
  assert.equal(reads(), 1, "moving the caret must not rescan the note tree");
});

test("text edits refresh the link range and title refreshes never modify the document", () => {
  const { state, store } = fixture(schema.node("doc", null, paragraph("[[Заметка]]")));
  const edited = state.apply(state.tr.insertText("Новая ", 3));
  assert.equal(edited.doc.textContent, "[[Новая Заметка]]");
  assert.match(links(edited)[0].type.attrs.class, /broken/);
  Object.defineProperty(store, "tree", { value: [{ kind: "note", note: { title: "Новая Заметка" } }] });
  let refreshed;
  refreshWikiLinks({ state: edited, dispatch: transaction => {
    assert.equal(transaction.docChanged, false);
    refreshed = edited.apply(transaction);
  } });
  assert.equal(refreshed.doc, edited.doc);
  assert.equal(links(refreshed)[0].type.attrs.class, "bn-wikilink");
});

test("clicking the visible label retains ordinary and Cmd-click navigation and editable broken links", () => {
  const { calls } = fixture(schema.node("doc", null, paragraph("[[Заметка]]")));
  const event = (target, metaKey) => ({ metaKey, target: { closest: () => ({ getAttribute: () => target }) } });
  assert.equal(plugin.props.handleClick(null, 0, event("Заметка", false)), true);
  assert.equal(plugin.props.handleClick(null, 0, event("Заметка", true)), true);
  assert.equal(plugin.props.handleClick(null, 0, event("Нет заметки", false)), false);
  assert.deepEqual(calls, [{ target: "Заметка", newTab: false }, { target: "Заметка", newTab: true }, { target: "Нет заметки", newTab: false }]);
});
