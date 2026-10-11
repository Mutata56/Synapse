// Creates a disposable local copy. No source bytes or original cache are written.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
const original='/Users/kirill/Library/Application Support/com.kirill.synapse/notes';
const root='/private/tmp/synapse-images-review';
const notes=path.join(root,'notes');
await fs.mkdir(root,{recursive:true});
if (!await fs.stat(notes).catch(()=>null)) await fs.cp(original,notes,{recursive:true,preserveTimestamps:true});
const reads=[]; const writes=[]; const pending=new Set();
const bounded=relative=>{const result=path.resolve(root,relative); if(!result.startsWith(root+path.sep))throw Error('Fixture path escaped');return result;};
const track=promise=>{pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
globalThis.__imagesReviewFs={root,
 copyFile:(a,b)=>track(fs.copyFile(bounded(a),bounded(b))),
 exists:async name=>!!await fs.stat(bounded(name)).catch(()=>null),
 mkdir:(name,opts)=>track(fs.mkdir(bounded(name),{recursive:opts?.recursive})),
 readDir:async name=>(await fs.readdir(bounded(name),{withFileTypes:true})).map(entry=>({name:entry.name,isDirectory:entry.isDirectory(),isFile:entry.isFile(),isSymlink:entry.isSymbolicLink()})),
 readFile:async name=>{reads.push(name);return new Uint8Array(await fs.readFile(bounded(name)));},
 readTextFile:async name=>{reads.push(name);return new TextDecoder().decode(await fs.readFile(bounded(name)));},
 remove:(name,opts)=>{writes.push(name);return track(fs.rm(bounded(name),{recursive:!!opts?.recursive}));},
 rename:(a,b)=>{writes.push(b);return track(fs.rename(bounded(a),bounded(b)));},
 stat:name=>fs.stat(bounded(name)),
 writeFile:(name,bytes)=>{writes.push(name);return track(fs.writeFile(bounded(name),bytes));},
 writeTextFile:(name,text)=>{writes.push(name);return track(fs.writeFile(bounded(name),text));},
};
globalThis.window={setTimeout:(...args)=>{const timer=setTimeout(...args);timer.unref();return timer;},clearTimeout};
const plugin={name:'images-review-fs',setup(builder){
 builder.onResolve({filter:/^@tauri-apps\//},args=>({path:args.path,namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},args=>{
  if(args.path==='@tauri-apps/plugin-fs')return {contents:'const fs=globalThis.__imagesReviewFs; export const BaseDirectory={AppData:1}; export const {copyFile,exists,mkdir,readDir,readFile,readTextFile,remove,rename,stat,writeFile,writeTextFile}=fs;'};
  if(args.path==='@tauri-apps/api/path')return {contents:'export const appDataDir=async()=>globalThis.__imagesReviewFs.root; export const join=async(...parts)=>parts.join("/");'};
  if(args.path==='@tauri-apps/api/core')return {contents:'export const convertFileSrc=path=>"asset:///"+encodeURIComponent(path);'};
  throw Error('Unexpected fixture module '+args.path);
 });
}};
const compiled=await build({entryPoints:['src/lib/storage.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[plugin]});
await fs.writeFile(path.join(root,'storage.mjs'),compiled.outputFiles[0].text);
const storage=await import(path.join(root,'storage.mjs')+'?t='+Date.now());
async function originals(directory){
 const output=new Map();
 const walk=async current=>{for(const entry of await fs.readdir(current,{withFileTypes:true})){if(entry.name.startsWith('.')&&entry.name!=='.assets')continue;const file=path.join(current,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())output.set(path.relative(directory,file),createHash('sha256').update(await fs.readFile(file)).digest('hex'));}};
 await walk(directory);return output;
}
const before=await originals(notes);
const referenceCachePresentBefore=!!await fs.stat(path.join(notes,'.cache','image-references-v1.json')).catch(()=>null);
const firstStart=performance.now(); const library=await storage.listImageLibrary();const firstScanMs=performance.now()-firstStart;const firstNoteReads=reads.filter(name=>name.endsWith('.md')).length;
reads.length=0;
const repeatStart=performance.now();await storage.listImageLibrary();const repeatScanMs=performance.now()-repeatStart;const repeatNoteReads=reads.filter(name=>name.endsWith('.md')).length;
await new Promise(resolve=>setTimeout(resolve,100));while(pending.size)await Promise.allSettled([...pending]);
const after=await originals(notes); let changed=0;for(const [name,hash]of before)if(after.get(name)!==hash)changed++;
if(changed)throw Error('Source bytes changed');
for(const image of library.images)image.url='/__images-file?id='+encodeURIComponent(image.id)+'&v='+image.modifiedAt;
await fs.writeFile(path.join(root,'library.json'),JSON.stringify(library));
await fs.writeFile(path.join(root,'paths.json'),JSON.stringify(library.images.map(image=>image.id)));
const report={images:library.images.length,linked:library.images.filter(i=>i.usedBy.length).length,sourceBytes:library.images.reduce((sum,i)=>sum+i.sizeBytes,0),complete:library.complete,referenceCachePresentBefore,firstScanMs,repeatScanMs,firstNoteReads,repeatNoteReads,sourceFilesVerified:before.size,changedOriginalFiles:changed,writesOutsideDerivedCaches:writes.filter(file=>!file.includes('/.cache/')&&!file.startsWith('notes/.meta-cache.json')&&!file.startsWith('notes/.assets')&&file!=='notes/.trash').length};
await fs.writeFile(path.join(root,'scan-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,...report}));
