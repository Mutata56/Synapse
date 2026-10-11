import { createRoot } from "react-dom/client";
import { useState } from "react";
import { LanguageProvider } from "../../src/components/LanguageProvider";
import App from "../../src/App";
import { IconizeSettings } from "../../src/components/IconizeSettings";
import { IconGlyph } from "../../src/components/NoteIcon";
import { useIconizeStore } from "../../src/store/iconize";
import { useNotesStore } from "../../src/store/notes";
import { useWorkspaceStore } from "../../src/store/workspace";
import { emptyIconizeState } from "../../src/lib/iconize";
import { remarkIconize, InlineIcon } from "../../src/components/IconizeMarkdown";
import ReactMarkdown from "react-markdown";
import type { Note, TreeNode } from "../../src/lib/storage";
import {seedIconizeData} from "./iconize-fs-mock";
import {resetStorageCaches} from "../../src/lib/storage";
import "@blocknote/core/fonts/inter.css";
import "../../src/index.css";

const iconData = emptyIconizeState();
iconData.settings.iconInTitlePosition = "inline";
iconData.settings.recentlyUsedIcons = ["FabJava","SiPostgresql","LiWarehouse","FarMoneyBill1","LiCode"];
iconData.assignments = { "folder:Study": { icon:"LiGraduationCap",color:"#9a9bdf" }, "folder:Work":{icon:"LiWarehouse",color:"#5fb89a"}, "file:Study/Java.md":{icon:"FabJava",color:"#ef9c55"}, "file:Study/PostgreSQL.md":{icon:"SiPostgresql",color:"#7fa7df"} };
seedIconizeData(iconData);
const testWindow = window as unknown as { iconizeFailClipboard?: boolean; iconizeClipboardText?: string; iconizeReload?: () => Promise<void> };
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { if (testWindow.iconizeFailClipboard) throw new Error("Simulated clipboard failure"); testWindow.iconizeClipboardText = text; } } });
testWindow.iconizeReload = async () => { resetStorageCaches(); useIconizeStore.setState({ loaded: false }); await useIconizeStore.getState().load(); };
const body="# Iconize\n\nИконки в тексте: :FabJava: :SiPostgresql: :LiWarehouse:.\n\n` :FabJava: ` остаётся кодом.\n\n[[PostgreSQL]] и [[Java]]\n";
const note=(id:string,title:string):Note=>({id,title,content:body,folder:id.split("/").slice(0,-1).join("/"),createdAt:Date.now(),updatedAt:Date.now(),icon:null,cover:null,preview:"Пример заметки для проверки Iconize",favorite:false,tags:[],links:[]});
const notes=[note("Study/Java","Java"),note("Study/PostgreSQL","PostgreSQL"),note("Work/Warehouse","Warehouse")];
const tree:TreeNode[]=[{kind:"folder",name:"Study",path:"Study",children:notes.slice(0,2).map(note=>({kind:"note",note}))},{kind:"folder",name:"Work",path:"Work",children:[{kind:"note",note:notes[2]}]}];
useIconizeStore.setState({data:iconData,loaded:true});
useNotesStore.setState({tree,activeNote:notes[0],activeId:notes[0].id,expandedFolders:new Set(["Study","Work"]), selectNote:async id=>{const selected=notes.find(note=>note.id===id);if(selected)useNotesStore.setState({activeId:id,activeNote:selected,view:"notes"});},loadFolderColors:async()=>{},refreshTree:async()=>{},saveNote:async patch=>{const current=useNotesStore.getState().activeNote!;useNotesStore.setState({activeNote:{...current,...patch}});}});
useWorkspaceStore.setState({tabs:[{id:"java",target:{kind:"note",noteId:"Study/Java"}},{id:"postgres",target:{kind:"note",noteId:"Study/PostgreSQL"}}],activeTabId:"java"});
function Fixture(){
 const [screen,setScreen]=useState("app");
 return <><div style={{position:"fixed",right:14,bottom:12,zIndex:200,display:"flex",gap:8}}>
 <button className="iconize-button" onClick={()=>useIconizeStore.getState().openPicker({targets:[{kind:"file",path:"Study/Java.md"}],current:useIconizeStore.getState().data.assignments["file:Study/Java.md"]})}>Iconize picker</button>
 <button className="iconize-button" onClick={()=>setScreen(screen==="settings"?"app":"settings")}>Iconize settings</button>
 </div><div style={screen==="app"?{}:{display:"none"}}><App bootstrap={false}/></div>{screen==="settings"&&<div style={{height:"100dvh",overflowY:"auto",padding:"32px",maxWidth:900,margin:"0 auto"}}><IconizeSettings/></div>}
 <div id="iconize-markdown-probe" style={{position:"fixed",left:400,bottom:65,zIndex:100,padding:8,background:"var(--color-bg-elevated)"}}><ReactMarkdown remarkPlugins={[[remarkIconize,{enabled:true,identifier:":"}]]} urlTransform={url=>url} components={{a:({href,children})=>href?.startsWith("synapse-icon:")?<InlineIcon id={href.slice(13)}>{children}</InlineIcon>:<a>{children}</a>}}>{":FabJava: and ` :FabJava: `"}</ReactMarkdown><IconGlyph value="🙂" size={20}/></div></>;
}
createRoot(document.getElementById("root")!).render(<LanguageProvider><Fixture/></LanguageProvider>);
