import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
const compiled=await build({entryPoints:['src/lib/imagePreviews.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'native-preview-fixture',setup(builder){builder.onResolve({filter:/^@tauri-apps\/api\/core$/},()=>({path:'core',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const invoke=(...args)=>globalThis.__previewRpc(...args);export const convertFileSrc=path=>"asset://"+path;'}));}}]});
async function fixture(){
 const document=new EventTarget();document.hidden=false;globalThis.document=document;
 const calls=[];const pending=[];
 globalThis.__previewRpc=(name,args)=>{assert.equal(name,'image_preview');calls.push(args);return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
 const module=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text+'\n//'+randomUUID()).toString('base64'));
 const image=id=>({id,name:id,folder:'',url:id,sizeBytes:1000,modifiedAt:1,managed:false,usedBy:[]});
 const complete=i=>pending[i].resolve({path:'/cache/'+i+'.webp',width:1200,height:800,previewWidth:480,previewHeight:320,bytes:900});
 return {document,calls,pending,module,image,complete};
}
test('preview requests coalesce, run at most two decodes and cancel queued offscreen work',async()=>{
 const f=await fixture();const a=new AbortController(), duplicate=new AbortController(),b=new AbortController(),c=new AbortController();
 const first=f.module.loadImagePreview(f.image('a.png'),a.signal);
 const shared=f.module.loadImagePreview(f.image('a.png'),duplicate.signal);
 assert.equal(first,shared);
 const second=f.module.loadImagePreview(f.image('b.png'),b.signal);
 const cancelled=f.module.loadImagePreview(f.image('c.png'),c.signal);
 const rejection=assert.rejects(cancelled,error=>error.name==='AbortError');
 assert.equal(f.calls.length,2);c.abort();await rejection;
 f.complete(0);f.complete(1);await Promise.all([first,shared,second]);
 await Promise.resolve();
 await f.module.loadImagePreview(f.image('a.png'),new AbortController().signal);
 assert.equal(f.calls.length,2,'cached previews must not invoke native decoding again');
});
test('hidden documents pause new work and failures only retry on an explicit regeneration',async()=>{
 const f=await fixture();f.document.hidden=true;
 const first=f.module.loadImagePreview(f.image('a.png'),new AbortController().signal);const rejected=assert.rejects(first);
 assert.equal(f.calls.length,0);
 f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(f.calls.length,1);f.pending[0].reject(Error('broken derived preview'));await rejected;await Promise.resolve();
 await assert.rejects(f.module.loadImagePreview(f.image('a.png'),new AbortController().signal));
 assert.equal(f.calls.length,1);
 let notifications=0;const unsubscribe=f.module.subscribeImagePreview(f.image('a.png'),()=>notifications++);
 const retry=f.module.loadImagePreview(f.image('a.png'),new AbortController().signal,true);
 assert.equal(f.calls[1].regenerate,true);f.complete(1);await retry;
 assert.equal(notifications,1);unsubscribe();
});
