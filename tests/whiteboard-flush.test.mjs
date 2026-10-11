import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './helpers/workspace.mjs';

// Hook lifecycle harness: actual board callbacks run, without a canvas/GPU.
const hooks = { cursor:0, slots:[], effects:[], begin(){this.cursor=0;}, commit(){for(const effect of this.effects.splice(0))effect();}, unmount(){for(const slot of this.slots)slot?.cleanup?.();} };
const same = (a,b) => a && b && a.length===b.length && a.every((value,index)=>Object.is(value,b[index]));
const hookApi = {
  useState(initial){const index=hooks.cursor++;hooks.slots[index]??={value:typeof initial==='function'?initial():initial};return [hooks.slots[index].value,value=>{hooks.slots[index].value=typeof value==='function'?value(hooks.slots[index].value):value;}];},
  useRef(initial){const index=hooks.cursor++;hooks.slots[index]??={current:initial};return hooks.slots[index];},
  useMemo(compute,deps){const index=hooks.cursor++;let slot=hooks.slots[index];if(!slot||!same(slot.deps,deps))slot=hooks.slots[index]={value:compute(),deps};return slot.value;},
  useCallback(callback,deps){return hookApi.useMemo(()=>callback,deps);},
  useEffect(callback,deps){const index=hooks.cursor++;const old=hooks.slots[index];if(!old||!same(old.deps,deps))hooks.effects.push(()=>{old?.cleanup?.();hooks.slots[index]={deps,cleanup:callback()};});},
};
const directory=await mkdtemp(join(tmpdir(),'synapse-board-flush-'));
const output=join(directory,'board.mjs');
after(()=>rm(directory,{recursive:true,force:true}));
await build({bundle:true,platform:'node',format:'esm',outfile:output,entryPoints:['src/editor2026/blocks/whiteboard/whiteboardBlock.tsx'],plugins:[{name:'board-lifecycle',setup(builder){
  builder.onResolve({filter:/^(react|react\/jsx-runtime|react-dom|lucide-react|@blocknote\/react)$/},args=>({path:args.path,namespace:'board-mock'}));
  builder.onResolve({filter:/\/store\/notes$/},()=>({path:'notes',namespace:'board-mock'}));
  builder.onResolve({filter:/ModuleBlockGate$/},()=>({path:'gate',namespace:'board-mock'}));
  builder.onResolve({filter:/WhiteboardCanvas$/},()=>({path:'canvas',namespace:'board-mock'}));
  builder.onLoad({filter:/.*/,namespace:'board-mock'},args=>{
    if(args.path==='react')return{contents:'const h=globalThis.boardFlushFixture.hooks;export const {useState,useRef,useMemo,useCallback,useEffect}=h;export const lazy=()=>()=>null;export const Suspense=({children})=>children;'};
    if(args.path==='react/jsx-runtime')return{contents:'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'};
    if(args.path==='react-dom')return{contents:'export const createPortal=node=>node;'};
    if(args.path==='lucide-react')return{contents:'export const PenLine=()=>null;export const X=()=>null;'};
    if(args.path==='@blocknote/react')return{contents:'export const createReactBlockSpec=(_config,implementation)=>()=>implementation;'};
    if(args.path==='notes')return{contents:'export const registerFlusher=(...args)=>globalThis.boardFlushFixture.storage.registerFlusher(...args);'};
    if(args.path==='gate')return{contents:'export const ModuleBlockGate=({children})=>children;'};
    return{contents:'export default ()=>null;'};
  });
}}]});
const walk=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const match=walk(child,predicate);if(match)return match;}return null;};
const finalBoard={shapes:[{id:'last-stroke',type:'rect',color:'#fff',sw:2,x:10,y:20,w:60,h:40,fill:'none'}],edges:[],camera:{x:0,y:0,zoom:1}};

for(const action of ['navigation','module unmount'])test(`the last board edit survives immediate ${action} before its 600ms debounce`,async t=>{
  const f=await fixture(t,{},undefined,true);
  const store=f.storage.useNotesStore;
  const noteId=await store.getState().createNote('','Board');
  hooks.cursor=0;hooks.slots=[];hooks.effects=[];
  globalThis.boardFlushFixture={hooks:hookApi,storage:f.storage};
  t.after(()=>{delete globalThis.boardFlushFixture;});
  const {whiteboardBlock}=await import(`${pathToFileURL(output)}?action=${action}`);
  const block={id:'board',type:'whiteboard',props:{name:'Board',snapshot:''}};
  let dirty=false;
  const editor={document:[block],updateBlock(_block,patch){Object.assign(block.props,patch.props);dirty=true;}};
  // Deliberately register the document saver FIRST: block commits must precede
  // it by phase, not by incidental React effect ordering.
  const unregister=f.storage.registerFlusher(async()=>{if(dirty){await store.getState().saveNote({content:'[Доска]',blocknote:JSON.stringify(editor.document)});dirty=false;}});
  t.after(unregister);
  const element=whiteboardBlock().render({block,editor}).props.children;
  const render=()=>{hooks.begin();const tree=element.type(element.props);hooks.commit();return tree;};
  let tree=render();
  const open=walk(tree,node=>node.props?.className==='e26-wb__open');
  assert(open,'board open action exists');open.props.onClick();tree=render();
  const modal=walk(tree,node=>typeof node.props?.onChange==='function' && node.props?.board);
  assert(modal,'board change callback is reachable');modal.props.onChange(finalBoard);
  assert.equal(block.props.snapshot,'','the edit is still pending, not pre-saved');
  if(action==='module unmount')hooks.unmount();
  await f.storage.flushAllPending();
  store.getState().setView('settings');
  if(action==='navigation')hooks.unmount();
  await store.getState().closeActiveNote();
  await store.getState().selectNote(noteId);
  const reopened=store.getState().activeNote;
  const saved=JSON.parse(JSON.parse(reopened.blocknote)[0].props.snapshot);
  assert.deepEqual(saved,finalBoard);
  assert.equal(dirty,false,'the enclosing note write finished before navigation');
});
