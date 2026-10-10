import { ChevronDown, ChevronUp, GripVertical, Map } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { clampMinimapPosition } from "../lib/graphGeometry";
import type { GraphMapSnapshot } from "../lib/graphTypes";
import { t } from "../lib/i18n";

export type GraphMinimapHandle = { update: (snapshot: GraphMapSnapshot) => void };
const WIDTH = 194, HEIGHT = 132, HEADER = 32;
const STORAGE_KEY = "synapse.graph.minimap";
type Position = { x: number; y: number };

export const GraphMinimap = forwardRef<GraphMinimapHandle, { host: RefObject<HTMLDivElement | null>; center: (x: number, y: number) => void }>(function GraphMinimap({ host, center }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const snapshot = useRef<GraphMapSnapshot | null>(null);
  const transform = useRef({ x: 0, y: 0, scale: 1 });
  const [expanded, setExpanded] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")?.expanded !== false; } catch { return true; }
  });
  const [position, setPosition] = useState<Position | null>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      return Number.isFinite(data?.x) && Number.isFinite(data?.y) ? { x: data.x, y: data.y } : null;
    } catch { return null; }
  });
  const positionRef = useRef(position);
  const drag = useRef<{ x: number; y: number; origin: Position } | null>(null);

  const bound = useCallback((next: Position) => {
    const element = host.current;
    return clampMinimapPosition(next.x, next.y, element?.clientWidth ?? WIDTH + 24, element?.clientHeight ?? HEIGHT + HEADER + 24, WIDTH, HEADER + (expanded ? HEIGHT : 0));
  }, [host, expanded]);

  const setBoundPosition = useCallback((next: Position) => {
    const value = bound(next); positionRef.current = value; setPosition(value);
  }, [bound]);

  const reset = useCallback(() => {
    const element = host.current;
    setBoundPosition({ x: (element?.clientWidth ?? WIDTH + 24) - WIDTH - 12, y: (element?.clientHeight ?? HEIGHT + HEADER + 24) - HEADER - (expanded ? HEIGHT : 0) - 12 });
  }, [host, expanded, setBoundPosition]);

  const draw = useCallback(() => {
    const element = canvas.current, value = snapshot.current;
    if (!element || !value || !expanded) return;
    const ctx = element.getContext("2d"); if (!ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (element.width !== WIDTH * ratio || element.height !== HEIGHT * ratio) { element.width = WIDTH * ratio; element.height = HEIGHT * ratio; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const padding = 12;
    const worldWidth = Math.max(80, value.bounds.maxX - value.bounds.minX);
    const worldHeight = Math.max(80, value.bounds.maxY - value.bounds.minY);
    const scale = Math.min((WIDTH - padding * 2) / worldWidth, (HEIGHT - padding * 2) / worldHeight);
    const centerX = (value.bounds.minX + value.bounds.maxX) / 2, centerY = (value.bounds.minY + value.bounds.maxY) / 2;
    transform.current = { x: centerX, y: centerY, scale };
    const sx = (x: number) => WIDTH / 2 + (x - centerX) * scale;
    const sy = (y: number) => HEIGHT / 2 + (y - centerY) * scale;
    for (let index = 0; index < value.active.length; index++) {
      if (!value.active[index]) continue;
      ctx.fillStyle = value.colors[index] ?? "#969ba7";
      ctx.fillRect(sx(value.positions[index * 2]) - 1, sy(value.positions[index * 2 + 1]) - 1, 2, 2);
    }
    const left = sx(-value.camera.x / value.camera.scale), top = sy(-value.camera.y / value.camera.scale);
    const width = value.width / value.camera.scale * scale, height = value.height / value.camera.scale * scale;
    ctx.strokeStyle = "#a5b4fc"; ctx.fillStyle = "rgba(165,180,252,0.08)"; ctx.lineWidth = 1.1;
    ctx.fillRect(left, top, width, height); ctx.strokeRect(left, top, width, height);
  }, [expanded]);

  useImperativeHandle(ref, () => ({ update: (value) => { snapshot.current = value; draw(); } }), [draw]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = () => positionRef.current ? setBoundPosition(positionRef.current) : reset();
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [host, reset, setBoundPosition]);

  useEffect(() => {
    draw();
    if (position) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...position, expanded })); } catch { /* navigation works without optional preference persistence */ }
    }
  }, [position, expanded, draw]);

  const navigate = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), mapping = transform.current;
    center(mapping.x + (event.clientX - rect.left - WIDTH / 2) / mapping.scale, mapping.y + (event.clientY - rect.top - HEIGHT / 2) / mapping.scale);
  };

  return <aside className={`graph-minimap ${expanded ? "" : "is-collapsed"}`} aria-label={t("Миникарта графа")} style={{ left: position?.x ?? 12, top: position?.y ?? 12, visibility: position ? "visible" : "hidden" }}>
    <div className="graph-minimap-header">
      <button type="button" className="graph-minimap-handle" aria-label={t("Переместить миникарту")} title={t("Перетащите за ручку. Стрелки — переместить, Home — вернуть в угол.")}
        onDoubleClick={reset}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, y: event.clientY, origin: positionRef.current ?? { x: 12, y: 12 } };
          event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
        }}
        onPointerMove={(event) => {
          const current = drag.current; if (!current) return;
          setBoundPosition({ x: current.origin.x + event.clientX - current.x, y: current.origin.y + event.clientY - current.y });
        }}
        onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === "Home") { event.preventDefault(); reset(); return; }
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault(); const step = event.shiftKey ? 30 : 10, current = positionRef.current ?? { x: 12, y: 12 };
          setBoundPosition({ x: current.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), y: current.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) });
        }}><GripVertical size={14} /><Map size={13} /><span>{t("Миникарта")}</span></button>
      <button type="button" className="graph-minimap-collapse" aria-expanded={expanded} aria-controls="graph-minimap-map" aria-label={t(expanded ? "Свернуть миникарту" : "Развернуть миникарту")} title={t(expanded ? "Свернуть миникарту" : "Развернуть миникарту")} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
    </div>
    {expanded ? <canvas ref={canvas} id="graph-minimap-map" className="graph-minimap-canvas" aria-label={t("Нажмите на миникарту, чтобы переместиться по графу")} style={{ width: WIDTH, height: HEIGHT }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); navigate(event); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) navigate(event); }}
      onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    /> : null}
  </aside>;
});
