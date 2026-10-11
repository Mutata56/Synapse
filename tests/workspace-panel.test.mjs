import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

test("the active tab renders its own screen while a previously edited note remains cached", async t => {
  const directory = await mkdtemp(join(tmpdir(), "synapse-panel-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { notes: { settings: {animations:false,modules:{notes:true,files:true,graph:true,search:true}}, view: "notes", activeId: "cached", activeNote: { id: "cached", markdownSource: false }, editorReloadNonce: 0 }, workspace: {
    tabs: [{ id: "note", target: { kind: "note", noteId: "cached" } }, { id: "settings", target: { kind: "view", view: "settings" } }, { id: "graph", target: { kind: "view", view: "graph" } }], activeTabId: "note",
  } };
  globalThis.__workspacePanelFixture = state;
  t.after(() => { delete globalThis.__workspacePanelFixture; });
  const output = join(directory, "app.cjs");
  await build({ bundle: true, platform: "node", format: "cjs", outfile: output,
    stdin: { contents: "import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import App from './src/App'; export const render = () => renderToStaticMarkup(React.createElement(App,{bootstrap:false}));", resolveDir: process.cwd(), loader: "tsx" },
    plugins: [{ name: "panel-isolation", setup(builder) {
      builder.onResolve({ filter: /^\.\/components\// }, args => args.importer.endsWith("/src/App.tsx") ? ({ path: args.path.split("/").at(-1), namespace: "panel-component" }) : undefined);
      builder.onResolve({ filter: /^\.\/editor2026\/Editor2026$/ }, () => ({ path: "Editor2026", namespace: "panel-component" }));
      builder.onLoad({ filter: /.*/, namespace: "panel-component" }, args => ({ contents: args.path === "WorkspaceChrome"
        ? "import React from 'react'; export const WorkspaceChrome=({children})=>React.createElement('main',null,children);"
        : `import React from 'react'; export const ${args.path}=()=>React.createElement('section',{'data-screen':'${args.path}'});`, loader: "js", resolveDir: process.cwd() }));
      builder.onResolve({ filter: /^\.\/store\/(notes|workspace|templates|iconize)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "panel-store" }));
      builder.onLoad({ filter: /.*/, namespace: "panel-store" }, args => ({ contents: args.path === "notes"
        ? "export const useNotesStore=s=>s(globalThis.__workspacePanelFixture.notes); export const flushAllPending=async()=>{};"
        : args.path === "workspace" ? "export const useWorkspaceStore=s=>s(globalThis.__workspacePanelFixture.workspace);"
        : args.path === "iconize" ? "export const useIconizeStore=s=>s({picker:null});"
        : "export const useTemplatesStore={getState:()=>({refresh:async()=>{}})};" }));
      builder.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, namespace: "panel-helper" }));
      builder.onResolve({ filter: /^\.\/(lib\/(i18n|fullTextSearch|templates)|editor2026\/lib\/assets)$/ }, args => ({ path: args.path, namespace: "panel-helper" }));
      builder.onLoad({ filter: /.*/, namespace: "panel-helper" }, () => ({ contents: "export const t=s=>s; export const isTauri=()=>false; export const listen=async()=>()=>{}; export const getCurrentWindow=()=>({label:'main'}); export const warmAssetResolver=async()=>{}; export const warmIndex=async()=>{}; export const seedTemplatesIfEmpty=async()=>{};" }));
    } }] });
  const { render } = createRequire(import.meta.url)(output);
  async function ready() { render(); await new Promise(resolve => setImmediate(resolve)); return render(); }
  assert.match(await ready(), /data-screen="Editor2026"/);
  state.workspace.activeTabId = "settings";
  const settings = await ready();
  assert.match(settings, /data-screen="SettingsView"/);
  assert.doesNotMatch(settings, /data-screen="Editor2026"/);
  state.workspace.activeTabId = "graph";
  assert.match(await ready(), /data-screen="GraphView"/);
  state.workspace.activeTabId = "note";
  assert.match(await ready(), /data-screen="Editor2026"/);
});
