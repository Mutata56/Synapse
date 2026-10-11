import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './helpers/workspace.mjs';
const dir=await mkdtemp(join(tmpdir(),'synapse-appearance-'));
const entry=join(dir,'model.mjs');
await build({bundle:true,platform:'node',format:'esm',outfile:entry,stdin:{contents:"export * from './src/lib/settings';export * from './src/lib/folderTheme';",resolveDir:process.cwd()}});
const model=await import(pathToFileURL(entry));
after(()=>rm(dir,{recursive:true,force:true}));
test('legacy and invalid theme preferences preserve the workspace and opt into AnuPpuccin only explicitly',()=>{
  const raw={accentColor:'#123456',captureShortcut:'Alt+N',calendarIcsUrl:'https://example.test/private',caldavPassword:'fixture-secret'};
  const old=model.coerceSettings(raw), themed=model.coerceSettings({...raw,colorTheme:'anuppuccin'});
  assert.equal(old.colorTheme,'synapse'); assert.equal(themed.colorTheme,'anuppuccin');
  for(const key of Object.keys(raw)) assert.equal(themed[key],old[key]);
  assert.equal(model.coerceSettings({...raw,colorTheme:'unknown'}).colorTheme,'synapse');
});
test('bright theme accents choose dark readable ink and dark accents keep light ink',()=>{
  assert.equal(model.accentForeground(model.ANUPPUCCIN_ACCENT),'#1a1b23');
  assert.equal(model.accentForeground('#101020'),'#ffffff');
});
test('rainbow folders retain sibling order, restart within parents, cache immutable revisions and ignore notes',()=>{
  const tree=[{kind:'folder',path:'A',name:'A',children:[{kind:'folder',path:'A/child',name:'child',children:[]}]},{kind:'note',note:{id:'standalone'}},{kind:'folder',path:'B',name:'B',children:[]}];
  const colors=model.themeFolderColors(tree);
  assert.equal(colors.get('A'),'var(--folder-tone-0)');assert.equal(colors.get('B'),'var(--folder-tone-1)');assert.equal(colors.get('A/child'),'var(--folder-tone-0)');
  assert.equal(model.themeFolderColors(tree),colors);assert.equal(colors.has('standalone'),false);
  assert.notEqual(model.themeFolderColors([...tree]),colors);
});
test('theme preference saves with unrelated configuration intact and a failed write retains the prior theme',async t=>{
  const f=await fixture(t,{},undefined,true), store=f.storage.useNotesStore;
  await store.getState().updateSettings({calendarIcsUrl:'https://example.test/private',caldavPassword:'fixture-secret',captureShortcut:'Alt+N'});
  await store.getState().updateSettings({colorTheme:'anuppuccin',accentColor:model.ANUPPUCCIN_ACCENT});
  const saved=JSON.parse(await f.read('.settings.json'));
  assert.equal(saved.colorTheme,'anuppuccin');assert.equal(saved.caldavPassword,'fixture-secret');assert.equal(saved.captureShortcut,'Alt+N');
  f.interceptWrite(name=>{if(name.startsWith('notes/.settings.json'))throw Error('Fixture: rejected write');});
  await assert.rejects(store.getState().updateSettings({colorTheme:'synapse'}),/rejected write/);
  assert.equal(store.getState().settings.colorTheme,'anuppuccin');
});
