import { ChevronLeft, ChevronRight, Expand, ImageOff, Link2, Minus, Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isImageNote, type LibraryImage } from "../lib/imageLibrary";
import { useI18n } from "./LanguageProvider";
import { Modal } from "./Modal";

export default function LibraryImageViewer({ images, activeId, onChoose, onClose, onUsage }: { images: readonly LibraryImage[]; activeId: string; onChoose: (id: string) => void; onClose: () => void; onUsage: (id: string) => void }) {
  const { t } = useI18n();
  const position = images.findIndex((image) => image.id === activeId);
  const image = images[position];
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const scale = useRef(1);
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; pointer: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<{ id: string; failed: boolean } | null>(null);
  const apply = () => { if (picture.current) picture.current.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px) scale(${scale.current})`; };
  const changeScale = (next: number) => { scale.current = Math.max(.25, Math.min(32, next)); setZoom(scale.current); apply(); };
  const fit = () => { offset.current = { x: 0, y: 0 }; changeScale(1); };
  const navigate = (step: number) => { const next = images[position + step]; if (next) onChoose(next.id); };
  useLayoutEffect(() => { offset.current = { x: 0, y: 0 }; scale.current = 1; setZoom(1); drag.current = null; }, [activeId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>(".images-viewer-close")?.focus();
    return () => { if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const element = stage.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      scale.current = Math.max(.25, Math.min(32, scale.current * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
      if (picture.current) picture.current.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px) scale(${scale.current})`;
      setZoom(scale.current);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  if (!image) return null;
  const note = image.usedBy.find(isImageNote);
  return createPortal(<Modal open onClose={onClose} variant="lightbox" ariaLabel={t("Просмотр изображения")} panelClassName="contents">
    <div className="images-viewer" ref={root} onKeyDown={(event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); changeScale(scale.current * 1.25); }
      else if (event.key === "-") { event.preventDefault(); changeScale(scale.current / 1.25); }
      else if (event.key === "0") { event.preventDefault(); fit(); }
      else if (event.key === "Tab") {
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus(); }
      }
    }}>
      <header><div className="images-viewer-navigation"><button type="button" disabled={position === 0} onClick={() => navigate(-1)} aria-label={t("Предыдущее изображение")}><ChevronLeft size={18} /></button><span>{position + 1} / {images.length}</span><button type="button" disabled={position === images.length - 1} onClick={() => navigate(1)} aria-label={t("Следующее изображение")}><ChevronRight size={18} /></button></div><div className="images-viewer-zoom"><button type="button" onClick={() => changeScale(scale.current / 1.25)} aria-label={t("Уменьшить")}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => changeScale(scale.current * 1.25)} aria-label={t("Увеличить")}><Plus size={16} /></button><button type="button" onClick={fit} aria-label={t("Вписать изображение")} title={t("Вписать изображение")}><Expand size={16} /></button><button type="button" onClick={() => {
        const element = picture.current; const area = stage.current;
        if (element && area && element.naturalWidth && element.naturalHeight) changeScale(1 / Math.min(1, element.clientWidth / element.naturalWidth, element.clientHeight / element.naturalHeight));
      }}>1:1</button></div><button type="button" className="images-viewer-close" onClick={onClose} aria-label={t("Закрыть")}><X size={19} /></button></header>
      <div ref={stage} className="images-viewer-stage">
        {status?.id === image.id && status.failed ? <div className="images-empty"><ImageOff size={32} /><p>{t("Не удалось открыть изображение")}</p></div> : <img key={image.id} ref={picture} src={image.url} alt={image.name} draggable={false} onLoad={() => setStatus({ id: image.id, failed: false })} onError={() => setStatus({ id: image.id, failed: true })} onPointerDown={(event) => {
          if (event.button !== 0 || drag.current) return;
          drag.current = { x: event.clientX, y: event.clientY, ox: offset.current.x, oy: offset.current.y, pointer: event.pointerId };
          event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.style.cursor = "grabbing";
        }} onPointerMove={(event) => {
          const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
          offset.current = { x: current.ox + event.clientX - current.x, y: current.oy + event.clientY - current.y }; apply();
        }} onPointerUp={(event) => { if (drag.current?.pointer === event.pointerId) { drag.current = null; event.currentTarget.style.cursor = "grab"; } }} onPointerCancel={() => { drag.current = null; }} />}
      </div>
      <footer><span title={image.name}>{image.name}</span>{note && <button type="button" onClick={() => onUsage(note.id)} title={note.folder ? `${note.folder} / ${note.title}` : note.title}><Link2 size={14} /><span>{note.title}</span><ChevronRight size={13} /></button>}</footer>
    </div>
  </Modal>, document.body);
}
