import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Download, FolderOpen, LoaderCircle, Save, Undo2, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { DrawioSession, parseDrawioEvent, trustedDrawioMessage, type DrawioEvent } from "../../../lib/drawioBridge";
import { exportDrawioPdf, getDrawioSvgPage, importDrawioFile, isDrawioExportFormat, createDrawioHtml, saveDrawioExport, type ImportedDrawioFile } from "../../../lib/drawioFiles";
import { getLanguage, t } from "../../../lib/i18n";
import { readDrawioDocument, type DrawioDocument } from "./drawioDocument";
import "./drawio.css";

export type DrawioCanvasHandle = { flush: () => Promise<DrawioDocument> };
type Props = { document: DrawioDocument; name: string; onChange: (document: DrawioDocument) => void; onSave: (document: DrawioDocument) => Promise<void>; onClose: () => void; pickFile?: () => Promise<ImportedDrawioFile|null> };
function editorUrl(dark = true,pageId?:string): string {
  const url = new URL("/drawio/index.html", window.location.href);
  const params = { embed:"1", proto:"json", configure:"1", lang:getLanguage(), dark:dark?"1":"0", noSaveBtn:"1", noExitBtn:"1", saveAndExit:"0", keepmodified:"1", offline:"1", stealth:"1", spin:"1" };
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  if(pageId)url.searchParams.set("page-id",pageId);
  return url.href;
}
function post(frame: HTMLIFrameElement, message: Record<string, unknown>): void {
  frame.contentWindow?.postMessage(JSON.stringify(message), /^https?:/.test(window.location.origin) ? window.location.origin : "*");
}
function cameraOptions(doc: DrawioDocument): Record<string, unknown> {
  if (doc.viewport) return { scale:doc.viewport.scale, scroll:doc.viewport.scroll, pageId:doc.viewport.pageId };
  try { const camera = JSON.parse(doc.legacySnapshot || "{}").camera; if (camera && Number.isFinite(camera.zoom) && camera.zoom > 0) return {scale:camera.zoom, scroll:{x:-camera.x/camera.zoom,y:-camera.y/camera.zoom}}; } catch {}
  return {};
}
/** Each SVG page is rendered in a disposable background editor, preserving the active page and undo history. */
async function svgPages(xml: string): Promise<ReturnType<typeof getDrawioSvgPage>[]> {
  const parsed = new DOMParser().parseFromString(xml,"application/xml");
  if (parsed.querySelector("parsererror")) throw new Error("Не удалось прочитать страницы схемы.");
  const root = parsed.documentElement;
  const diagrams = root.tagName === "mxfile" ? Array.from(root.children).filter(node=>node.tagName==="diagram") : [];
  const pages = diagrams.length ? diagrams.map(diagram=> { const copy=root.cloneNode(false) as Element; copy.appendChild(diagram.cloneNode(true)); return new XMLSerializer().serializeToString(copy); }) : [xml];
  const frame = document.createElement("iframe");
  frame.className="drawio-export-frame"; frame.title=t("Экспорт страниц холста"); frame.setAttribute("aria-hidden","true");
  frame.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms allow-modals");
  let session: DrawioSession;
  let readyResolve!:()=>void; let readyReject!:(e:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const readyTimer=setTimeout(()=>readyReject(new Error("Не удалось загрузить редактор экспорта.")),20000);
  session=new DrawioSession(message=>post(frame,message),pages[0],{ready:value=>{if(value){clearTimeout(readyTimer);readyResolve();}},change:()=>{},save:()=>{},export:()=>{},exit:()=>{},link:()=>{},error:readyReject},{defaultAdaptiveColors:"none"});
  const listener=(event:MessageEvent)=> { if(trustedDrawioMessage(event,frame.contentWindow,window.location.origin)){const data=parseDrawioEvent(event.data);if(data)session.accept(data);} };
  window.addEventListener("message",listener); frame.src=editorUrl(false); document.body.appendChild(frame);
  try {
    await ready;
    const result=[];
    for(const page of pages){const event=await session.export("xmlsvg",{xml:page,asText:true,embedFonts:true,theme:"light"});if(typeof event.data!=="string")throw new Error("Редактор не вернул страницу.");result.push(getDrawioSvgPage(event.data));}
    return result;
  } finally {clearTimeout(readyTimer);session.dispose();window.removeEventListener("message",listener);frame.remove();}
}
let viewerRequest:Promise<string>|undefined;
function viewerSource():Promise<string> {
  if(!viewerRequest)viewerRequest=fetch("/drawio/js/viewer-static.min.js").then(async response=>{
    if(!response.ok)throw new Error("Не удалось подготовить HTML-просмотр.");
    return response.text();
  }).catch(error=>{viewerRequest=undefined;throw error;});
  return viewerRequest;
}

export default forwardRef<DrawioCanvasHandle,Props>(function DrawioCanvas(props,ref){
  const frameRef=useRef<HTMLIFrameElement>(null);
  const sessionRef=useRef<DrawioSession|null>(null);
  const current=useRef(props.document);
  const callbacks=useRef(props);callbacks.current=props;
  const live=useRef(true);
  const readyRef=useRef(false);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const [error,setError]=useState<string|null>(null);
  const [status,setStatus]=useState(t("Загрузка холста…"));
  const [retry,setRetry]=useState(0);
  const frameUrl=useRef(editorUrl(true,props.document.viewport?.pageId));
  const [format,setFormat]=useState("drawio");
  const [pendingImport,setPendingImport]=useState<ImportedDrawioFile|null>(null);
  const captureViewport=useRef<()=>void>(()=>{});
  const notify=(doc:DrawioDocument)=> {current.current=doc;callbacks.current.onChange(doc);};
  const flush=async()=> {
    captureViewport.current();
    const session=sessionRef.current;
    if(session&&readyRef.current){const xml=await session.xml();current.current={...current.current,xml};}
    return current.current;
  };
  useImperativeHandle(ref,()=>({flush}));
  const action=async(task:()=>Promise<void>)=> {if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{await task();}catch(e){if(live.current)setError(e instanceof Error?e.message:String(e));}finally{busyRef.current=false;if(live.current)setBusy(false);}};
  const save=async(close=false)=> {
    const doc=await flush(); await callbacks.current.onSave(doc);
    if(current.current.xml===doc.xml){sessionRef.current?.saved();if(live.current)setStatus(t("Сохранено"));}if(close)callbacks.current.onClose();
  };
  const withoutImportBackup=(doc:DrawioDocument):DrawioDocument=> {
    const {importBackup:_backup,...rest}=doc;
    return rest as DrawioDocument;
  };
  const replaceImport=async(file:ImportedDrawioFile)=> {
    const previous=await flush();
    try {
      const event=await sessionRef.current!.load(file.xml,file.name);
      if(typeof event.xml!=="string")throw new Error("Файл не содержит редактируемой схемы.");
      notify({...previous,xml:event.xml,preview:undefined,viewport:undefined,importBackup:withoutImportBackup(previous)});
      setPendingImport(null);
    } catch(error) {
      current.current=previous;
      await sessionRef.current!.load(previous.xml,callbacks.current.name,cameraOptions(previous)).catch(()=>{});
      notify(previous);
      throw error;
    }
  };
  const restoreImport=async()=> {
    const previous=await flush();
    const backup=readDrawioDocument(JSON.stringify(previous.importBackup));
    const event=await sessionRef.current!.load(backup.xml,callbacks.current.name,cameraOptions(backup));
    if(typeof event.xml!=="string")throw new Error("Не удалось восстановить предыдущий холст.");
    notify({...backup,xml:event.xml,importBackup:withoutImportBackup(previous)});
  };
  const saveExport=async(event:DrawioEvent)=> {
    const format=event.format==="html2"?"html":event.format;
    if(!isDrawioExportFormat(format))throw new Error("Редактор не вернул поддерживаемый файл.");
    const name=event.filename||callbacks.current.name||"Холст";
    if(format==="html"){
      const xml=typeof event.xml==="string"?event.xml:await sessionRef.current!.xml();
      await saveDrawioExport(createDrawioHtml(xml,name,await viewerSource()),"html",name);
      return;
    }
    if(typeof event.data!=="string")throw new Error("Редактор не вернул файл.");
    await saveDrawioExport(event.data,format,name);
  };
  const exportFormat=async()=> {
    const session=sessionRef.current;if(!session)return;
    const doc=await flush();
    if(format==="drawio"){await saveDrawioExport(doc.xml,"drawio",callbacks.current.name||"Холст");return;}
    if(format==="pdf"){await exportDrawioPdf(await svgPages(doc.xml),doc.xml,callbacks.current.name||"Холст");return;}
    if(format==="html"){
      await saveDrawioExport(createDrawioHtml(doc.xml,callbacks.current.name,await viewerSource()),"html",callbacks.current.name||"Холст");return;
    }
    if(format==="json"){
      const event=await session.requestExport({format:"json"});
      await saveExport({...event,format:"json"});return;
    }
    const event=await session.export(format==="svg"?"xmlsvg":"xmlpng",{currentPage:true,embedFonts:true});
    await saveExport({...event,format:format==="svg"?"svg":"png"});
  };
  useEffect(()=>{
    live.current=true;readyRef.current=false;setReady(false);setError(null);setStatus(t("Загрузка холста…"));
    const frame=frameRef.current;if(!frame)return;
    let container:HTMLElement|null=null;let scrollTimer:ReturnType<typeof setTimeout>|undefined;
    let scale=1;let translate={x:0,y:0};let pageId:string|undefined;let pageXml="";let pageIds:string[]=[];let previewTimer:ReturnType<typeof setTimeout>|undefined;
    const viewport=()=> {
      if(!container||!readyRef.current)return;
      const scroll={x:container.scrollLeft/scale-translate.x,y:container.scrollTop/scale-translate.y};
      const next={scale,scroll,pageId};
      const previous=current.current.viewport;
      if(previous?.scale===scale&&previous.scroll?.x===scroll.x&&previous.scroll?.y===scroll.y&&previous.pageId===pageId)return;
      notify({...current.current,viewport:next});
    };
    captureViewport.current=viewport;
    const onScroll=()=>{if(scrollTimer)clearTimeout(scrollTimer);scrollTimer=setTimeout(viewport,250);};
    const session=new DrawioSession(message=>post(frame,message),current.current.xml,{
      ready:value=> {readyRef.current=value;setReady(value);setStatus(value?t("Автосохранение"):t("Загрузка холста…"));if(value){try{container=frame.contentDocument?.querySelector<HTMLElement>(".geDiagramContainer")||null;container?.addEventListener("scroll",onScroll,{passive:true});}catch{}}},
      change:xml=> {const changed=xml!==current.current.xml;current.current={...current.current,xml,...(changed?{preview:undefined}:{})};if(readyRef.current){notify(current.current);setStatus(t("Автосохранение"));}},
      save:(_xml,exit)=>{void action(()=>save(exit));},
      export:event=>{void action(()=>saveExport(event));},
      exit:()=>callbacks.current.onClose(),
      link:url=>{if(isTauri())void import("@tauri-apps/plugin-opener").then(({openUrl})=>openUrl(url)).catch(e=>setError(String(e)));else window.open(url,"_blank","noopener,noreferrer");},
      error:e=>{if(live.current)setError(e.message);}
    },{compressXml:false,enableExportUrl:false,enableNativeClipboard:true,enableCustomLibraries:true,suppressNewWindows:true,sidebarWidth:200,defaultAdaptiveColors:"auto",defaultFontFamily:"Inter"},cameraOptions(current.current));
    sessionRef.current=session;
    const listener=(event:MessageEvent)=> {
      if(!trustedDrawioMessage(event,frame.contentWindow,window.location.origin))return;
      const data=parseDrawioEvent(event.data);if(!data)return;
      if(typeof data.scale==="number"&&data.scale>0){scale=data.scale;const p=data.translate;if(p&&typeof p==="object"&&typeof (p as {x?:unknown}).x==="number"&&typeof (p as {y?:unknown}).y==="number")translate=p as {x:number;y:number};}
      if(typeof data.currentPage==="number"){
        if(pageXml!==current.current.xml){pageXml=current.current.xml;const parsed=new DOMParser().parseFromString(pageXml,"application/xml");pageIds=Array.from(parsed.querySelectorAll("mxfile > diagram")).map(node=>node.getAttribute("id")||"");}
        pageId=pageIds[data.currentPage]||undefined;
      }
      session.accept(data);
      if(data.event==="zoom")viewport();
      if(data.event==="autosave"||data.event==="load"){
        if(previewTimer)clearTimeout(previewTimer);
        previewTimer=setTimeout(()=>{
          const xml=current.current.xml;
          void session.export("svg",{scale:.5,border:6,embedImages:true,embedFonts:false}).then(exported=>{
            if(live.current&&current.current.xml===xml&&typeof exported.data==="string"&&exported.data.length<=16*1024*1024&&exported.data.startsWith("data:image/svg+xml"))notify({...current.current,preview:exported.data});
          }).catch(()=>{});
        },1200);
      }
    };
    window.addEventListener("message",listener);
    return()=> {live.current=false;captureViewport.current=()=>{};if(scrollTimer)clearTimeout(scrollTimer);if(previewTimer)clearTimeout(previewTimer);container?.removeEventListener("scroll",onScroll);window.removeEventListener("message",listener);session.dispose();sessionRef.current=null;};
  },[retry]);
  return <div className="drawio-canvas">
    <header className="drawio-hostbar">
      <span className="drawio-title">{props.name.trim()||t("Холст")}</span>
      <span className="drawio-status" role="status" aria-live="polite">{busy?<LoaderCircle size={14} aria-hidden="true"/>:null}{status}</span>
      <div className="drawio-actions">
        <button type="button" disabled={!ready||busy} onClick={()=>void action(async()=>{const file=await (callbacks.current.pickFile||importDrawioFile)();if(file)setPendingImport(file);})} title={t("Открыть файл схемы")} aria-label={t("Открыть файл схемы")}><FolderOpen size={16}/></button>
        {props.document.importBackup?<button type="button" disabled={!ready||busy} onClick={()=>void action(restoreImport)} title={t("Восстановить предыдущий холст")} aria-label={t("Восстановить предыдущий холст")}><Undo2 size={16}/></button>:null}
        <select aria-label={t("Формат экспорта холста")} value={format} disabled={!ready||busy} onChange={e=>setFormat(e.target.value)}><option value="drawio">.drawio</option><option value="svg">SVG</option><option value="png">PNG</option><option value="pdf">PDF</option><option value="html">HTML</option><option value="json">JSON</option></select>
        <button type="button" disabled={!ready||busy} onClick={()=>void action(exportFormat)} title={t("Экспортировать холст")} aria-label={t("Экспортировать холст")}><Download size={16}/></button>
        <button type="button" disabled={!ready||busy} onClick={()=>void action(()=>save())} title={t("Сохранить холст")} aria-label={t("Сохранить холст")}><Save size={16}/></button>
        <button type="button" disabled={busy} onClick={props.onClose} title={t("Закрыть холст")} aria-label={t("Закрыть холст")}><X size={18}/></button>
      </div>
    </header>
    {pendingImport?<div className="drawio-error drawio-import-confirm" role="alert"><span>{t("Файл")} «{pendingImport.name}» {t("заменит текущий холст. Предыдущую схему можно будет восстановить.")}</span><button type="button" disabled={busy} onClick={()=>void action(()=>replaceImport(pendingImport))}>{t("Заменить холст")}</button><button type="button" disabled={busy} onClick={()=>setPendingImport(null)}>{t("Отмена")}</button></div>:null}
    {error?<div className="drawio-error" role="alert"><span>{error}</span>{!ready?<button type="button" onClick={()=>setRetry(v=>v+1)}>{t("Повторить")}</button>:null}</div>:null}
    <div className="drawio-frame-stage">
      {!ready&&!error?<div className="drawio-loading" role="status"><LoaderCircle size={20} aria-hidden="true"/><span>{t("Загрузка холста…")}</span></div>:null}
      <iframe key={retry} ref={frameRef} className="drawio-frame" src={frameUrl.current} title={t("Редактор схем холста")} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" />
    </div>
  </div>;
});
