import assert from "node:assert/strict";
import { test, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createStore } from "zustand/vanilla";

const directory = await mkdtemp(join(tmpdir(), "workspace-tests-"));
const pureEntry = join(directory, "model.mjs"), storeEntry = join(directory, "store.mjs");
await build({ entryPoints: ["src/lib/workspaceTabs.ts"], bundle: true, platform: "node", format: "esm", outfile: pureEntry });
await build({ entryPoints: ["src/store/workspace.ts"], bundle: true, platform: "node", format: "esm", outfile: storeEntry, plugins: [{ name: "workspace-fs-fixture", setup(builder) {
  builder.onResolve({ filter: /^\.\/notes$/ }, () => ({ path: "notes", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useNotesStore=globalThis.workspaceTest.notes; export const flushAllPending=()=>globalThis.workspaceTest.flush();", loader: "js" }));
} }] });
const model = await import(pathToFileURL(pureEntry));
after(() => rm(directory, { recursive: true, force: true }));
const note = noteId => ({ kind: "note", noteId });

test("a file replaces the empty tab; another tab remains open and duplicates focus the existing file", () => {
  let state = model.emptySession("initial");
  state = model.openWorkspaceTarget(state, note("a"), "ignored", true);
  assert.equal(state.tabs.length, 1); assert.equal(state.activeTabId, "initial");
  state = model.openWorkspaceTarget(state, note("b"), "second", true);
  assert.equal(state.tabs.length, 2); assert.equal(state.activeTabId, "second");
  state = model.openWorkspaceTarget(state, note("a"), "third", true);
  assert.equal(state.tabs.length, 2); assert.equal(state.activeTabId, "initial");
});

test("closing the current tab chooses its neighbour; closing the last tab leaves a usable empty page", () => {
  const state = { tabs: [{ id: "a", target: note("A") }, { id: "b", target: note("B") }, { id: "c", target: note("C") }], activeTabId: "b" };
  let next = model.closeWorkspaceTab(state, "b", "new");
  assert.equal(next.activeTabId, "c");
  next = model.closeWorkspaceTab(next, "c", "new"); assert.equal(next.activeTabId, "a");
  next = model.closeWorkspaceTab(next, "a", "new"); assert.deepEqual(next, model.emptySession("new"));
});

test("tab reordering preserves active selection and ignores foreign drag ids", () => {
  const state = { tabs: ["a", "b", "c"].map(id => ({ id, target: note(id) })), activeTabId: "b" };
  const next = model.reorderWorkspaceTabs(state, "c", "a");
  assert.deepEqual(next.tabs.map(tab => tab.id), ["c", "a", "b"]); assert.equal(next.activeTabId, "b");
  assert.equal(model.reorderWorkspaceTabs(state, "foreign", "a"), state);
});

test("session recovery rejects invalid data and serializes no document content or UI actions", () => {
  const raw = JSON.stringify({ version: 1, activeTabId: "missing", tabs: [{ id: "a", target: note("ВУЗ/конспект") }, { id: "a", target: note("duplicate") }, { id: "bad", target: { kind: "view", view: "unknown" } }, { id: "body", target: { kind: "note", noteId: "note", content: "private document" } }] });
  const restored = model.parseWorkspaceSession(raw, "fallback");
  assert.equal(restored.activeTabId, "a"); assert.equal(restored.tabs.length, 2);
  const serialized = model.serializeWorkspaceSession({ ...restored, activeNote: { content: "private document" }, sidebarWidth: 99 });
  assert(!serialized.includes("private document")); assert(!serialized.includes("sidebarWidth"));
  assert.deepEqual(model.parseWorkspaceSession("broken", "fallback"), model.emptySession("fallback"));
  assert.deepEqual(model.parseWorkspaceSession('{"version":2,"tabs":[]}', "fallback"), model.emptySession("fallback"));
});

let fixtureNumber = 0;
async function fixture(t, select) {
  const saved = new Map(), events = [], writes = [], original = {};
  const notes = createStore(() => ({ tree: [], view: "notes", activeId: null, activeNote: null,
    selectNote: async id => { events.push(`read:${id}`); await select?.(id); notes.setState({ activeId: id, activeNote: id === "missing" ? null : { id } }); },
    closeActiveNote: async () => { events.push("close"); notes.setState({ activeId: null, activeNote: null }); },
    setView: view => notes.setState({ view }),
  }));
  const globals = { window: { innerWidth: 1440, setTimeout: () => 0, clearTimeout() {} }, localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); writes.push(key); } }, workspaceTest: { notes, flush: async () => { events.push("flush"); } } };
  for (const [key, value] of Object.entries(globals)) { original[key] = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { value, writable: true, configurable: true }); }
  const module = await import(`${pathToFileURL(storeEntry)}?fixture=${fixtureNumber++}`);
  const unsubscribe = module.connectWorkspaceNavigation();
  t.after(() => { unsubscribe(); for (const [key, descriptor] of Object.entries(original)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  return { workspace: module.useWorkspaceStore, notes, events, saved, writes };
}

test("transient loading and help state do not rewrite persisted destinations; pane changes retain the saved session", async t => {
  const { workspace, saved, writes } = await fixture(t);
  await workspace.getState().openNote("A");
  const session = saved.get("synapse-workspace-session-v1");
  const initialWrites = writes.length;
  workspace.getState().showHelp(true); workspace.getState().showHelp(false);
  assert.equal(writes.length, initialWrites);
  workspace.getState().toggleSidebar();
  assert.equal(saved.get("synapse-workspace-session-v1"), session);
  assert.equal(writes.length, initialWrites + 1);
});

test("opening and closing a note flushes pending edits before changing the active document", async t => {
  const { workspace, notes, events } = await fixture(t);
  await workspace.getState().openNote("A");
  assert.deepEqual(events, ["flush", "read:A"]);
  await workspace.getState().openNote("B", true);
  assert.equal(workspace.getState().tabs.length, 2);
  await workspace.getState().closeTab();
  assert.equal(notes.getState().activeId, "A");
  assert.deepEqual(events.slice(-2), ["flush", "read:A"]);
});

test("failed file reads preserve the previous selected tab and restore its document", async t => {
  const { workspace, notes } = await fixture(t);
  await workspace.getState().openNote("A"); const previous = workspace.getState().activeTabId;
  await workspace.getState().openNote("missing", true);
  assert.equal(workspace.getState().activeTabId, previous); assert.equal(workspace.getState().tabs.length, 1);
  assert.equal(notes.getState().activeId, "A"); assert.equal(workspace.getState().pending, false);
});

test("a new empty tab closes and flushes the current note without turning into the gallery", async t => {
  const { workspace, notes, events } = await fixture(t);
  await workspace.getState().openNote("A"); await workspace.getState().newTab();
  assert.equal(model.activeWorkspaceTab(workspace.getState()).target.kind, "empty");
  assert.equal(notes.getState().activeId, null); assert.deepEqual(events.slice(-2), ["flush", "close"]);
});

test("navigation is serialized and a newer queued tab supersedes a stale queued read", async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { workspace, notes, events } = await fixture(t, id => id === "A" ? gate : undefined);
  const first = workspace.getState().openNote("A");
  await new Promise(resolve => setTimeout(resolve, 0));
  const skipped = workspace.getState().openNote("B"); const final = workspace.getState().openNote("C");
  release(); await Promise.all([first, skipped, final]);
  assert.equal(notes.getState().activeId, "C"); assert(!events.includes("read:B"));
  assert.equal(model.activeWorkspaceTab(workspace.getState()).target.noteId, "C");
  assert.equal(workspace.getState().pending, false);
});

test("existing gallery/tag/graph navigation is recorded in the active tab", async t => {
  const { workspace, notes } = await fixture(t);
  notes.setState({ view: "tags" });
  assert.deepEqual(model.activeWorkspaceTab(workspace.getState()).target, { kind: "view", view: "tags" });
  await workspace.getState().openView("graph");
  assert.equal(workspace.getState().tabs.length, 2);
  assert.equal(notes.getState().view, "graph");
});
test("right pane choice and width persist without rewriting document destinations", async t => {
  const { workspace, saved } = await fixture(t);
  await workspace.getState().openNote("A");
  const session = saved.get("synapse-workspace-session-v1");
  workspace.getState().setRightPane("graph");
  workspace.getState().setRightWidth(10000);
  const preferences = JSON.parse(saved.get("synapse-workspace-ui-v1"));
  assert.equal(preferences.rightPane,"graph");
  assert(preferences.rightWidth>=240 && preferences.rightWidth<=600);
  assert.equal(saved.get("synapse-workspace-session-v1"),session);
  workspace.getState().toggleRight();workspace.getState().toggleRight();
  assert.equal(workspace.getState().rightPane,"graph");
});
