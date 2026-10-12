import { createReactBlockSpec } from "@blocknote/react";
import { PenLine } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { boardBounds, parseBoard } from "./model";
import { readDrawioDocument, serializeDrawioDocument, type DrawioDocument } from "./drawioDocument";
import type { DrawioCanvasHandle } from "./DrawioCanvas";
import { t } from "../../../lib/i18n";
import { flushAllPending, registerFlusher, useNotesStore } from "../../../store/notes";
import { ModuleBlockGate } from "../../../components/ModuleBlockGate";
import type { Board, Shape } from "./model";
const DrawioCanvas=lazy(()=>import("./DrawioCanvas"));
const PERSIST_DEBOUNCE_MS=600;
const THUMB_W=320,THUMB_H=140;
function WhiteboardView({block,editor}:{block:any;editor:any}){
  const snapshot:string=block.props.snapshot??"";
  const parsed=useMemo(()=>{try{return {document:readDrawioDocument(snapshot),error:null};}catch(e){return {document:null,error:e instanceof Error?e.message:String(e)};}},[snapshot]);
  const latest=useRef<DrawioDocument|null>(parsed.document);
  const blockRef=useRef(block);blockRef.current=block;
  const canvasRef=useRef<DrawioCanvasHandle>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const openButton=useRef<HTMLButtonElement>(null);
  const [open,setOpen]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [name,setName]=useState<string>(block.props.name??"");
  useEffect(()=>{setName(block.props.name??"");},[block.props.name]);
  useEffect(()=>{if(!open)latest.current=parsed.document;},[parsed.document,open]);
  const commit=useCallback(()=>{
    if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}
    if(!latest.current)return;
    const next=serializeDrawioDocument(latest.current);
    if(blockRef.current.props.snapshot!==next)editor.updateBlock(blockRef.current,{type:"whiteboard",props:{snapshot:next}});
  },[editor]);
  const change=useCallback((doc:DrawioDocument)=>{latest.current=doc;if(timer.current!==null)clearTimeout(timer.current);timer.current=setTimeout(commit,PERSIST_DEBOUNCE_MS);},[commit]);
  const flush=useCallback(async()=>{
    // Commit the last autosave synchronously before awaiting a fresh frame snapshot.
    commit();
    if(canvasRef.current){latest.current=await canvasRef.current.flush();commit();}
  },[commit]);
  useEffect(()=>{const unregister=registerFlusher(flush,"blocks");return()=>{unregister();commit();};},[flush,commit]);
  const save=useCallback(async(doc:DrawioDocument)=>{
    latest.current=doc;commit();await flushAllPending();
    const state=useNotesStore.getState();if(state.savingState==="error")throw new Error(state.lastSaveError||"Не удалось сохранить заметку. Холст остаётся открытым.");
  },[commit]);
  const close=useCallback(async()=>{
    try{setError(null);await flush();if(latest.current)await save(latest.current);setOpen(false);requestAnimationFrame(()=>openButton.current?.focus());}
    catch(e){setError(e instanceof Error?e.message:String(e));}
  },[flush,save]);
  const commitName=()=>{const next=name.trim();if(next!==blockRef.current.props.name)editor.updateBlock(blockRef.current,{type:"whiteboard",props:{name:next}});};
  const preview=parsed.document?.preview;
  const legacy=useMemo(()=>parseBoard(parsed.document?.legacySnapshot||snapshot),[parsed.document?.legacySnapshot,snapshot]);
  return <div className="e26-wb" contentEditable={false} onKeyDown={e=>{if(!open)e.stopPropagation();}} onPointerDown={e=>e.stopPropagation()}>
    <div className="e26-wb__card">
      <div className="e26-wb__namerow"><PenLine size={15} className="e26-wb__nameicon" aria-hidden/><input className="e26-wb__name" value={name} placeholder={t("Без названия")} spellCheck={false} onChange={e=>setName(e.target.value)} onBlur={commitName} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}else if(e.key==="Escape"){setName(blockRef.current.props.name??"");e.currentTarget.blur();}}}/></div>
      {preview?<img className="e26-wb__preview-image" src={preview} alt={t("Предпросмотр холста")}/>:<BoardThumb board={legacy}/>}
      {parsed.error?<p className="e26-wb__error" role="alert">{t("Не удалось прочитать холст. Исходные данные сохранены.")}</p>:null}
      <button type="button" ref={openButton} className="e26-wb__open" disabled={!parsed.document} onClick={()=>setOpen(true)}>{t("Открыть доску")}</button>
    </div>
    {open&&parsed.document?<WhiteboardModal name={name} error={error} onClose={()=>void close()}><Suspense fallback={<div className="e26-wb__loading">{t("Загрузка холста…")}</div>}><DrawioCanvas ref={canvasRef} document={latest.current||parsed.document} name={name} onChange={change} onSave={save} onClose={()=>void close()}/></Suspense></WhiteboardModal>:null}
  </div>;
}
export function WhiteboardModal({name,error,onClose,children}:{name:string;error:string|null;onClose:()=>void;children:React.ReactNode}){
  const modal=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const scope=modal.current;
    if(!scope)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const background=Array.from(document.body.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&!node.contains(scope));
    const inert=background.map(node=>node.inert);
    background.forEach(node=>{node.inert=true;});
    const containFocus=(event:FocusEvent)=>{
      if(event.target instanceof Node&&!scope.contains(event.target))scope.focus();
    };
    document.addEventListener("focusin",containFocus);
    scope.focus();
    return()=>{document.removeEventListener("focusin",containFocus);background.forEach((node,index)=>{node.inert=inert[index];});document.body.style.overflow=previous;};
  },[]);
  const containTab=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    if(event.key!=="Tab")return;
    const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),iframe,[tabindex="0"]')).filter(node=>node.getClientRects().length>0);
    const first=controls[0],last=controls[controls.length-1];
    if(!first||!last)return;
    if(document.activeElement===event.currentTarget||(event.shiftKey&&document.activeElement===first)){event.preventDefault();(event.shiftKey?last:first).focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  return createPortal(<div className="e26-wb__overlay" onPointerDown={e=>e.stopPropagation()}><div ref={modal} tabIndex={-1} onKeyDown={containTab} className="e26-wb__modal e26-wb__drawio" role="dialog" aria-modal="true" aria-label={name||t("Холст")}>{error?<div className="drawio-error" role="alert">{error}<button type="button" onClick={onClose}>{t("Повторить сохранение")}</button></div>:null}{children}</div></div>,document.body);
}

function BoardThumb({ board }: { board: Board }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(THUMB_W * dpr);
    canvas.height = Math.round(THUMB_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawThumb(ctx, board.shapes, THUMB_W, THUMB_H, dpr);
  }, [board]);

  // Backing store размер THUMB_W x THUMB_H x dpr (задаётся в эффекте);
  // ОТОБРАЖАЕМЫЙ размер задаётся CSS (width:100% + aspect-ratio), поэтому
  // превью заполняет карточку.
  return <canvas ref={ref} className="e26-wb__thumb" />;
}

/**
 * Рисует превью доски, вписанное в bounds. Самостоятельный (без camera
 * класса) -- считает один uniform scale + offset чтобы вписать bounds доски
 * в thumbnail с паддингом, потом рисует упрощённые шейпы.
 */
function drawThumb(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  cssW: number,
  cssH: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const b = boardBounds(shapes);
  if (!b) return;

  const pad = 8;
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const scale = Math.min((cssW - pad * 2) / bw, (cssH - pad * 2) / bh, 4);
  // Центрируем замасштабированную доску в thumbnail.
  const offX = (cssW - bw * scale) / 2 - b.minX * scale;
  const offY = (cssH - bh * scale) / 2 - b.minY * scale;

  const X = (wx: number) => wx * scale + offX;
  const Y = (wy: number) => wy * scale + offY;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const s of shapes) {
    ctx.lineWidth = Math.max(0.5, s.sw * scale);
    ctx.strokeStyle = s.color;
    switch (s.type) {
      case "pen": {
        if (!s.points.length) break;
        ctx.beginPath();
        ctx.moveTo(X(s.points[0].x), Y(s.points[0].y));
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(X(s.points[i].x), Y(s.points[i].y));
        }
        ctx.stroke();
        break;
      }
      case "rect": {
        if (s.fill && s.fill !== "transparent") {
          ctx.fillStyle = s.fill;
          ctx.fillRect(X(s.x), Y(s.y), s.w * scale, s.h * scale);
        }
        ctx.strokeRect(X(s.x), Y(s.y), s.w * scale, s.h * scale);
        break;
      }
      case "ellipse": {
        ctx.beginPath();
        ctx.ellipse(
          X(s.x + s.w / 2),
          Y(s.y + s.h / 2),
          Math.abs(s.w * scale) / 2,
          Math.abs(s.h * scale) / 2,
          0,
          0,
          Math.PI * 2,
        );
        if (s.fill && s.fill !== "transparent") {
          ctx.fillStyle = s.fill;
          ctx.fill();
        }
        ctx.stroke();
        break;
      }
      case "arrow": {
        ctx.beginPath();
        ctx.moveTo(X(s.x1), Y(s.y1));
        ctx.lineTo(X(s.x2), Y(s.y2));
        ctx.stroke();
        break;
      }
      case "text": {
        ctx.fillStyle = s.color;
        const fs = Math.max(2, s.size * scale * 0.7);
        ctx.font = `${fs}px sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(s.text.slice(0, 24) || " ", X(s.x), Y(s.y));
        break;
      }
      // Упрощённые силуэты нод flowchart, чтобы превью не было пустым
      // для досок целиком из db/action/note нод.
      case "db": {
        const x = X(s.x);
        const y = Y(s.y);
        const w = s.w * scale;
        const h = s.h * scale;
        const ry = Math.min(h * 0.16, 5);
        ctx.fillStyle = s.fill;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + ry, w / 2, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x, y + ry, w, Math.max(0, h - ry * 2));
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case "action": {
        const x = X(s.x);
        const y = Y(s.y);
        const w = s.w * scale;
        const h = s.h * scale;
        ctx.fillStyle = s.fill;
        if (s.variant === "decision") {
          ctx.beginPath();
          ctx.moveTo(x + w / 2, y);
          ctx.lineTo(x + w, y + h / 2);
          ctx.lineTo(x + w / 2, y + h);
          ctx.lineTo(x, y + h / 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x, y, w, h);
        }
        break;
      }
      case "note": {
        const x = X(s.x);
        const y = Y(s.y);
        const w = s.w * scale;
        const h = s.h * scale;
        ctx.fillStyle = s.fill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        break;
      }
    }
  }
}

export const whiteboardBlock = createReactBlockSpec(
  {
    type: "whiteboard",
    content: "none",
    propSchema: { snapshot: { default: "" }, name: { default: "" } },
  },
  {
    // Non-atom чтобы клик ставил TEXT-caret в следующую строку, а не
    // NodeSelection на карточку (фикс бага caret-after-block).
    meta: { isolating: false, selectable: false },
    render: (props) => (
      <ModuleBlockGate module="canvas"><WhiteboardView block={props.block} editor={props.editor} /></ModuleBlockGate>
    ),
    toExternalHTML: () => <p data-whiteboard="1">[Доска]</p>,
    parse: (el) =>
      el.getAttribute("data-whiteboard") === "1" ? { snapshot: "" } : undefined,
  },
);
