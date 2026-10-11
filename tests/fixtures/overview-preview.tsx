import { createRoot } from "react-dom/client";
import { Profiler, useState } from "react";
import { WritingDashboard } from "../../src/components/WritingDashboard";
import { useNotesStore } from "../../src/store/notes";
import { Sidebar } from "../../src/components/Sidebar";
import { CommandPalette } from "../../src/components/CommandPalette";
import { dailyNoteId } from "../../src/lib/daily";
import { countWords } from "../../src/lib/writingStats";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import type { NoteMeta, TreeNode } from "../../src/lib/storage";
import "../../src/index.css";
const query = new URLSearchParams(location.search);
let documents: Array<{note:NoteMeta;body:string}> = [], tree: TreeNode[] = [];
if (query.has("vault")) ({ documents, tree } = await (await fetch('/tests/fixtures/overview-vault.json')).json());
else {
  const count = query.has("empty") ? 0 : Math.min(50000, Number(query.get("notes")??1000));
  for(let index=0;index<count;index++) {
    const folder=['Учёба','Работа','Личное'][index%3];
    const note:NoteMeta={id:`${folder}/note-${index}`,title:index===0?'Как устроен планировщик запросов':`Заметка ${index}`,folder,createdAt:new Date(2026,9,1+(index%9),12).getTime(),updatedAt:new Date(2026,9,1+(index%9),15).getTime(),favorite:index%100===0,tags:['dba','sql',`тема-${index%11}`],links:[],preview:'Конспект о том, как данные проходят через систему и какие решения помогают работать быстрее.',icon:null,cover:null,mood:null};
    documents.push({note,body:note.preview});
    let group=tree.find(item=>item.kind==='folder'&&item.path===folder);
    if(!group){group={kind:'folder',path:folder,name:folder,children:[]};tree.push(group);}
    if(group.kind==='folder')group.children.push({kind:'note',note});
  }
}
let wordRequests=0, wordRows=0, failed=query.has('error'), commits=0, renderMs=0;
const bodies = new Map(documents.map(doc=>[doc.note.id,doc.body]));
const output = document.createElement('output'); output.id='overview-metrics'; output.hidden=true; document.body.appendChild(output);
const record=()=>{output.textContent=JSON.stringify({wordRequests,wordRows,commits,renderMs,notes:documents.length});};
const reader=async(notes:NoteMeta[])=>{wordRequests++;wordRows+=notes.length;record();if(failed)throw new Error('Synthetic reader failure');return notes.map(note=>({createdAt:note.createdAt,words:countWords(bodies.get(note.id)??'')}));};
Object.assign(window,{overviewFixtureReader:reader,overviewFixtureDocuments:documents.map(doc=>({...doc,bodyLower:doc.body.toLowerCase(),titleLower:doc.note.title.toLowerCase()}))});
const action=(name:string,id='')=>{output.dataset.action=name;output.dataset.note=id;};
useNotesStore.setState({tree,view:'overview',folderColors:{Учёба:'#8386e5',Работа:'#74b29c',Личное:'#d39b79'},settings:{...DEFAULT_SETTINGS},assetsLoaded:true,selectNote:async id=>{action('open',id);useNotesStore.setState({activeId:id,view:'notes'});},closeActiveNote:async()=>{action('close');useNotesStore.setState({activeId:null});},createNote:async()=>{action('create','__created__');useNotesStore.setState({activeId:'__created__',view:'notes'});return '__created__';},openDailyNote:async(date)=>{const id=dailyNoteId(date);action('daily',id);useNotesStore.setState({activeId:id,view:'notes'});}});
function App(){const view=useNotesStore(state=>state.view);const [showControls]=useState(query.has('controls'));return <main className="overview-fixture-app" style={{display:'flex',height:'100vh',width:'100vw'}}><div className="overview-fixture-sidebar"><Sidebar /></div><Profiler id="overview" onRender={(_id,_phase,duration)=>{commits++;renderMs+=duration;record();}}>{view==='overview' ? <WritingDashboard loadWords={reader}/> : <section style={{padding:40}}><h1>Тестовый переход: {view}</h1><button onClick={()=>useNotesStore.getState().setView('overview')}>Вернуться к Обзору</button></section>}</Profiler><CommandPalette />{showControls && <div style={{position:'fixed',bottom:4,left:4,zIndex:200,fontSize:11}}><button onClick={()=>{let changed=false;const update=(items:TreeNode[]):TreeNode[]=>items.map(item=>item.kind==='folder'?{...item,children:update(item.children)}:changed?item:(changed=true,{...item,note:{...item.note,favorite:!item.note.favorite}}));useNotesStore.setState({tree:update(useNotesStore.getState().tree)});}}>Метаданные</button><button onClick={()=>{failed=false;action('reader-ready');}}>Чтение доступно</button><button onClick={()=>{failed=true;action('reader-failed');}}>Чтение недоступно</button><button onClick={()=>{let changed=false;const update=(items:TreeNode[]):TreeNode[]=>items.map(item=>item.kind==='folder'?{...item,children:update(item.children)}:changed?item:(changed=true,{...item,note:{...item.note,updatedAt:item.note.updatedAt+1}}));useNotesStore.setState({tree:update(useNotesStore.getState().tree)});}}>Обновить текст</button></div>}</main>;}
document.documentElement.dataset.theme=query.get('theme')??'dark';
createRoot(document.getElementById('root')!).render(<App/>);record();
const style=document.createElement('style');style.textContent='.overview-fixture-sidebar{display:flex;flex-shrink:0;width:244px;}@media(max-width:700px){.overview-fixture-sidebar{display:none}}';document.head.appendChild(style);
