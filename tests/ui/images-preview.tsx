import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from '../../src/components/Sidebar';
import { ImagesView } from '../../src/components/ImagesView';
import { LanguageProvider } from '../../src/components/LanguageProvider';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { useNotesStore } from '../../src/store/notes';
import type { ImageLibrary, LibraryImage } from '../../src/lib/imageLibrary';
import type { ImagePreview } from '../../src/lib/imagePreviews';
import type { Note } from '../../src/lib/storage';

import '../../src/index.css';
import './tags-preview.css';
const mode=new URLSearchParams(location.search).get('data')??'vault';
const real:ImageLibrary=await fetch('/__images-library').then(response=>response.json());
const previews:Record<string,ImagePreview & {error?:string}>=await fetch('/__images-preview-map').then(response=>response.json());
type FixtureImage=LibraryImage & {sourceId?:string};
let items:FixtureImage[]=mode==='empty'?[]:mode==='stress'?Array.from({length:50000},(_,i)=>({...real.images[i%real.images.length],id:`stress/${i}`,name:`Изображение ${i+1}.png`,sourceId:real.images[i%real.images.length].id,modifiedAt:Date.now()-i*1000,managed:false})):mode==='managed'?[...real.images,...Array.from({length:3},(_,i)=>({...real.images[i],sourceId:real.images[i].id,id:'.assets/'+String(i+1).repeat(64)+'.png',name:String(i+1).repeat(64)+'.png',managed:true,usedBy:i?[]:real.images[i].usedBy}))]:real.images;
let loads=0;let requests=0;
async function loadLibrary():Promise<ImageLibrary>{loads++;if(mode==='error'&&loads===1)throw Error('Fixture load failure');return {images:items,complete:mode!=='partial'};}
async function loadPreview(image:FixtureImage,signal:AbortSignal):Promise<ImagePreview>{
 requests++;document.documentElement.dataset.previewRequests=String(requests);
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 if(mode==='broken')throw Error('Fixture preview failure');
 const id=image.sourceId??image.id;const preview=previews[id];
 if(!preview||preview.error)throw Error('No preview');
 return {...preview,url:'/__images-preview?id='+encodeURIComponent(id)};
}
useNotesStore.setState({view:'images',selectNote:async(id:string)=>{const usage=real.images.flatMap(i=>i.usedBy).find(u=>u.id===id);if(usage)useNotesStore.setState({activeId:id,activeNote:{id,title:usage.title,content:'',folder:usage.folder,createdAt:Date.now(),updatedAt:Date.now(),icon:null,cover:null,preview:'',favorite:false,tags:[],links:[]} as Note});}});
function Fixture(){const view=useNotesStore(s=>s.view);const note=useNotesStore(s=>s.activeNote);return <div className="tags-qa-shell"><Sidebar/><main>{view==='notes'?<div className="tags-qa-opened"><h1>{note?.title}</h1><button onClick={()=>useNotesStore.getState().setView('images')}>Вернуться к изображениям</button></div>:<ImagesView loadLibrary={loadLibrary} previewLoader={loadPreview} revealImage={async()=>{}} deleteImages={async ids=>{items=items.filter(image=>!ids.includes(image.id));document.documentElement.dataset.deletedFixtureImages=String(ids.length);}}/>}</main>{mode==='stress'&&<span style={{position:'fixed',left:8,bottom:8,fontSize:10,color:'#9a9aa6',pointerEvents:'none'}}>Тестовая коллекция: 50 000</span>}<ConfirmDialog/></div>}
let commits=0;
function profileRender(_id:string,phase:string,actualMs:number){
 const memory=(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory;
 document.documentElement.dataset.imageProfile=JSON.stringify({commits:++commits,phase,actualMs,heapBytes:memory?.usedJSHeapSize??null});
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Profiler id="images-review" onRender={profileRender}><Fixture/></Profiler></LanguageProvider>);
