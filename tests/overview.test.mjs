import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const temporary=await mkdtemp(join(tmpdir(),'overview-tests-'));
const file=join(temporary,'model.mjs');
await build({stdin:{contents:"export * from './src/lib/overviewModel.ts'; export * from './src/lib/overviewWords.ts'; export * from './src/lib/overviewFormat.ts'; export {setLanguage} from './src/lib/i18n.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:file});
const {buildOverviewModel,overviewSelection,overviewActivity,recentOverviewNotes,OverviewWordResource,overviewCount,overviewExcerpt,setLanguage}=await import(pathToFileURL(file));
after(()=>rm(temporary,{recursive:true,force:true}));
const time=(day)=>new Date(2026,9,day,12).getTime();
const note=(id,extra={})=>({id,title:id,folder:'Учёба/SQL',updatedAt:time(8),createdAt:time(1),tags:[],favorite:false,links:[],preview:'',icon:null,cover:null,mood:null,...extra});

test('overview metadata keeps unique notes, canonical tag counts and nested collection totals without source mutations',()=>{
 const source=[note('a',{tags:['#SQL','sql','db/plan'],favorite:true}),note('b',{folder:'Работа/WMS',tags:['DB/Plan']}),note('c',{folder:''}),note('a')];
 const before=JSON.stringify(source),model=buildOverviewModel(source);
 assert.equal(model.notes.length,3);assert.equal(model.favoriteCount,1);assert.equal(model.untaggedCount,1);assert.equal(model.tagCount,2);assert.equal(model.topics[0].tag,'db/plan');assert.equal(model.topics[0].count,2);assert.equal(model.collectionCount,3);assert.equal(model.byId.get('a'),source[0]);assert.equal(JSON.stringify(source),before);
});
test('a 50,000-note vault produces bounded recent, favorite, collection and topic results',()=>{
 const source=Array.from({length:50000},(_,i)=>note(`note-${i}`,{updatedAt:time(1)+i*1000,favorite:i%2===0,folder:`root-${i%50}/deep`,tags:[`tag-${i%100}`]}));
 const model=buildOverviewModel(source),expected=[...source].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,12);
 assert.deepEqual(model.recent.map(x=>x.id),expected.map(x=>x.id));assert.equal(model.favorites.length,5);assert.equal(model.collections.length,6);assert.equal(model.topics.length,7);assert.equal(model.favoriteCount,25000);assert.equal(model.notes.length,50000);
 assert.equal(recentOverviewNotes(source,6,x=>x.favorite).length,6);
});
test('day filters use last modification date, combine with favorites/tags, and never drop the sole matching note',()=>{
 const source=[note('a',{favorite:true,updatedAt:time(8),createdAt:time(1)}),note('b',{updatedAt:time(9),tags:['sql']})],model=buildOverviewModel(source);
 assert.deepEqual(overviewSelection(model,'favorites','2026-10-08').notes.map(x=>x.id),['a']);assert.equal(overviewSelection(model,'recent','2026-10-01').count,0);assert.deepEqual(overviewSelection(model,'untagged',null).notes.map(x=>x.id),['a']);assert.equal(overviewSelection(model,'recent','2026-10-08').count,1);
});
test('cached metadata reflects changed tags, folder and modification date, including same-object inputs',()=>{
 const source=note('mutable',{tags:['#SQL'],updatedAt:time(8)});
 const first=buildOverviewModel([source]);assert.equal(first.topics[0].tag,'sql');
 source.tags[0]='#WMS';source.folder='Работа/WMS';source.updatedAt=time(9);
 const next=buildOverviewModel([source]);assert.equal(next.topics[0].tag,'wms');assert.equal(next.collections[0].path,'Работа');assert.equal(next.days.get('2026-10-09'),1);assert.equal(next.days.has('2026-10-08'),false);
 assert.equal(first.topics[0].tag,'sql');assert.equal(first.days.get('2026-10-08'),1);
});
test('activity stays bounded across month, leap-day and DST boundaries',()=>{
 const activity=overviewActivity(buildOverviewModel([]),'2024-03-01');assert.equal(activity.length,30);assert.equal(activity.at(-2).key,'2024-02-29');assert.equal(activity.at(-1).key,'2024-03-01');assert.equal(new Set(activity.map(x=>x.key)).size,30);
 const dst=overviewActivity(buildOverviewModel([]),'2026-03-09');assert.equal(dst.length,30);assert.equal(new Set(dst.map(x=>x.key)).size,30);
});
test('word cache detects changes below the maximum timestamp and changes of ids or creation dates',async()=>{
 const cache=new OverviewWordResource();let reads=0;const reader=async notes=>{reads++;return notes.map(x=>({createdAt:x.createdAt,words:x.updatedAt}));};
 let notes=[note('a',{updatedAt:100}),note('b',{updatedAt:20})];const first=await cache.load(notes,reader);
 notes=[notes[0],{...notes[1],updatedAt:30}];const second=await cache.load(notes,reader);assert.equal(reads,2);assert.equal(second[1].words,30);assert.notEqual(first,second);
 await cache.load([notes[0],{...notes[1],id:'renamed'}],reader);assert.equal(reads,3);
 await cache.load([notes[0],{...notes[1],id:'renamed',createdAt:9}],reader);assert.equal(reads,4);
});
test('cosmetic changes, metadata order and warm navigation reuse the same pending or fulfilled word request',async()=>{
 const cache=new OverviewWordResource();let reads=0;const reader=async notes=>{reads++;return notes.map(x=>({createdAt:x.createdAt,words:1}));};
 const notes=[note('a'),note('b')];const a=cache.load(notes,reader),b=cache.load([...notes].reverse().map(x=>({...x,favorite:true,title:'renamed title'})),reader);
 assert.equal(a,b);await a;assert.equal(cache.load(notes,reader),a);assert.equal(reads,1);
});
test('overlapping word snapshots run serially and an older completion never replaces the latest request',async()=>{
 const cache=new OverviewWordResource();const calls=[];let release;const gate=new Promise(resolve=>release=resolve);
 const reader=async notes=>{calls.push(notes[0].updatedAt);if(calls.length===1)await gate;return [{createdAt:notes[0].createdAt,words:notes[0].updatedAt}];};
 const first=cache.load([note('a',{updatedAt:1})],reader);await new Promise(resolve=>setImmediate(resolve));
 const next=[note('a',{updatedAt:2})],second=cache.load(next,reader);assert.deepEqual(calls,[1]);release();await first;assert.equal((await second)[0].words,2);assert.equal(cache.load(next,reader),second);assert.deepEqual(calls,[1,2]);
});
test('failed word loads are retryable and a different reader cannot reuse another source’s cached values',async()=>{
 const cache=new OverviewWordResource(),notes=[note('a')];let fail=true,calls=0;const reader=async()=>{calls++;if(fail)throw new Error('unavailable');return [{createdAt:1,words:7}];};
 await assert.rejects(cache.load(notes,reader));fail=false;assert.equal((await cache.load(notes,reader))[0].words,7);assert.equal(calls,2);assert.equal((await cache.load(notes,async()=>[{createdAt:1,words:9}]))[0].words,9);
});

test('overview copy uses correct number forms and strips leading tags without stripping a Markdown heading',()=>{
 setLanguage('ru');assert.equal(overviewCount(1,'note'),'1 заметка');assert.equal(overviewCount(24,'note'),'24 заметки');assert.equal(overviewCount(111,'tag'),'111 тегов');
 setLanguage('en');assert.equal(overviewCount(21,'note'),'21 notes');assert.equal(overviewCount(1,'word'),'1 word');setLanguage('ru');
 assert.equal(overviewExcerpt('#SQL #dba Main paragraph'),'Main paragraph');assert.equal(overviewExcerpt('# Heading'), '# Heading');
});
