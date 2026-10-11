import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './helpers/workspace.mjs';
const directory = await mkdtemp(join(tmpdir(), 'synapse-settings-test-'));
const entry = join(directory, 'settings.mjs');
await build({bundle:true,platform:'node',format:'esm',outfile:entry,stdin:{contents:"export * from './src/lib/settings'; export * from './src/lib/modules';",resolveDir:process.cwd()}});
const model = await import(pathToFileURL(entry));
after(()=>rm(directory,{recursive:true,force:true}));

test('old settings adopt the minimal workspace while retaining calendar credentials and shortcuts', () => {
  const settings = model.coerceSettings({accentColor:'ABCDEF',calendarIcsUrl:'https://example.test/feed',caldavLogin:'reader',caldavPassword:'test-only',captureShortcut:'Alt+N'});
  assert.deepEqual(settings.modules, model.MINIMAL_MODULES);
  assert.equal(settings.graph.obsidian,true); assert.equal(settings.graph.volume,false); assert.equal(settings.graph.minimap,false);
  assert.equal(settings.calendarIcsUrl,'https://example.test/feed'); assert.equal(settings.caldavPassword,'test-only');
  assert.equal(settings.accentColor,'#abcdef'); assert.equal(settings.captureShortcut,'Alt+N');
});
test('malformed flags fall back individually; settings and note editing cannot be locked out', () => {
  const settings = model.coerceSettings({modules:{notes:false,files:false,search:false,graph:true,calendar:'yes'},graph:{volume:false,obsidian:false,minimap:'yes'}});
  assert.equal(settings.modules.notes,false); assert.equal(settings.modules.graph,true); assert.equal(settings.modules.calendar,false);
  assert.equal(model.isViewEnabled(settings,'settings'),true);
  assert.equal(model.isViewEnabled(settings,'files'),false);
  assert.deepEqual(model.availableGraphModes(settings.graph),['obsidian']);
  assert.equal(model.resolveGraphMode('volume',settings.graph),'obsidian');
});
test('graph preference cannot select a disabled renderer', () => {
  const settings = model.coerceSettings({graph:{volume:true,obsidian:false,minimap:true}});
  assert.deepEqual(model.availableGraphModes(settings.graph),['volume']);
  assert.equal(model.resolveGraphMode('obsidian',settings.graph),'volume');
});
test('rapid settings changes serialize writes and retain independent module flags on disk', async t => {
  const f = await fixture(t, {}, undefined, true);
  const store = f.storage.useNotesStore;
  let release; const gate = new Promise(resolve=>release=resolve);
  let started; const writing = new Promise(resolve=>started=resolve);
  let count = 0;
  f.interceptWrite(async name=>{if(name.startsWith('notes/.settings.json') && ++count===1){started();await gate;}});
  const first = store.getState().updateSettings({modules:{graph:true}});
  await writing;
  const second = store.getState().updateSettings({modules:{calendar:true},graph:{volume:true},captureShortcut:'Alt+N'});
  release(); await Promise.all([first,second]);
  const saved = JSON.parse(await f.read('.settings.json'));
  assert.equal(saved.modules.graph,true); assert.equal(saved.modules.calendar,true); assert.equal(saved.modules.files,true);
  assert.equal(saved.graph.volume,true); assert.equal(saved.captureShortcut,'Alt+N');
});
test('a failed settings write leaves the prior configuration active and rejects saving', async t => {
  const f = await fixture(t, {}, undefined, true);
  const store = f.storage.useNotesStore;
  const before = store.getState().settings;
  f.interceptWrite(name=>{if(name.startsWith('notes/.settings.json'))throw Error('Fixture: disk unavailable');});
  await assert.rejects(store.getState().updateSettings({modules:{graph:true}}),/disk unavailable/);
  assert.equal(store.getState().settings,before);
  f.interceptWrite(()=>{});
  await store.getState().updateSettings({modules:{calendar:true}});
  assert.equal(store.getState().settings.modules.graph,false); assert.equal(store.getState().settings.modules.calendar,true);
});
test('disabled creation cannot write a note; disabled gallery does not prevent opening an existing document', async t => {
  const f = await fixture(t, {'kept.md':'# Existing note\n\nBody'}, undefined, true);
  const store = f.storage.useNotesStore;
  await store.getState().refreshTree();
  await store.getState().updateSettings({modules:{newNote:false,notes:false}});
  assert.equal(await store.getState().createNote('','Blocked'), '');
  store.getState().startCreateNote(''); assert.equal(store.getState().creatingNoteIn,null);
  await store.getState().selectNote('kept');
  store.getState().setView('notes'); assert.match(store.getState().activeNote.content,/Body/);
  assert.equal(store.getState().view,'notes');
});
test('application flush waits for a pending preference write even with no document flushers', async t => {
  const f = await fixture(t, {}, undefined, true);
  let started; const writing = new Promise(resolve=>started=resolve);
  let release; const gate = new Promise(resolve=>release=resolve);
  f.interceptWrite(async name=>{if(name.startsWith('notes/.settings.json')){started();await gate;}});
  const saving = f.storage.useNotesStore.getState().updateSettings({modules:{graph:true}});
  await writing;
  let finished=false;
  const exiting=f.storage.flushAllPending().then(()=>{finished=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);
  release(); await Promise.all([saving,exiting]);
  assert.equal(JSON.parse(await f.read('.settings.json')).modules.graph,true);
});
