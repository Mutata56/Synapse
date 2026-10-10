import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
const temporary = await mkdtemp(join(tmpdir(), "graph-performance-"));
const entry = join(temporary, "pure.mjs");
await build({ stdin:{contents:`export * from './src/lib/graphReferenceIndex.ts'; export * from './src/lib/graphModelCache.ts'; export * from './src/lib/graphSpatialIndex.ts'; export * from './src/lib/graphData.ts'; export * from './src/lib/graphReferences.ts'; export * from './src/lib/forceLayout.ts';`,resolveDir:process.cwd()},bundle:true,platform:"node",format:"esm",outfile:entry });
const { GraphReferenceIndex, GraphModelCache, GraphSpatialIndex, sameGraphTopology, collectGraphReferences, DEFAULT_FORCE_SETTINGS } = await import(pathToFileURL(entry));
const note = (id,extra={}) => ({id,title:id,folder:"",createdAt:1,updatedAt:1,links:[],tags:[],icon:null,cover:null,preview:"",favorite:false,mood:null,...extra});
const options={showOrphans:true,showUnresolved:true,showTags:false,showAttachments:false};

test("Reference cache parses only changed bodies and survives warm navigation and metadata changes",async()=>{
  const index=new GraphReferenceIndex(); let reads=0; const batches=[];
  let notes=[note('A'),note('B')], docs=[{id:'A',body:'[[B]]'},{id:'B',body:'plain'}];
  const read=async()=>{reads++;return docs;};
  const parse=async(batch)=>{batches.push(batch.map(x=>x.id));return Object.fromEntries(batch.map(x=>[x.id,collectGraphReferences(x.body)]));};
  const first=await index.update(notes,read,parse);
  notes=notes.map(x=>({...x,favorite:true}));
  assert.equal(await index.update(notes,read,parse),first); assert.equal(reads,1); assert.deepEqual(batches,[['A','B']]);
  docs=[{id:'A',body:'[[B]] more text'},{id:'B',body:'plain'}]; notes=[{...notes[0],updatedAt:2},notes[1]];
  assert.equal(await index.update(notes,read,parse),first); assert.deepEqual(batches.at(-1),['A']);
  docs=[{id:'A',body:'[[Missing]]'},{id:'B',body:'plain'}]; notes=[{...notes[0],updatedAt:3},notes[1]];
  const changed=await index.update(notes,read,parse); assert.notEqual(changed,first); assert.equal(changed.A[0].target,'Missing');
  const removed=await index.update([notes[0]],read,parse); assert(!('B' in removed));
});

test("Supplied bodies invalidate the cache even when filesystem timestamps are unchanged",async()=>{
  const index=new GraphReferenceIndex(), notes=[note('A')]; let parsed=0;
  const read=()=>{throw new Error('must not read disk');}; const parse=async rows=>{parsed+=rows.length;return Object.fromEntries(rows.map(row=>[row.id,collectGraphReferences(row.body)]));};
  await index.update(notes,read,parse,[{id:'A',body:'[[B]]'}]);
  const next=await index.update(notes,read,parse,[{id:'A',body:'[[C]]'}]); assert.equal(parsed,2); assert.equal(next.A[0].target,'C');
});

test("Overlapping index updates are serialized without publishing stale final links",async()=>{
  const index=new GraphReferenceIndex(); let release;const gate=new Promise(resolve=>{release=resolve;});
  const parse=async rows=>{await gate;return Object.fromEntries(rows.map(row=>[row.id,collectGraphReferences(row.body)]));};
  const a=index.update([note('A')],async()=>[],parse,[{id:'A',body:'[[B]]'}]);
  const b=index.update([note('A',{updatedAt:2})],async()=>[],parse,[{id:'A',body:'[[C]]'}]);
  release();await a;await b;assert.equal(index.references.A[0].target,'C');
});

test("Metadata cache keeps topology while fresh metadata and changed targets remain correct",()=>{
  const cache=new GraphModelCache();let notes=[note('A'),note('B')];const refs={A:[{target:'B',embedded:false}],B:[]};
  const tree=()=>notes.map(note=>({kind:'note',note}));
  const initial=cache.update(tree(),'obsidian',refs,options,[]);
  notes=[{...notes[0],favorite:true,preview:'updated preview'},notes[1]];
  const meta=cache.update(tree(),'obsidian',refs,options,[]);assert(sameGraphTopology(initial,meta));assert.equal(meta.edges,initial.edges);assert.equal(meta.nodes[0].note.preview,'updated preview');
  const changed=cache.update(tree(),'obsidian',{...refs,A:[{target:'Missing',embedded:false}]},options,[]);assert(!sameGraphTopology(initial,changed));assert(changed.nodes.some(x=>x.kind==='unresolved'));
});

test("Spatial index moves points across positive and negative cells without stale hits",()=>{
  const index=new GraphSpatialIndex(3),positions=new Float32Array([0,0,-130,-70,200,100]);index.update(positions);
  const find=(x,y)=>{const found=[];index.candidates(x,y,1,i=>found.push(i));return found;};
  assert(find(0,0).includes(0));assert(find(-130,-70).includes(1));
  index.move(0,500,500);assert(!find(0,0).includes(0));assert(find(500,500).includes(0));
  const count=index.bucketCount; index.move(0,500,500);assert.equal(index.bucketCount,count);
});

test("Restored Worker layouts stay parked; pinning and identical active masks never reheat them",async()=>{
  await build({entryPoints:['src/workers/graphLayout.worker.ts'],bundle:true,platform:'node',format:'esm',outfile:join(temporary,'worker.mjs')});
  await writeFile(join(temporary,'wrapper.mjs'),`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:(value,transfer)=>parentPort.postMessage(value,transfer),onmessage:null};await import('./worker.mjs');parentPort.on('message',data=>self.onmessage({data}));`);
  const worker=new Worker(pathToFileURL(join(temporary,'wrapper.mjs'))),frames=[];
  worker.on('message',frame=>{if(frame.type==='error')throw new Error(frame.message);frames.push({...frame,positions:Array.from(frame.positions)});});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate)=>{for(let i=0;i<150&&!predicate();i++)await sleep(10);assert(predicate());};
  const nodes=[0,1].map(i=>({x:i*100,y:0,px:i*100,py:0,mass:1,charge:1,radius:4,active:true,fixed:false}));
  try{
    worker.postMessage({type:'init',nodes,edges:[],settings:DEFAULT_FORCE_SETTINGS,groups:[],clusterIds:new Int32Array([-1,-1]),revision:7,settled:true});
    await wait(()=>frames.length>0);const count=frames.length;await sleep(100);assert.equal(frames.length,count);
    worker.postMessage({type:'active',values:new Uint8Array([1,1])});worker.postMessage({type:'pin',index:0,fixed:false});
    await sleep(80);assert.equal(frames.length,count);
    worker.postMessage({type:'pin',index:0,fixed:true});await wait(()=>frames.length>count);assert(frames.at(-1).settled);
    const pinned=frames.length;await sleep(80);assert.equal(frames.length,pinned);
    worker.postMessage({type:'pin',index:0,fixed:true,x:50,y:10});await wait(()=>frames.some(frame=>!frame.settled));
    worker.postMessage({type:'replace',nodes:nodes.map(node=>({...node,fixed:true})),edges:[{a:0,b:1,rest:90}],settings:DEFAULT_FORCE_SETTINGS,groups:[],clusterIds:new Int32Array([-1,-1]),revision:8,preservePositions:false});
    await wait(()=>frames.some(frame=>frame.revision===8&&frame.settled));assert.deepEqual(frames.at(-1).positions,[0,0,100,0]);
  }finally{await worker.terminate();}
});
test.after(async()=>{await rm(temporary,{recursive:true,force:true});});
