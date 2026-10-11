import { Profiler, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarView } from '../../src/components/CalendarView';
import { WorkspaceChrome } from '../../src/components/WorkspaceChrome';
import { useNotesStore } from '../../src/store/notes';
import { useCalendarStore } from '../../src/store/calendar';
import { useTasksStore } from '../../src/store/tasks';
import { useWorkspaceStore } from '../../src/store/workspace';
import { DEFAULT_SETTINGS } from '../../src/lib/settings';
import { dailyNoteId } from '../../src/lib/daily';
import { setLanguage } from '../../src/lib/i18n';
import { parseIcs } from '../../src/lib/ics';
import type { NoteMeta, TreeNode } from '../../src/lib/storage';
import type { Task } from '../../src/lib/tasks';
import '@blocknote/core/fonts/inter.css';
import '../../src/index.css';

const query = new URLSearchParams(location.search), empty = query.has('empty');
const count = empty ? 0 : Math.min(50000, Number(query.get('notes') ?? 530));
const now = new Date(), year = now.getFullYear(), month = now.getMonth();
const iso = (day: number) => `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
setLanguage(query.get('lang') === 'en' ? 'en' : 'ru');
document.documentElement.dataset.theme=query.get('theme')??'dark';
// A synthetic light palette tests token inheritance; the application currently ships its dark palette.
if(query.get('theme')==='light')for(const [name,value] of Object.entries({'--bg':'#fafafa','--surface-1':'#f3f3f6','--surface-2':'#e8e9ee','--surface-2-solid':'#e8e9ee','--text':'#282830','--text-strong':'#171719','--text-secondary':'#43434a','--text-muted':'#62626d','--border':'rgba(0,0,0,.10)','--border-strong':'rgba(0,0,0,.22)','--color-bg':'#fafafa','--color-bg-elevated':'#f3f3f6','--color-bg-overlay':'#e8e9ee','--color-text':'#282830','--color-border':'rgba(0,0,0,.10)','--color-border-strong':'rgba(0,0,0,.22)'}))document.documentElement.style.setProperty(name,value);
let renderMs=0, commits=0, reads=0, writes=0;
const output = document.createElement('output'); output.id='calendar-metrics'; output.hidden=true; document.body.appendChild(output);
const record = () => output.textContent=JSON.stringify({renderMs,commits,reads,writes,notes:count});
window.addEventListener("calendar-fixture-read",()=>{reads++;record();});
const report = (action:string,id='') => {output.dataset.action=action;output.dataset.note=id;};
const tree: TreeNode[] = [{kind:'folder',path:'Учёба',name:'Учёба',children:[]},{kind:'folder',path:'Работа',name:'Работа',children:[]},{kind:'folder',path:'Дневник',name:'Дневник',children:[]}];
const titles=['План изучения PostgreSQL','Как работает MVCC','Диагностика обмена WMS','Идеи для Synapse','Работа с RabbitMQ','Заметки к встрече'];
for(let i=0;i<count;i++){const folder=i%4===0?'Работа':'Учёба';const note:NoteMeta={id:`${folder}/note-${i}`,title:titles[i%titles.length]+(i>=6?` ${i}`:''),folder,createdAt:new Date(year,month,1+i%27,12).getTime(),updatedAt:new Date(year,month,1+i%27,13).getTime(),favorite:false,tags:i%2?['sql']:['работа'],links:[],preview:'Основные идеи, решения и следующие шаги.',cover:null,icon:null};(tree[folder==='Работа'?1:0] as Extract<TreeNode,{kind:'folder'}>).children.push({kind:'note',note});}
if(!empty)for(let d=5;d<now.getDate()+1;d++){const date=new Date(year,month,d),id=dailyNoteId(date);(tree[2] as Extract<TreeNode,{kind:'folder'}>).children.push({kind:'note',note:{id,title:`${d} ${date.toLocaleDateString('ru-RU',{month:'long'})}`,folder:'Дневник',createdAt:date.getTime(),updatedAt:date.getTime(),preview:'Что получилось сегодня и к чему хочется вернуться.',cover:null,icon:null,favorite:false,tags:[],links:[],mood:3+d%3}});}
useNotesStore.setState({tree,view:'calendar',settings:{...DEFAULT_SETTINGS,calendarIcsUrl:empty?'':'https://example.test/synthetic.ics'},assetsLoaded:true,folderColors:{},selectNote:async id=>{report('open',id);useNotesStore.setState({activeId:id,view:'notes'});},openDailyNote:async date=>{report('daily',dailyNoteId(date));useNotesStore.setState({view:'notes',activeId:dailyNoteId(date)});}});
const taskCount=empty?0:Math.min(5000,Number(query.get('tasks')??12));
const taskTitles=['Разобрать схему обмена','Подготовить конспект','Проверить запросы','Прогулка без телефона','Встреча с командой','Доработать календарь'];
const tasks:Task[]=Array.from({length:taskCount},(_,i)=>({id:`task-${i}`,title:taskTitles[i%6]+(i>12?` ${i}`:''),day:iso(i<6?now.getDate():(i%27)+1),time:i%3?`${String(9+i%8).padStart(2,'0')}:00`:null,done:i===2,repeat:i===3?{freq:'daily',every:1}:null,doneDates:[],color:i===4?'#86b6f6':null,tags:i===1?['учёба']:[],createdAt:i,updatedAt:i}));
const mutate=(next:Task[])=>{writes++;useTasksStore.setState({tasks:next});record();};
useTasksStore.setState({tasks,loaded:!query.has('loading')&&!query.has('taskError'),loading:query.has('loading'),error:query.has('taskError')?'Synthetic unavailable task file':null,load:async()=>{},add:async(day,title,time=null,repeat=null)=>{mutate([...useTasksStore.getState().tasks,{id:crypto.randomUUID(),title,day,time,repeat,done:false,createdAt:Date.now(),updatedAt:Date.now()}]);report('add');},update:async(id,patch)=>{mutate(useTasksStore.getState().tasks.map(task=>task.id===id?{...task,...patch}:task));report('update',id);},toggle:async(id,date)=>{mutate(useTasksStore.getState().tasks.map(task=>task.id!==id?task:task.repeat?{...task,doneDates:task.doneDates?.includes(date!)?task.doneDates.filter(day=>day!==date):[...(task.doneDates??[]),date!]}:{...task,done:!task.done}));},remove:async(id)=>mutate(useTasksStore.getState().tasks.filter(task=>task.id!==id)),restore:async(task)=>mutate([...useTasksStore.getState().tasks,task])});
const feed=`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:crowded-hour\nSUMMARY:Короткая сверка планов\nDTSTART:${iso(now.getDate()).replaceAll('-','')}T111500\nDTEND:${iso(now.getDate()).replaceAll('-','')}T114500\nEND:VEVENT\nBEGIN:VEVENT\nUID:meeting\nSUMMARY:Обсуждение нового релиза\nDTSTART:${iso(now.getDate()+1).replaceAll('-','')}T110000\nDTEND:${iso(now.getDate()+1).replaceAll('-','')}T120000\nEND:VEVENT\nBEGIN:VEVENT\nUID:workshop\nSUMMARY:Практикум по SQL\nDTSTART:${iso(now.getDate()+4).replaceAll('-','')}T160000\nDTEND:${iso(now.getDate()+4).replaceAll('-','')}T170000\nEND:VEVENT\nEND:VCALENDAR`;
useCalendarStore.setState({events:empty?[]:parseIcs(feed),status:query.has('syncError')?'error':'ok',error:query.has('syncError')?'Synthetic feed error':null,lastSync:null,syncIfStale:()=>{},syncNow:async()=>{report('sync');}});
useWorkspaceStore.setState({tabs:[{id:'calendar-test',target:{kind:'view',view:'calendar'}}],activeTabId:'calendar-test',sidebarVisible:query.has('shell'),sidebarWidth:244,pending:false});
function Preview(){const view=useNotesStore(state=>state.view);const [tick,setTick]=useState(0);const calendar=<Profiler id="calendar" onRender={(_id,_phase,duration)=>{renderMs+=duration;commits++;record();}}>{view==='calendar'?<CalendarView/>:<section style={{padding:32}}><h1>Тестовый переход: {view}</h1><button onClick={()=>useNotesStore.setState({view:'calendar'})}>Вернуться к календарю</button></section>}</Profiler>;return <main style={{height:'100vh',width:'100vw',display:'flex',flexDirection:'column'}}>{query.has('shell')?<WorkspaceChrome>{calendar}</WorkspaceChrome>:calendar}{query.has('controls')?<div style={{position:'fixed',bottom:2,right:4,zIndex:100,fontSize:10}}><button onClick={()=>{setTick(tick+1);useNotesStore.setState({tree:[...useNotesStore.getState().tree]});}}>Метаданные</button><span>Синтетические данные</span></div>:null}<div style={{height:18,flexShrink:0,textAlign:'right',padding:'0 8px',fontSize:9,color:'var(--color-text)'}}>Синтетические данные · стенд календаря</div></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);record();
