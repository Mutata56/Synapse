import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'synapse-scale-test-'));
const output=join(directory,'scale.mjs');
await build({bundle:true,platform:'node',format:'esm',outfile:output,entryPoints:['src/lib/editorZoom.ts']});
const {readEditorZoom,persistEditorZoom,EDITOR_ZOOM_KEY,EDITOR_SCALE_PROFILE_KEY}=await import(pathToFileURL(output));
after(()=>rm(directory,{recursive:true,force:true}));
const storage=entries=>{
 const values=new Map(entries);
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
};
test('the matched size starts at 26px despite an old zoom, then retains a new explicit zoom',()=>{
 const local=storage([[EDITOR_ZOOM_KEY,'1.5']]);
 assert.equal(26*readEditorZoom(local),26);
 persistEditorZoom(local,readEditorZoom(local));
 assert.equal(local.getItem(EDITOR_ZOOM_KEY),'1');
 persistEditorZoom(local,1.3);
 assert.equal(readEditorZoom(local),1.3);
 assert.ok(Math.abs(26*readEditorZoom(local)-33.8)<1e-9);
 assert.ok(local.getItem(EDITOR_SCALE_PROFILE_KEY));
});
test('current profile preserves supported zoom extremes and recovers malformed zoom',()=>{
 const local=storage([]);
 persistEditorZoom(local,.7);assert.equal(readEditorZoom(local),.7);
 persistEditorZoom(local,2);assert.equal(readEditorZoom(local),2);
 for(const value of ['NaN','0','9','']){
  local.setItem(EDITOR_ZOOM_KEY,value);assert.equal(readEditorZoom(local),1);
 }
});
