// src/editor2026/blocks/whiteboard/Toolbox.tsx
//
// Плавающий glassmorphic тулбар + мини-карта для доски. Это единственный
// React-driven UI для canvas. Чтение/запись через публичный API движка,
// пикселями canvas не управляем (rAF-цикл движка рисует). React state
// намеренно минимален.
//
// МОДЕЛЬ ПЕРЕРИСОВКИ: WhiteboardCanvas (родитель) уже подключил единственный
// слот `onState` движка к своему `setTick`, поэтому всё поддерево (включая
// этот Toolbox) перерисовывается после каждого закоммиченного изменения
// движка. Мы НЕ подписываемся на onState тут (этот слот принадлежит
// родителю), просто синхронно читаем геттеры при каждой перерисовке.
// Мини-карта перерисовывается в своём троттлированном rAF, поэтому следит
// за живым паном/зумом между перерисовками React.

import {
  Circle,
  Database,
  Download,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  MoveUpRight,
  NotebookPen,
  Pencil,
  Plus,
  Redo2,
  Spline,
  Square,
  Trash2,
  Type,
  Undo2,
  Waypoints,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

import type { Bounds, Tool } from "./model";
import { WhiteboardCamera } from "./camera";
import type { WhiteboardEngine } from "./engine";
import { confirmDialog } from "../../../store/confirm";
import { t } from "../../../lib/i18n";

const COLORS = [
  "#e4e4e7", // почти белый (дефолт на тёмном)
  "#818cf8", // индиго (accent приложения)
  "#34d399", // изумрудный
  "#fbbf24", // янтарный
  "#fb7185", // розовый
  "#38bdf8", // голубой
  "#a78bfa", // фиолетовый
  "#1c1917", // почти чёрный (для светлых стики)
];
const STROKES = [2, 4, 8, 14];

const TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: "select", label: "Выбор (V)", icon: <MousePointer2 size={17} /> },
  { tool: "pan", label: "Рука (H / пробел)", icon: <Hand size={17} /> },
  { tool: "pen", label: "Карандаш (P)", icon: <Pencil size={17} /> },
  { tool: "rect", label: "Прямоугольник (R)", icon: <Square size={17} /> },
  { tool: "ellipse", label: "Эллипс (O)", icon: <Circle size={17} /> },
  { tool: "arrow", label: "Стрелка (A)", icon: <MoveUpRight size={17} /> },
  { tool: "text", label: "Текст (T)", icon: <Type size={17} /> },
];

// Инструменты flowchart (стадия 2/3): ноды БД / действие / заметка + инструмент связей.
const FLOW_TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: "db", label: "База данных (B)", icon: <Database size={17} /> },
  { tool: "action", label: "Действие (G)", icon: <Workflow size={17} /> },
  { tool: "note", label: t("Заметка (N)"), icon: <NotebookPen size={17} /> },
  { tool: "link", label: "Связь (C)", icon: <Spline size={17} /> },
];

export interface ToolboxProps {
  engine: WhiteboardEngine;
  /** Экспорт доски в PNG (подключён WhiteboardCanvas через Tauri save). */
  onExport?: () => void;
  /** Есть ли на доске что-то для экспорта. Управляет disabled-состоянием
   *  кнопки Export, чтобы мы не вызывали пайплайн экспорта на пустой доске
   *  (раньше бросал посередине и показывал window.alert). */
  canExport?: boolean;
}

export function Toolbox({ engine, onExport, canExport = true }: ToolboxProps) {
  // Синхронное чтение текущего состояния движка (родитель перерисовывает
  // нас после каждого закоммиченного изменения через onState -> setTick).
  const tool = engine.getTool();
  const color = engine.getColor();
  const sw = engine.getStrokeWidth();
  const zoomPct = Math.round(engine.getZoom() * 100);
  const canUndo = engine.canUndo();
  const canRedo = engine.canRedo();
  const routing = engine.getEdgeRouting();

  const onClear = useCallback(async () => {
    // confirmDialog (не window.confirm): Tauri webview нестабилен
    // с синхронным window.confirm, иногда возвращает undefined / блокирует
    // event loop. Весь кодbase уже перешёл на асинхронный store-driven
    // диалог.
    if (
      await confirmDialog(
        "Очистить всю доску? Это можно отменить (Ctrl+Z).",
      )
    ) {
      engine.clear();
    }
  }, [engine]);

  return (
    <>
      <div className="e26-wb-toolbar" role="toolbar" aria-label="Инструменты доски">
        {/* Инструменты */}
        <div className="e26-wb-toolbar__group">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              className={
                "e26-wb-tbtn" + (tool === t.tool ? " e26-wb-tbtn--active" : "")
              }
              title={t.label}
              aria-pressed={tool === t.tool}
              onClick={() => engine.setTool(t.tool)}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <span className="e26-wb-toolbar__sep" />

        {/* Flowchart-инструменты (стадия 2/3) + переключатель routing */}
        <div className="e26-wb-toolbar__group">
          {FLOW_TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              className={
                "e26-wb-tbtn" + (tool === t.tool ? " e26-wb-tbtn--active" : "")
              }
              title={t.label}
              aria-pressed={tool === t.tool}
              onClick={() => engine.setTool(t.tool)}
            >
              {t.icon}
            </button>
          ))}
          <button
            type="button"
            className="e26-wb-tbtn"
            title={
              routing === "orthogonal"
                ? "Связи: углами (90°) -- нажмите для кривых"
                : "Связи: плавные кривые -- нажмите для углов"
            }
            aria-label="Тип связей"
            onClick={() =>
              engine.setEdgeRouting(
                routing === "orthogonal" ? "bezier" : "orthogonal",
              )
            }
          >
            {routing === "orthogonal" ? (
              <Waypoints size={17} />
            ) : (
              <Spline size={17} />
            )}
          </button>
        </div>

        <span className="e26-wb-toolbar__sep" />

        {/* Цветовые свотчи */}
        <div className="e26-wb-toolbar__group e26-wb-swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={
                "e26-wb-swatch" +
                (color.toLowerCase() === c.toLowerCase()
                  ? " e26-wb-swatch--active"
                  : "")
              }
              style={{ background: c }}
              title={c}
              aria-label={`Цвет ${c}`}
              aria-pressed={color.toLowerCase() === c.toLowerCase()}
              onClick={() => engine.setColor(c)}
            />
          ))}
        </div>

        <span className="e26-wb-toolbar__sep" />

        {/* Толщина линии */}
        <div className="e26-wb-toolbar__group e26-wb-strokes">
          {STROKES.map((n) => (
            <button
              key={n}
              type="button"
              className={
                "e26-wb-stroke" + (sw === n ? " e26-wb-stroke--active" : "")
              }
              title={`Толщина ${n}px`}
              aria-pressed={sw === n}
              onClick={() => engine.setStrokeWidth(n)}
            >
              <span
                className="e26-wb-stroke__dot"
                style={{
                  width: Math.min(18, 3 + n),
                  height: Math.min(18, 3 + n),
                }}
              />
            </button>
          ))}
        </div>

        <span className="e26-wb-toolbar__sep" />

        {/* История + очистка */}
        <div className="e26-wb-toolbar__group">
          <button
            type="button"
            className="e26-wb-tbtn"
            title={t("Отменить (Ctrl+Z)")}
            disabled={!canUndo}
            onClick={() => engine.undo()}
          >
            <Undo2 size={17} />
          </button>
          <button
            type="button"
            className="e26-wb-tbtn"
            title={t("Повторить (Ctrl+Shift+Z)")}
            disabled={!canRedo}
            onClick={() => engine.redo()}
          >
            <Redo2 size={17} />
          </button>
          <button
            type="button"
            className="e26-wb-tbtn e26-wb-tbtn--danger"
            title="Очистить доску"
            onClick={onClear}
          >
            <Trash2 size={17} />
          </button>
        </div>

        <span className="e26-wb-toolbar__sep" />

        {/* Зум */}
        <div className="e26-wb-toolbar__group e26-wb-zoom">
          <button
            type="button"
            className="e26-wb-tbtn"
            title="Уменьшить"
            onClick={() => engine.zoomOut()}
          >
            <Minus size={17} />
          </button>
          <button
            type="button"
            className="e26-wb-zoom__label"
            title="Сбросить вид (100%)"
            onClick={() => engine.resetView()}
          >
            {zoomPct}%
          </button>
          <button
            type="button"
            className="e26-wb-tbtn"
            title="Увеличить"
            onClick={() => engine.zoomIn()}
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            className="e26-wb-tbtn"
            title="Показать всё"
            onClick={() => engine.zoomToFit()}
          >
            <Maximize size={17} />
          </button>
        </div>

        <span className="e26-wb-toolbar__sep" />

        {/* Экспорт */}
        <div className="e26-wb-toolbar__group">
          <button
            type="button"
            className="e26-wb-tbtn"
            title={
              canExport
                ? t("Экспорт доски в PNG")
                : "Доска пустая -- нечего экспортировать"
            }
            onClick={onExport}
            disabled={!onExport || !canExport}
          >
            <Download size={17} />
          </button>
        </div>
      </div>

      <Minimap engine={engine} />
    </>
  );
}

// WhiteboardCanvas импортирует как DEFAULT (`import Toolbox from ...`),
// поэтому дефолт-экспорт обязателен. Named export оставлен для гибкости.
export default Toolbox;

// ──────────────────────────────────────────────────────────────────────────────
// Мини-карта (правый нижний угол). Показывает boardBounds в масштабе + прямоугольник
// текущего viewport, клик перцентрирует. Перерисовывается в своём троттлированном
// rAF (~20fps), поэтому следит за живым паном/зумом независимо от перерисовок React.
//
// Размер viewport: читаем из live whiteboard <canvas> (сиблинг под
// `.e26-wb__stage`) через DOM -- новый API движка не нужен.
//
// Перцентровка: клик по мини-карте центрирует камеру на мировой точке
// через `panToWorldCenter(wx, wy)`.
// ──────────────────────────────────────────────────────────────────────────────
const MM_W = 168;
const MM_H = 116;
const MM_PAD = 8;

function Minimap({ engine }: { engine: WhiteboardEngine }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<{ scale: number; offX: number; offY: number } | null>(
    null,
  );

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== MM_W * dpr || cv.height !== MM_H * dpr) {
      cv.width = MM_W * dpr;
      cv.height = MM_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MM_W, MM_H);

    // Читаем LIVE-рефы, БЕЗ getBoard() глубокого клонирования. Этот код
    // крутится в своём rAF мини-карты и клонировал бы каждый шейп (и каждый
    // point array карандаша) + все edges ~20 раз в секунду, нагружая GC и
    // воруя кадры у рендер-цикла. Мы только меряем bounds + камеру, поэтому
    // read-only рефы безопасны.
    const shapes = engine.getShapesReadonly();
    const cam = WhiteboardCamera.fromData(engine.getCameraData());
    const [cssW, cssH] = liveViewportSize(cv);
    const vp = cam.viewportWorldBounds(cssW, cssH);

    // Область отображения = объединение content bounds и viewport, чтобы
    // прямоугольник viewport всегда был виден (даже на пустой доске).
    // Объединение считаем за один проход через кэшированный boundsReader
    // движка (boundsCache WeakMap), поэтому карандаш с тысячами точек не
    // проходит по point array на каждом тике мини-карты. Раньше тут был
    // boardBounds() (без кэша) + silhouette-цикл ниже вызывал shapeBounds()
    // -- два сырых обхода на тик.
    let cMinX = Infinity,
      cMinY = Infinity,
      cMaxX = -Infinity,
      cMaxY = -Infinity;
    // Предвычисляем и сохраняем bounds для silhouette-цикла тоже, чтобы
    // избежать повторного кэшированного поиска на шейп (и так дёшево, но
    // бесплатно пропустить).
    const shapeBoundsList: Bounds[] = new Array(shapes.length);
    for (let i = 0; i < shapes.length; i++) {
      const b = engine.getBoundsOf(shapes[i]);
      shapeBoundsList[i] = b;
      if (b.minX < cMinX) cMinX = b.minX;
      if (b.minY < cMinY) cMinY = b.minY;
      if (b.maxX > cMaxX) cMaxX = b.maxX;
      if (b.maxY > cMaxY) cMaxY = b.maxY;
    }
    const content: Bounds | null = Number.isFinite(cMinX)
      ? { minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY }
      : null;
    let world: Bounds = content
      ? {
          minX: Math.min(content.minX, vp.minX),
          minY: Math.min(content.minY, vp.minY),
          maxX: Math.max(content.maxX, vp.maxX),
          maxY: Math.max(content.maxY, vp.maxY),
        }
      : vp;

    const padW = (world.maxX - world.minX) * 0.08 + 40;
    const padH = (world.maxY - world.minY) * 0.08 + 40;
    world = {
      minX: world.minX - padW,
      minY: world.minY - padH,
      maxX: world.maxX + padW,
      maxY: world.maxY + padH,
    };

    const ww = Math.max(1, world.maxX - world.minX);
    const wh = Math.max(1, world.maxY - world.minY);
    const innerW = MM_W - MM_PAD * 2;
    const innerH = MM_H - MM_PAD * 2;
    const scale = Math.min(innerW / ww, innerH / wh);
    const offX = MM_PAD + (innerW - ww * scale) / 2 - world.minX * scale;
    const offY = MM_PAD + (innerH - wh * scale) / 2 - world.minY * scale;
    mapRef.current = { scale, offX, offY };

    const mx = (wx: number) => wx * scale + offX;
    const my = (wy: number) => wy * scale + offY;

    // Силуэты шейпов (дешёвые залитые блоки). Переиспользуем bounds из
    // union-прохода, без пересчёта на каждый шейп.
    ctx.fillStyle = "rgba(129,140,248,0.45)";
    ctx.strokeStyle = "rgba(129,140,248,0.55)";
    ctx.lineWidth = 1;
    for (let i = 0; i < shapes.length; i++) {
      const b = shapeBoundsList[i];
      const x0 = mx(b.minX);
      const y0 = my(b.minY);
      const w = Math.max(1.5, mx(b.maxX) - x0);
      const h = Math.max(1.5, my(b.maxY) - y0);
      ctx.fillRect(x0, y0, w, h);
    }

    // Прямоугольник viewport.
    const vx = mx(vp.minX);
    const vy = my(vp.minY);
    const vw = mx(vp.maxX) - vx;
    const vh = my(vp.maxY) - vy;
    ctx.fillStyle = "rgba(165,180,252,0.10)";
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = "#a5b4fc";
    ctx.lineWidth = 1.25;
    ctx.strokeRect(vx, vy, vw, vh);
  }, [engine]);

  // Самостоятельный repaint, троттлированный до ~20fps и ограниченный
  // дешёвым change-токеном, чтобы не клонировать доску и не перерисовывать
  // когда ничего не двигается (idle = 0 работы).
  useEffect(() => {
    let raf = 0;
    let lastTs = 0;
    let lastToken = "";
    const tick = (ts: number) => {
      // Кап ~60fps, но всё ещё ограничен change-токеном, чтобы idle-доска
      // ничего не стоила. (Раньше был троттл 48ms / ~20fps, дёргано при пане.)
      if (ts - lastTs >= 15) {
        const token = engine.getViewToken();
        if (token !== lastToken) {
          lastToken = token;
          lastTs = ts;
          draw();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw, engine]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const m = mapRef.current;
      const cv = canvasRef.current;
      if (!m || !cv) return;
      const rect = cv.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const wx = (px - m.offX) / m.scale;
      const wy = (py - m.offY) / m.scale;
      engine.panToWorldCenter(wx, wy);
    },
    [engine],
  );

  return (
    <div className="e26-wb-minimap" title="Мини-карта -- клик, чтобы перейти">
      <canvas
        ref={canvasRef}
        className="e26-wb-minimap__canvas"
        style={{ width: MM_W, height: MM_H }}
        onClick={onClick}
      />
    </div>
  );
}

// Меряем live whiteboard canvas (CSS px). Настоящий <canvas.e26-wb__cv> это
// сиблинг мини-карты под `.e26-wb__stage`; fallback на window если DOM
// поменяется.
function liveViewportSize(minimapCanvas: HTMLCanvasElement): [number, number] {
  const stage = minimapCanvas.closest(".e26-wb__stage");
  const wbCanvas = stage?.querySelector<HTMLCanvasElement>("canvas.e26-wb__cv");
  if (wbCanvas) {
    const r = wbCanvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return [r.width, r.height];
  }
  if (stage) {
    const r = stage.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return [r.width, r.height];
  }
  return [window.innerWidth, window.innerHeight];
}
