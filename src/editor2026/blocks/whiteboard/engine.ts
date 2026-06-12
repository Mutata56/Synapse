// src/editor2026/blocks/whiteboard/engine.ts
//
// WhiteboardEngine , чистый JS (без React) ядро бесконечной доски. Управляет
// <canvas>, одним requestAnimationFrame-циклом с dirty flag, frustum culling,
// всем вводом (pointer/wheel/keyboard), созданием фигур под каждый инструмент,
// select/move/delete, undo/redo и debounced onChange.
//
// АРХИТЕКТУРА
//   React НИКОГДА не рисует. Всё мутабельное состояние (shapes, edges, camera,
//   tool, color, strokeWidth, selection, draft, undo/redo) живёт тут, а не в
//   React state. React только монтирует canvas, дергает императивные сеттеры и
//   рендерит хром (toolbox, minimap, text overlay, node overlay).
//
// ПЕРФОРМАНС
//   - SpatialHash: рендер и hit-test смотрят только на кандидатов из пересекающихся
//     с viewport / pointer ячеек, а не на все фигуры.
//   - Pen Path2D cache (WeakMap по immutable pen shape): smoothFreehand считается
//     ОДИН раз за штрих, а не каждый кадр.
//   - RDP-упрощение при коммите pen: freehand-штрих обрезается до опорных точек,
//     после чего bounds/hit/render быстрее.
//   - Offscreen STATIC-LAYER cache: сетка + неподвижные фигуры + неподвижные
//     рёбра рендерятся раз в offscreen bitmap (screen space) и блитятся каждый
//     кадр; перевырисовываются только перетаскиваемая фигура, её рёбра, draft и
//     хром. Инвалидируется сигнатурой (camera, structVersion, dragged-id, device
//     size), пересобирается только когда нужно.
//
// КОНТРАКТ РЕНДЕРА (что этот движок ждёт от render.ts/renderNodes.ts)
//   Фигуры/рёбра рисуются в WORLD space: перед отрисовкой движок вызывает
//   `cam.applyToCtx(ctx, dpr)` (setTransform с DPR + translate + scale), рисовальщики
//   работают в мировых координатах. Точечная сетка рисуется в DPR-only transform
//   (сама считает pan/zoom через camera).

import { WhiteboardCamera } from "./camera";
import {
  drawDotGrid,
  drawSelectionBox,
  drawShape,
  smoothFreehand,
} from "./render";
import {
  drawActionNode,
  drawAnchorHandles,
  drawDbNode,
  drawEdge,
  drawLinkDraft,
  drawLockBadge,
  drawMarquee,
  drawNoteNode,
  drawResizeHandles,
} from "./renderNodes";
import { SpatialHash, simplifyRDP } from "./spatial";
import {
  nearestAnchor,
  nearestFraction,
  pointAtFraction,
  routeBezier,
  routeOrthogonal,
  sampleCubic,
} from "./routing";
import {
  ACTION_NODE_H,
  ACTION_NODE_W,
  anchorPoint,
  boardBounds,
  clampZoom,
  DB_NODE_H,
  DB_NODE_W,
  findNode,
  hitTest,
  isNodeShape,
  NOTE_NODE_H,
  NOTE_NODE_W,
  nodeRect,
  rid,
  shapeBounds,
  translateShape,
  type AnchorSide,
  type Board,
  type Bounds,
  type Camera,
  type Edge,
  type Pt,
  type Rect,
  type Shape,
  type Tool,
} from "./model";
import type { NodeOverlayState } from "./NodeOverlay";

const DEBOUNCE_MS = 600;
const UNDO_LIMIT = 100;
const HIT_TOL_SCREEN = 6; // px погрешности, делится на zoom при hit-test
const WHEEL_ZOOM_INTENSITY = 0.0015; // ctrl/cmd+wheel, множитель зума
const ZOOM_BUTTON_FACTOR = 1.2; // кнопки +/-
const FIT_PADDING = 80; // px отступ вокруг контента для zoom-to-fit
const TEXT_DEFAULT_SIZE = 20;
const MIN_DRAG_TO_CREATE = 3; // мировых px; клик без драга создаёт rect/ellipse
const RDP_BASE_EPSILON = 0.6; // мировых единиц при zoom=1; при коммите делится на 1/zoom
// Sprite cache: фигура, чей экранный бокс превышает MAX_SPRITE_CSS (CSS px)
// по любой стороне, рисуется напрямую без кэша (пера на весь экран потребовали
// бы огромный bitmap). Всего SPRITE_CAP кэшированных спрайтов (LRU-эвикция).
const MAX_SPRITE_CSS = 1800;
const SPRITE_CAP = 900;

/** Отступ для WORLD canvas. Рендерится с cssW+2*PAD x cssH+2*PAD CSS px,
 *  чтобы маленькие паны делались дешёвым CSS translate без пиксельной работы и
 *  без полос на краях viewport. 256 покрывает комфортный ручной пан на 60fps,
 *  при этом bake-область остаётся разумной. */
const WORLD_PAD = 256;

// ── палитры по умолчанию для узлов флоучарта ──
const DB_STROKE = "#a5b4fc";
const DB_FILL = "#1f2433";
const ACTION_STROKE = "#818cf8";
const ACTION_FILL = "#1b2030";
// Заметка вместо старого sticky: тёплая "бумажная" карточка с тонкой линией.
// Текст автоматически контрастирует (тёмный на тёплом фоне) в рендерере.
const NOTE_STROKE = "rgba(0,0,0,0.22)";
const NOTE_FILL = "#fde68a";
const EDGE_SELECT_COLOR = "#c7d2fe"; // яркий индиго для выбранного коннектора
const RESIZE_HANDLE_HIT = 9; // screen-px радиус захвата ручки ресайза
const LABEL_GRAB_SCREEN = 16; // screen-px радиус захвата label-чипа рёбер
const MIN_SHAPE_SIZE = 16; // мировых единиц; ресайз не может сжать ниже
const PASTE_OFFSET = 24; // мировых единиц смещение при duplicate / paste
const DUP_OFFSET = 20;

/** Пейлоад активации для React node overlay. Переиспользует формат
 *  состояния самого overlay, чтобы контракт был единым. */
export type NodeActivateRequest = NodeOverlayState;

export interface WhiteboardEngineOpts {
  board: Board;
  onChange: (b: Board) => void;
  /** Вызывается (синхронно) когда меняется состояние, которое отображает UI:
   *  инструмент, цвет, толщина, выделение, зум, доступность undo/redo. */
  onState?: () => void;
}

/** Запрос к React text-edit overlay. `null` закрывает его. */
export interface TextEditRequest {
  id: string;
  screenX: number;
  screenY: number;
  value: string;
  fontPx: number;
  color: string;
  /** Если true, overlay рендерится как центрированный непрозрачный "чип"
   *  (label рёбер), а не прозрачный редактор на месте (для текстовых фигур). */
  chip?: boolean;
}

/** Текущий стиль основного выбранного элемента (для панели стилей). */
export interface SelectionStyle {
  fill: string | null; // null = нет заливки (pen/arrow/text)
  stroke: string | null; // цвет обводки / штриха / border
  textColor: string | null; // null = не применимо
  strokeWidth: number | null;
  opacity: number; // 0..1
}

/** Запрос на открытие контекстного меню по правому клику. `null` закрывает. */
export interface ContextMenuRequest {
  screenX: number;
  screenY: number;
  hasShapes: boolean; // есть выделенные фигуры (style/lock/duplicate)
  hasEdge: boolean; // выбран коннектор
  locked: boolean; // все выделенные залочены, меню покажет "Разблокировать"
  style: SelectionStyle; // текущие значения основного выделения
}

/** Восемь resize-ручек вокруг выбранной box-фигуры. */
type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type DragMode =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number }
  | { kind: "draw" } // freehand / черновик фигуры (данные в draft)
  // Перемещение всего выделения; clickId , фигура, по которой начали drag
  // (для схлопывания мульти-выделения в одну при клике без движения).
  | { kind: "move"; clickId: string | null; lastWorld: Pt; moved: boolean }
  | { kind: "marquee"; startWorld: Pt; cur: Pt; additive: boolean }
  | {
      kind: "resize";
      handle: HandleId;
      origBox: Bounds; // bounding box выделения в момент захвата
      orig: Shape[]; // снапшоты (разлоченных) выделенных фигур, отмасштабированные
      startWorld: Pt;
      resized: boolean;
    }
  | { kind: "labelDrag"; edgeId: string; moved: boolean } // тащим label вдоль ребра
  | { kind: "link" } // перетаскиваем коннектор от anchor узла (данные в linkDraft)

type LinkDraft = {
  fromId: string;
  fromSide: AnchorSide;
  fromPt: Pt; // мировой anchor, откуда стартует коннектор
  cur: Pt; // текущая мировая позиция pointer
};

export class WhiteboardEngine {
  // ── canvas / контекст ─────────────────────────────────────────────────
  /** OVERLAY canvas: верхний слой, размером с viewport на (0,0), ловит ВСЕ
   *  pointer-события. Весь `this.ctx` рендерит хром оверлея (выделение,
   *  marquee, draft, link, направляющая, значки lock). */
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** WORLD canvas: нижний слой, увеличен на WORLD_PAD с каждой стороны,
   *  pointer-events:none. Хранит сетку + рёбра + спрайты узлов. Пересобирается
   *  только при структурных/зум/size изменениях; при чистом пане делаем просто
   *  CSS translate (ноль пиксельной работы). */
  private worldCanvas: HTMLCanvasElement;
  private worldCtx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  // Снапшот render-состояния мира , определяет, пойдёт ли дешёвый CSS-translate
  // или полный пересбор мира.
  private worldRenderCamX = 0;
  private worldRenderCamY = 0;
  private worldRenderVersion = -1; // matches structVersion at bake time
  private worldRenderZoom = -1; // matches spriteZoom at bake time
  /** Live cam.zoom при bake мира. ОТДЕЛЬНО от worldRenderZoom, потому что
   *  world canvas рендерится с LIVE cam (спрайты блитятся), а spriteZoom
   *  дебаунсится ~130мс. Без этого, при Ctrl+Wheel zoom меняет cam.zoom
   *  каждый кадр, но spriteZoom (и needsWorldBake) не реагирует, и быстрый
   *  путь отрабатывает, а мир, собранный на СТАРОМ zoom, CSS-транслируется
   *  к новому pan. Тем временем overlay (выделение, anchors, lock badges)
   *  рисуется на НОВОМ cam, что даёт видимую рассинхронизацию. */
  private worldRenderCamZoom = -1;
  private worldRenderCssW = -1;
  private worldRenderCssH = -1;
  private worldRenderDpr = -1;

  private shapes: Shape[];
  private edges: Edge[];
  private cam: WhiteboardCamera;

  // ── эфемерное состояние инструмента ───────────────────────────────────
  private tool: Tool = "select";
  private color = "#e7e9ee";
  private strokeWidth = 2;
  // ── выделение (мульти-фигура + одно ребро) ──
  private selectedIds = new Set<string>(); // id выделенных FIGUR
  private selectedEdgeId: string | null = null; // выбранный коннектор (один)
  /** Внутренний clipboard для copy/paste (без системного, работает оффлайн). */
  private clipboard: { shapes: Shape[]; edges: Edge[] } | null = null;
  private edgeRouting: "orthogonal" | "bezier" = "orthogonal";

  // ── режим выравнивания по X/Y (нажать X/Y при выделении) ──
  // Пока активен, фантомная направляющая следует за курсором, а выделенные
  // фигуры превью-выравнивают центры по ней (X даёт общую x/вертикаль,
  // Y даёт общую y/горизонталь). Клик фиксирует, Escape отменяет.
  private alignMode: { axis: "x" | "y" } | null = null;
  private lastPointerWorld: Pt = { x: 0, y: 0 };
  /** True пока открыт React style panel / color picker, чтобы Escape handler
   *  движка не сбрасывал выделение. */
  private menuOpen = false;

  /** Рисуемая фигура (pen path, rect/ellipse/arrow draft). Ещё не в `shapes`,
   *  пока не закоммичена. Рисуется поверх каждый кадр. */
  private draft: Shape | null = null;

  // ── состояние link-инструмента ─────────────────────────────────────────
  private linkDraft: LinkDraft | null = null;
  private hoverNodeId: string | null = null;
  private hoverAnchor: AnchorSide | null = null;

  // ── undo/redo (снапшоты shapes + edges) ────────────────────────────────
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  // ── пространственный индекс + lookup map ────────────────────────────────
  private spatial = new SpatialHash();
  /** id - live shape. Пересобирается при каждом структурном изменении, обновляется
   *  in-place при движении. Даёт O(1) lookup для edge-endpoint / overlay
   *  (было O(N) findNode). */
  private shapeMap = new Map<string, Shape>();
  /** id - текущий индекс в `this.shapes`. Пересобирается при структурных
   *  изменениях (вместе с shapeMap). Позволяет `moveOne` в per-pointermove
   *  обойтись без линейного `shapes.findIndex(...)`: групповой drag M фигур
   *  падает с O(M·N) до O(M). z-order операции (bring-front и т.д.) проходят
   *  через afterMutation, который пересобирает индекс. */
  private shapeIndex = new Map<string, number>();
  /** id - live edge. Та же роль, что shapeMap для рёбер, заменяет O(E)
   *  edges.find/findIndex в per-frame и per-pointermove путях. */
  private edgeMap = new Map<string, Edge>();
  private penCache = new WeakMap<Shape, Path2D>();
  /** Замемоизированный AABB для каждой фигуры. Фигуры иммутабельны (любое
   *  изменение создаёт новый объект), поэтому WeakMap по identity не устаревает
   *  и shapeBounds() не пересчитывает points-массив длинного pen каждый кадр. */
  private boundsCache = new WeakMap<Shape, Bounds>();

  // ── кэш спрайтов на каждую фигуру ─────────────────────────────────────
  // Каждая видимая фигура рендерится ОДИН раз в маленький offscreen bitmap на
  // `spriteZoom`, а PAN делается блитами drawImage на новые позиции, без
  // перерисовки нод / measureText / pen splining каждый кадр.
  // Мутация/перемещение фигуры создаёт НОВЫЙ объект (identity change), кэш
  // промахивается, спрайт пересобирается. При ZOOM блитаем существующие
  // спрайты СКАЛИРОВАННЫМИ (гладко, но мягко) и пересобираем чётко когда
  // зум стабилизируется.
  private sprites = new Map<string, Sprite>();
  /** Content-hash атлас. Несколько экземпляров с одинаковым (type|w|h|
   *  fill|color|sw|opacity|text/title/label|zoom) делят ОДИН bitmap.
   *  Референс-счёт через Sprite.atlasKey. Записи удаляются когда последний
   *  референс уходит (mutate/evict/prune). */
  private atlas = new Map<string, AtlasEntry>();
  private spriteZoom = -1; // zoom на котором собраны спрайты (-1 = ещё нет)
  private resharpenTimer: ReturnType<typeof setTimeout> | null = null;
  private frameCounter = 0;
  /** Инкрементируется при каждом СТРУКТУРНОМ изменении (add/remove/edit/undo/redo/clear).
   *  Питает дешёвый change-token миникарты, чтобы она не клонировалась и не
   *  перерисовывалась в idle. */
  private structVersion = 0;
  /** Счётчик залоченных фигур, поддерживается рядом с rebuildSpatial. Позволяет
   *  overlay в per-frame пропустить spatial-запрос для lock-badge, когда ничего
   *  не залочено (обычный случай). */
  private lockedCount = 0;

  private drag: DragMode = { kind: "none" };
  private spaceDown = false;
  private activePointerId: number | null = null;
  private downWorld: Pt = { x: 0, y: 0 }; // позиция pointer-down в мировых координатах
  /** Кэш canvas client rect. getBoundingClientRect() форсирует layout и
   *  раньше вызывался из `localPoint` на КАЖДОМ pointermove. С мышками
   *  1000-8000 Hz это layout thrash. Сбрасывается при resize. */
  private _rectCache: DOMRect | null = null;
  /** Последний pointermove event, ждущий обработки. rAF-gate: нативный
   *  listener просто сохраняет event и ставит dirty; реальная работа раз
   *  за отображённый кадр в начале rAF тика. В паре с кэшированным rect
   *  даёт ноль работы и ноль layout flush на высокочастотных событиях. */
  private pendingPointerMove: PointerEvent | null = null;

  private dirty = true;
  private rafId = 0;
  private destroyed = false;

  // ── scratch-буферы на каждый кадр (чтобы не мусорить на pan/zoom горячем пути) ──
  /** Переиспользуемый Set для visibility-запроса, чтобы spatial.queryBounds не
   *  аллоцировал свежий Set + add для каждого id на каждый кадр. Общается между
   *  world-bake и overlay lock-badge запросами, безопасно потому что они не
   *  запускаются параллельно (один render() = один renderWorld + один renderOverlay). */
  private _visibleScratch: Set<string> = new Set();
  /** True пока в microtask стоит emitState, схлопывает вспышки selection/tool/
   *  mutation изменений в один рендер Toolbox за таск. */
  private emitScheduled = false;

  private onChange: (b: Board) => void;
  private onState?: () => void;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Handshake для text-edit с React overlay (ставится WhiteboardCanvas). */
  public onTextEdit?: (req: TextEditRequest | null) => void;
  /** Handshake для node-overlay с React overlay (ставится WhiteboardCanvas).
   *  Вызывается чтобы открыть SQL / action / note editor для узла. */
  public onNodeActivate?: (req: NodeActivateRequest) => void;
  /** Handshake для контекстного меню по правому клику (ставится WhiteboardCanvas).
   *  `null` закрывает. */
  public onContextRequest?: (req: ContextMenuRequest | null) => void;

  // ── трекинг открытых overlay (чтобы следовали за камерой при pan/zoom) ────
  /** Id фигуры (или draft) с открытым canvas text overlay, иначе null. */
  private editingTextId: string | null = null;
  /** Id ребра, чей label редактируется через text overlay, иначе null. */
  private editingEdgeId: string | null = null;
  /** Id узла с открытым React node-overlay, иначе null. */
  private activeNodeOverlayId: string | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    worldCanvas: HTMLCanvasElement,
    opts: WhiteboardEngineOpts,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("WhiteboardEngine: 2D context unavailable");
    this.ctx = ctx;
    this.worldCanvas = worldCanvas;
    const wctx = worldCanvas.getContext("2d", { alpha: true });
    if (!wctx) throw new Error("WhiteboardEngine: 2D context unavailable (world)");
    this.worldCtx = wctx;

    this.shapes = opts.board.shapes.map(cloneShape);
    // Убираем битые рёбра (конечный узел удалён), чтобы не пытаться
    // роутить от несуществующего ноды.
    this.edges = (opts.board.edges ?? [])
      .map(cloneEdge)
      .filter(
        (e) => findNode(this.shapes, e.from) && findNode(this.shapes, e.to),
      );
    this.cam = WhiteboardCamera.fromData(opts.board.camera);
    this.onChange = opts.onChange;
    this.onState = opts.onState;

    this.rebuildSpatial();
    this.attachListeners();
    this.resize();
    this.rafId = requestAnimationFrame(this.frame);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Жизненный цикл
  // ──────────────────────────────────────────────────────────────────────

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.detachListeners();
    if (this.changeTimer !== null) {
      clearTimeout(this.changeTimer);
      this.changeTimer = null;
    }
    if (this.resharpenTimer !== null) {
      clearTimeout(this.resharpenTimer);
      this.resharpenTimer = null;
    }
    this.sprites.clear();
    this.atlas.clear(); // все биндинги убиты, ссылок на atlas entry больше нет
  }

  /** Перечитать CSS box + devicePixelRatio элемента и пересоздать backing store.
   *  Вызывается из ResizeObserver и при смене DPR. */
  resize(): void {
    // Сброс кэшированного pointer-rect , элемент только что изменил размер.
    this._rectCache = null;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));

    const dprChanged = this.dpr !== dpr;
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;

    // Overlay (viewport-sized, на (0,0))
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }

    // Мировой слой: увеличен на WORLD_PAD с каждой стороны, позиционирован на
    // (-PAD, -PAD), чтобы при CSS translate для pan viewport оставался покрытым
    // на ±PAD без полос.
    const wCssW = cssW + 2 * WORLD_PAD;
    const wCssH = cssH + 2 * WORLD_PAD;
    const wBw = Math.max(1, Math.round(wCssW * dpr));
    const wBh = Math.max(1, Math.round(wCssH * dpr));
    if (this.worldCanvas.width !== wBw || this.worldCanvas.height !== wBh) {
      this.worldCanvas.width = wBw;
      this.worldCanvas.height = wBh;
    }
    this.worldCanvas.style.width = `${wCssW}px`;
    this.worldCanvas.style.height = `${wCssH}px`;
    this.worldCanvas.style.left = `${-WORLD_PAD}px`;
    this.worldCanvas.style.top = `${-WORLD_PAD}px`;
    this.worldCanvas.style.transform = ""; // in-flight pan translate устарел

    // Спрайты собраны на текущем DPR движка; только смена DPR делает их
    // устаревшими. Чистый resize CSS box (тайнинг сайдбара, ресайз без смены
    // монитора) DPR не трогает , кэш спрайтов + атлас остаются, пересобирается
    // только мир на следующем кадре (дёшево с кэшированными спрайтами).
    if (dprChanged) {
      this.sprites.clear();
      this.atlas.clear();
    }
    // Форсируем пересбор мира на следующем кадре.
    this.worldRenderVersion = -1;
    this.markDirty();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Инструмент / стиль, геттеры и сеттеры
  // ──────────────────────────────────────────────────────────────────────

  setTool(t: Tool): void {
    if (this.tool === t) return;
    this.tool = t;
    // При выходе из select сбрасываем выделение, чтобы рамка пропала.
    if (t !== "select") this.clearSelection();
    // При выходе из link сбрасываем link-состояние.
    this.linkDraft = null;
    this.hoverNodeId = null;
    this.hoverAnchor = null;
    this.alignMode = null;
    this.cancelDraft();
    this.markDirty();
    this.emitState();
  }
  getTool(): Tool {
    return this.tool;
  }

  setColor(c: string): void {
    if (this.color === c) return;
    this.color = c;
    this.emitState();
  }
  getColor(): string {
    return this.color;
  }

  setStrokeWidth(n: number): void {
    const v = Math.max(1, Math.min(64, n));
    if (this.strokeWidth === v) return;
    this.strokeWidth = v;
    this.emitState();
  }
  getStrokeWidth(): number {
    return this.strokeWidth;
  }

  /** Стиль коннектора для НОВЫХ рёбер; также пересчитывает все существующие,
   *  чтобы тогл сразу менял вид всей диаграммы (per-edge выделения нет). */
  setEdgeRouting(r: "orthogonal" | "bezier"): void {
    this.edgeRouting = r;
    let changed = false;
    for (const e of this.edges) {
      if (e.routing !== r) {
        e.routing = r;
        changed = true;
      }
    }
    if (changed) {
      this.structVersion++; // рёбра в статическом слое когда idle
      this.scheduleChange();
    }
    this.markDirty();
    this.emitState();
  }
  getEdgeRouting(): "orthogonal" | "bezier" {
    return this.edgeRouting;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Отмена / повтор / очистка
  // ──────────────────────────────────────────────────────────────────────

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    if (this.redoStack.length > UNDO_LIMIT) this.redoStack.shift();
    this.restore(this.undoStack.pop()!);
    this.afterMutation();
  }

  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.restore(this.redoStack.pop()!);
    this.afterMutation();
  }

  clear(): void {
    if (!this.shapes.length && !this.edges.length) return;
    this.pushUndo();
    this.shapes = [];
    this.edges = [];
    this.clearSelection();
    this.cancelDraft();
    this.afterMutation();
  }

  private clearSelection(): void {
    this.selectedIds.clear();
    this.selectedEdgeId = null;
    this.alignMode = null;
  }
  private selectSingle(id: string): void {
    this.selectedIds = new Set([id]);
    this.selectedEdgeId = null;
  }
  private hasSelection(): boolean {
    return this.selectedIds.size > 0 || this.selectedEdgeId !== null;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Зум / вид
  // ──────────────────────────────────────────────────────────────────────

  zoomIn(): void {
    this.cam.zoomToPoint(ZOOM_BUTTON_FACTOR, this.cssW / 2, this.cssH / 2);
    this.afterCameraChange();
  }
  zoomOut(): void {
    this.cam.zoomToPoint(1 / ZOOM_BUTTON_FACTOR, this.cssW / 2, this.cssH / 2);
    this.afterCameraChange();
  }

  resetView(): void {
    this.cam.x = 0;
    this.cam.y = 0;
    this.cam.zoom = 1;
    this.afterCameraChange();
  }

  zoomToFit(): void {
    const b = boardBounds(this.shapes);
    if (!b) {
      this.resetView();
      return;
    }
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const availW = Math.max(1, this.cssW - FIT_PADDING * 2);
    const availH = Math.max(1, this.cssH - FIT_PADDING * 2);
    const raw = Math.min(availW / bw, availH / bh);
    const zoom = clampZoom(Number.isFinite(raw) && raw > 0 ? raw : 1);

    // Центрируем контент в viewport.
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.cam.zoom = zoom;
    this.cam.x = this.cssW / 2 - cx * zoom;
    this.cam.y = this.cssH / 2 - cy * zoom;
    this.afterCameraChange();
  }

  getZoom(): number {
    return this.cam.zoom;
  }

  /** Перецентрировать viewport на мировую точку, сохраняя текущий зум.
   *  Используется кликом на миникарту. */
  panToWorldCenter(wx: number, wy: number): void {
    this.cam.x = this.cssW / 2 - wx * this.cam.zoom;
    this.cam.y = this.cssH / 2 - wy * this.cam.zoom;
    this.afterCameraChange();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Board / доступ к выделению
  // ──────────────────────────────────────────────────────────────────────

  getBoard(): Board {
    return {
      shapes: this.shapes.map(cloneShape),
      edges: this.edges.map(cloneEdge),
      camera: this.cam.toData(),
    };
  }

  getSelectedId(): string | null {
    return this.selectedIds.size === 1
      ? this.selectedIds.values().next().value ?? null
      : null;
  }

  // ── аллокация-свободные рид-аксессоры для миникарты (без клонирования) ────

  /** Снапшот камеры (простые данные, дёшево). */
  getCameraData(): Camera {
    return this.cam.toData();
  }
  /** Массив live shapes , ТОЛЬКО ЧТЕНИЕ. Миникарта только меряет bounds. */
  getShapesReadonly(): readonly Shape[] {
    return this.shapes;
  }
  /** Дешёвый токен, меняется когда миникарта может измениться
   *  (структура или камера). Миникарта пропускает клонирование и repaint
   *  когда ничего не двигалось. */
  getViewToken(): string {
    return `${this.structVersion}|${this.cam.x}|${this.cam.y}|${this.cam.zoom}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Редактирование данных узла (вызывается React node overlay при коммите)
  // ──────────────────────────────────────────────────────────────────────

  /** Применить патч от node overlay (SQL/title для db, label для action,
   *  text для note). Пишут только поля, присутствующие в `patch`. */
  updateNodeData(
    id: string,
    patch: { title?: string; query?: string; label?: string; text?: string },
  ): void {
    const idx = this.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const s = this.shapes[idx];
    let next: Shape;
    let changed = false;
    if (s.type === "db") {
      const title = patch.title ?? s.title;
      const query = patch.query ?? s.query;
      changed = title !== s.title || query !== s.query;
      next = { ...s, title, query };
    } else if (s.type === "action") {
      const label = patch.label ?? s.label;
      changed = label !== s.label;
      next = { ...s, label };
    } else if (s.type === "note") {
      const text = patch.text ?? s.text;
      changed = text !== s.text;
      next = { ...s, text };
    } else {
      return; // не нода
    }
    if (!changed) return;
    this.pushUndo();
    this.shapes[idx] = next;
    this.afterMutation();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Text-edit handshake (вызывается React overlay при коммите)
  // ──────────────────────────────────────────────────────────────────────

  commitText(id: string, value: string): void {
    // Edge-label edit (двойной клик на коннекторе) тоже попадает сюда.
    if (this.editingEdgeId !== null && id === this.editingEdgeId) {
      this.commitEdgeLabel(id, value);
      this.closeTextEdit();
      return;
    }

    const idx = this.shapes.findIndex((s) => s.id === id);
    const trimmed = value;
    if (idx === -1) {
      // Была свежесозданная фигура, живущая только в draft.
      if (this.draft && this.draft.id === id) {
        if (hasText(trimmed)) {
          this.pushUndo();
          const committed = setShapeText(this.draft, trimmed);
          this.shapes.push(committed);
          this.draft = null;
          this.selectSingle(committed.id);
          this.afterMutation();
        } else {
          // Пустой текст - отменяем.
          this.cancelDraft();
          this.markDirty();
        }
      }
      this.closeTextEdit();
      return;
    }

    const existing = this.shapes[idx];
    if (!hasTextField(existing)) {
      this.closeTextEdit();
      return;
    }

    if (!hasText(trimmed) && existing.type === "text") {
      // Пустая текстовая фигура , удаляем.
      this.pushUndo();
      this.shapes.splice(idx, 1);
      this.selectedIds.delete(id);
      this.afterMutation();
    } else if (existing.text !== trimmed) {
      this.pushUndo();
      this.shapes[idx] = setShapeText(existing, trimmed);
      this.afterMutation();
    }
    this.closeTextEdit();
  }

  /** Установить/очистить label ребра (коммит из text overlay). */
  private commitEdgeLabel(id: string, value: string): void {
    const idx = this.edges.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const label = value.trim();
    if ((this.edges[idx].label ?? "") === label) return;
    this.pushUndo();
    this.edges[idx] = { ...this.edges[idx], label: label || undefined };
    this.afterMutation();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Цикл rAF
  // ──────────────────────────────────────────────────────────────────────

  private frame = (): void => {
    if (this.destroyed) return;
    // Обработать queued pointermove ДО рендера, чтобы кадр отражал
    // последнее состояние pointer за один проход. drainPendingPointer
    // ничего не делает если нет queued event (idle кадры).
    this.drainPendingPointer();
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  private markDirty(): void {
    this.dirty = true;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Рендеринг (кэш спрайтов + culling + live chrome)
  //
  //  Порядок слоёв: сетка (screen space) -> рёбра ПОД нодами (world space) ->
  //  спрайты фигур блитятся (device space) -> draft + выделение + link chrome
  //  (world space). Прозрачный padding спрайта узла даёт ребру быть видимым,
  //  а непрозрачный body прячет коннектор под собой.
  // ──────────────────────────────────────────────────────────────────────

  /** Оркестратор: решает, нужен ли миру полный пересбор (изменилась
   *  структура/зум/размер, пан превысил WORLD_PAD, идёт drag/draft) или
   *  можно обойтись CSS-translate (дешёвый чисто-pan путь). Всегда
   *  перерисовывает overlay слой (выделение / draft / marquee / link /
   *  align guide / lock badges , это per-frame хром). */
  private render(): void {
    this.frameCounter++;
    const cam = this.cam;
    const z = cam.zoom;
    if (this.spriteZoom < 0) this.spriteZoom = z; // первый кадр на live zoom
    const zoomMismatch = Math.abs(z - this.spriteZoom) > 1e-6;

    // То, что мутирует WORLD-содержимое per frame и требует пересбора
    // мира каждый кадр, пока активно. NOTE: `draft` тут НЕ фигурирует:
    // превью draft рисуется в OVERLAY слое (renderOverlay) на live cam,
    // добавление pen-point или расширение rect не пересобирает весь мир
    // (сетка + рёбра + 200 спрайтов) ради одного штриха. Draft коммитится
    // в мир через commitDraft -> afterMutation -> structVersion bump,
    // что запускает полный bake ровно один раз. Результат для юзера
    // такой же.
    const liveWorldChanging =
      this.drag.kind === "move" ||
      this.drag.kind === "resize" ||
      this.drag.kind === "labelDrag" ||
      this.alignMode !== null;

    const dx = cam.x - this.worldRenderCamX;
    const dy = cam.y - this.worldRenderCamY;

    const needsWorldBake =
      this.worldRenderVersion !== this.structVersion ||
      this.worldRenderZoom !== this.spriteZoom ||
      this.worldRenderCamZoom !== cam.zoom || // фикс рассинхронизации wheel-zoom
      this.worldRenderCssW !== this.cssW ||
      this.worldRenderCssH !== this.cssH ||
      this.worldRenderDpr !== this.dpr ||
      Math.abs(dx) > WORLD_PAD ||
      Math.abs(dy) > WORLD_PAD ||
      liveWorldChanging;

    // Нужно ли привязать overlay cam к тому же integer-px delta, что мы
    // применили к world canvas при быстром пути. Без этого, яркая подсветка
    // выбранного ребра (overlay, float cam) и тусклый baked край (world,
    // integer-rounded CSS translate) рассинхронизируются на до 0.5 CSS px,
    // что даёт видимую двойную линию / бахрому вдоль коннектора при пане.
    let overlaySnapDx = 0;
    let overlaySnapDy = 0;
    if (needsWorldBake) {
      this.renderWorld();
      this.worldRenderVersion = this.structVersion;
      this.worldRenderZoom = this.spriteZoom;
      this.worldRenderCamZoom = cam.zoom;
      this.worldRenderCssW = this.cssW;
      this.worldRenderCssH = this.cssH;
      this.worldRenderDpr = this.dpr;
      this.worldRenderCamX = cam.x;
      this.worldRenderCamY = cam.y;
      // Снапшот совпадает с live viewport на (0,0) , сбрасываем
      // предыдущий CSS translate.
      if (this.worldCanvas.style.transform !== "") {
        this.worldCanvas.style.transform = "";
      }
    } else {
      // Быстрый путь: дешёвый CSS-translate элемента world canvas.
      // WORLD_PAD отступ даёт маленьким панам не обнажать полосы.
      // Округляем до целых px, чтобы композитор шёл по GPU-only пути
      // (subpixel translate триггерит software-blurred растеризацию).
      const rdx = Math.round(dx);
      const rdy = Math.round(dy);
      this.worldCanvas.style.transform = `translate(${rdx}px, ${rdy}px)`;
      // Привязываем integer snap к overlay, чтобы per-frame хром (выделение
      // ребра, рамки выделения, lock badges) точно совпадал с baked миром.
      // См. WB-003.
      overlaySnapDx = rdx - dx;
      overlaySnapDy = rdy - dy;
    }

    this.renderOverlay(overlaySnapDx, overlaySnapDy);

    if (zoomMismatch) this.scheduleResharpen();
    if (this.sprites.size > SPRITE_CAP) this.evictSprites();
  }

  /** Рисует сетку + рёбра + спрайты узлов в WORLD canvas. Мир увеличен
   *  на WORLD_PAD с каждой стороны; временная `worldCam` сдвинута на (PAD, PAD),
   *  чтобы мировая точка (0,0) live viewport попадала в (PAD, PAD) world canvas.
   *  Дальнейшие пан-только кадры просто CSS-translate canvas без пиксельной
   *  работы.
   *
   *  Также обрабатывает очередь re-bake для устаревших по зуму спрайтов
   *  (вместо per-frame планирования) , обе операции bake, логично свести
   *  их вместе внутри bake-пути. */
  private renderWorld(): void {
    const wctx = this.worldCtx;
    const { dpr, cam } = this;
    const worldCanvasCssW = this.cssW + 2 * WORLD_PAD;
    const worldCanvasCssH = this.cssH + 2 * WORLD_PAD;

    // Очистить world canvas (device space).
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.clearRect(0, 0, this.worldCanvas.width, this.worldCanvas.height);

    // Сдвинутая камера, чтобы live viewport (0,0) рендерились в world canvas (PAD, PAD).
    const worldCam = new WhiteboardCamera(
      cam.x + WORLD_PAD,
      cam.y + WORLD_PAD,
      cam.zoom,
    );

    // Сетка в screen space, через SHIFTED cam и EXPANDED размер viewport.
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDotGrid(wctx, worldCam, worldCanvasCssW, worldCanvasCssH, dpr);

    // Расширенный viewport в мировых координатах (рендерим и PAD-отступ тоже).
    const view = worldCam.viewportWorldBounds(worldCanvasCssW, worldCanvasCssH);

    // Рёбра
    worldCam.applyToCtx(wctx, dpr);
    this.drawEdges(wctx, worldCam, view);

    // Фигуры: spatial-cull + blit
    const useIndex =
      this.spatial.queryCellCount(view) <= Math.max(256, this.shapes.length * 4);
    let visible: Set<string> | null = null;
    if (useIndex) {
      this.spatial.queryBoundsInto(view, this._visibleScratch);
      visible = this._visibleScratch;
    }
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    const align = this.alignMode;
    type StaleEntry = { shape: Shape; bounds: Bounds; area: number };
    const stale: StaleEntry[] = [];
    const z = cam.zoom;
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      if (visible && !visible.has(s.id)) continue;
      const b = this.boundsOf(s);
      if (!boundsIntersect(b, view)) continue;
      // X/Y align превью (выделенные фигуры следуют за направляющей).
      let odx = 0;
      let ody = 0;
      if (align && this.selectedIds.has(s.id) && !s.locked) {
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        if (align.axis === "x") odx = this.lastPointerWorld.x - cx;
        else ody = this.lastPointerWorld.y - cy;
      }
      this.blitShape(wctx, worldCam, s, b, z, odx, ody);
      // Флаг stale-zoom для очереди time-sliced re-bake.
      const spr = this.sprites.get(s.id);
      if (
        spr &&
        spr.staleZoom &&
        spr.zoom !== this.spriteZoom &&
        this.drag.kind === "none"
      ) {
        stale.push({
          shape: s,
          bounds: b,
          area: (b.maxX - b.minX) * (b.maxY - b.minY),
        });
      }
    }

    // Draft тут намеренно не рисуем, это per-frame хром на overlay слое
    // (см. renderOverlay), чтобы pen-сэмплы не пересобирали весь мир.
    // При commitDraft фигура уходит в this.shapes и следующий bake мира
    // (через structVersion bump) отрисовывает её по-настоящему.

    // Обрабатываем stale-zoom re-bake под дедлайном 3мс. Сначала крупные
    // видимые зубцы. markDirty если остались, но since пересбор мира
    // запускается только когда needsWorldBake true, надо ещё и форсировать
    // needsWorldBake на следующем кадре. Бампать ничего структурного не получится;
    // проще не обновлять worldRenderZoom для этого снапшота, тогда следующий
    // кадр увидит zoom mismatch и пересоберёт. Ещё проще: пересбор спрайтов
    // редок (только после zoom-settle). Просто делаем их инлайн тут под более
    // длинный дедлайн.
    if (stale.length > 0) {
      stale.sort((a, b) => b.area - a.area);
      const deadline = performance.now() + 3;
      let drained = 0;
      while (drained < stale.length && performance.now() < deadline) {
        const ent = stale[drained++];
        const baked = this.renderSprite(ent.shape, ent.bounds, this.spriteZoom);
        if (baked) {
          const old = this.sprites.get(ent.shape.id);
          if (old) this.releaseAtlasEntry(old.atlasKey);
          this.sprites.set(ent.shape.id, baked);
        }
      }
      if (drained < stale.length) {
        // Остались stale спрайты. markDirty одного не хватит: после
        // renderWorld вызывающий ставит worldRenderZoom = spriteZoom, и
        // следующий кадр увидит "zoom OK" и ПРОПУСТИТ bake, оставив stale
        // спрайты навсегда мягкими. Сбрасываем sentinel, чтобы следующий
        // кадр форсировал ещё один bake.
        this.worldRenderZoom = -1;
        this.markDirty();
      }
    }
  }

  /** Рисует per-frame хром на OVERLAY canvas: рамки выделения,
   *  marquee, link, align guide, lock badges, подсветка выбранного ребра.
   *  Дёшево, обычно рисовать нечего. Использует LIVE cam, чтобы выделение
   *  плавно следовало за курсором даже на pure-pan кадрах, когда мир
   *  просто CSS-translated.
   *
   *  `snapDx/snapDy` это остаточный sub-pixel offset между LIVE cam и
   *  integer-px CSS-translate, применённым к world canvas при быстром пути;
   *  добавляем к overlay cam, чтобы яркая подсветка выбранного ребра точно
   *  совпадала с тусклым baked краем под ней (иначе при пане видна двойная
   *  линия). На bake-кадрах равен нулю. */
  private renderOverlay(snapDx: number, snapDy: number): void {
    const { ctx, dpr } = this;
    // Собрать snapped cam (со сдвигом на тот же остаток, что CSS translate
    // world canvas округлил).
    const cam =
      snapDx === 0 && snapDy === 0
        ? this.cam
        : new WhiteboardCamera(this.cam.x + snapDx, this.cam.y + snapDy, this.cam.zoom);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    cam.applyToCtx(ctx, dpr);

    // Превью draft (pen / rect / ellipse / arrow / text). На overlay слое,
    // чтобы каждый pointer-сэмпл обновлялся без пересбора сетки + рёбер +
    // каждого спрайта. long pen stroke раньше перерисовывал весь мир per sample.
    // `false` для флага cache потому что points/размеры draft меняются
    // каждый кадр; мемоизированный Path2D никогда бы не обновился.
    if (this.draft) {
      this.drawShapeFast(ctx, this.draft, cam, false);
    }

    // Выбранный коннектор: яркая подсветка поверх его world counterpart.
    if (this.selectedEdgeId !== null) {
      const e = this.edgeMap.get(this.selectedEdgeId);
      if (e) {
        const a = this.shapeMap.get(e.from);
        const b = this.shapeMap.get(e.to);
        const ra = a ? nodeRect(a) : null;
        const rb = b ? nodeRect(b) : null;
        if (ra && rb) {
          drawEdge(ctx, { ...e, color: EDGE_SELECT_COLOR }, ra, rb, cam);
        }
      }
    }

    // Рамки выделения + групповые resize-ручки. Скрыты во время align,
    // чтобы превью движения было читаемым.
    if (this.selectedIds.size > 0 && !this.alignMode) {
      const multi = this.selectedIds.size > 1;
      for (const id of this.selectedIds) {
        const s = this.shapeMap.get(id);
        if (s) drawSelectionBox(ctx, this.boundsOf(s), cam, multi);
      }
      const rbox = this.selectionResizeBox();
      if (rbox) {
        if (multi) drawSelectionBox(ctx, rbox, cam, false);
        drawResizeHandles(ctx, boundsToRect(rbox), cam);
      }
    }

    // Lock badges поверх каждой видимой залоченной фигуры. Используем
    // live viewport, spatial-cull чтобы стоимость масштабировалась с
    // видимым числом залоченных, а не общим. Коротко замыкаем когда ничего
    // не залочено (обычный случай), иначе spatial query + обход всех visible id
    // каждый кадр ради пустого результата.
    if (this.lockedCount > 0) {
      const view = cam.viewportWorldBounds(this.cssW, this.cssH);
      this.spatial.queryBoundsInto(view, this._visibleScratch);
      for (const id of this._visibleScratch) {
        const s = this.shapeMap.get(id);
        if (!s || !s.locked) continue;
        const b = this.boundsOf(s);
        if (!boundsIntersect(b, view)) continue;
        drawLockBadge(ctx, b, cam);
      }
    }

    // Маркиза.
    if (this.drag.kind === "marquee") {
      drawMarquee(ctx, this.drag.startWorld, this.drag.cur, cam);
    }

    // Интерфейс инструмента link.
    if (this.tool === "link") {
      if (this.hoverNodeId) {
        const n = this.shapeMap.get(this.hoverNodeId);
        const r = n ? nodeRect(n) : null;
        if (r) drawAnchorHandles(ctx, r, cam, this.hoverAnchor);
      }
      if (this.linkDraft) {
        drawLinkDraft(ctx, this.linkDraft.fromPt, this.linkDraft.cur, cam);
      }
    }

    // Направляющая выравнивания (пунктирная линия в screen space через ось курсора).
    if (this.alignMode) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.strokeStyle = "#818cf8";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      if (this.alignMode.axis === "x") {
        const sx = cam.worldToScreen(this.lastPointerWorld.x, 0).x;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, this.cssH);
      } else {
        const sy = cam.worldToScreen(0, this.lastPointerWorld.y).y;
        ctx.moveTo(0, sy);
        ctx.lineTo(this.cssW, sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Рисует все коннекторы ПОД спрайтами нод. O(E) через id->shape map,
   *  плюс viewport AABB-cull, поэтому off-screen рёбра пропускают routing +
   *  отрисовку. Принимает целевой ctx + cam, чтобы рисовать в WORLD слой
   *  (worldCam со сдвигом WORLD_PAD) или в OVERLAY слой (live cam) для
   *  подсветки выбранного ребра. */
  private drawEdges(
    ctx: CanvasRenderingContext2D,
    cam: WhiteboardCamera,
    view: Bounds,
  ): void {
    const aligning = this.alignMode !== null;
    for (const e of this.edges) {
      const a = this.shapeMap.get(e.from);
      const b = this.shapeMap.get(e.to);
      if (!a || !b) continue;
      let ra = nodeRect(a);
      let rb = nodeRect(b);
      if (!ra || !rb) continue;
      // Дешёвый AABB cull: если оба endpoint-rect полностью за viewport,
      // коннектор не может пересечь его. Slack покрывает заглушку.
      const slack = 32;
      const aOut =
        ra.x + ra.w + slack < view.minX ||
        ra.x - slack > view.maxX ||
        ra.y + ra.h + slack < view.minY ||
        ra.y - slack > view.maxY;
      const bOut =
        rb.x + rb.w + slack < view.minX ||
        rb.x - slack > view.maxX ||
        rb.y + rb.h + slack < view.minY ||
        rb.y - slack > view.maxY;
      if (aOut && bOut) continue;
      if (aligning) {
        ra = this.alignPreviewRect(a, ra);
        rb = this.alignPreviewRect(b, rb);
      }
      drawEdge(ctx, e, ra, rb, cam);
    }
  }

  /** Rect узла, сдвинутый на live X/Y-align offset (или без изменений, если
   *  не участвует в текущем align). Сохраняет коннекторы прилипшими к превью. */
  private alignPreviewRect(s: Shape, r: Rect): Rect {
    const am = this.alignMode;
    if (!am || !this.selectedIds.has(s.id) || s.locked) return r;
    const b = this.boundsOf(s);
    if (am.axis === "x") {
      const cx = (b.minX + b.maxX) / 2;
      return { ...r, x: r.x + (this.lastPointerWorld.x - cx) };
    }
    const cy = (b.minY + b.maxY) / 2;
    return { ...r, y: r.y + (this.lastPointerWorld.y - cy) };
  }

  /**
   * Блит одну фигуру из кэшированного спрайта (device space). Спрайт собран на
   * `spriteZoom`; на текущем зуме `z` рисуем с масштабом `z/spriteZoom`
   * (это 1 при pan, чёткий 1:1 blit). Огромные / вырожденные фигуры
   * идут в обход кэша напрямую (пера на весь экран потребовали бы огромный
   * bitmap) (в памяти).
   */
  private blitShape(
    ctx: CanvasRenderingContext2D,
    cam: WhiteboardCamera, // целевая камера (live cam для overlay,
                            // worldCam со сдвигом WORLD_PAD для мира)
    s: Shape,
    b: Bounds,
    z: number,
    dx = 0, // мировой preview offset (X/Y align), обычно 0
    dy = 0,
  ): void {
    const screenW = (b.maxX - b.minX) * z;
    const screenH = (b.maxY - b.minY) * z;
    if (
      screenW > MAX_SPRITE_CSS ||
      screenH > MAX_SPRITE_CSS ||
      screenW < 0.5 ||
      screenH < 0.5
    ) {
      // Прямая отрисовка в world space (+ опциональный preview offset), затем.restore.
      ctx.save();
      cam.applyToCtx(ctx, this.dpr);
      if (dx || dy) ctx.translate(dx, dy);
      if (s.opacity != null && s.opacity < 1) {
        ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
      }
      this.drawShapeFast(ctx, s, cam, true);
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    const Z = this.spriteZoom;
    let spr = this.sprites.get(s.id);
    // Промах идентичности (спрайта ещё нет, или фигура мутировала) -> MUST
    // пересобрать сейчас, иначе рисуем устаревшую геометрию. Zoom mismatch
    // сам по себе уже не промах: блитаем существующий bitmap с масштабом
    // (см. ниже) и time-sliced re-bake loop в render() обновляет за несколько
    // кадров.
    if (!spr || spr.shape !== s) {
      const baked = this.renderSprite(s, b, Z);
      if (!baked) {
        // Не удалось выделить ctx для спрайта, фолбэк на прямую отрисовку.
        // MUST использовать переданный cam, НЕ this.cam: при вызове из
        // renderWorld() с worldCam (со сдвигом WORLD_PAD), this.cam нарисует
        // фигуру на (0,0)-origin world canvas, что даст сдвиг -PAD CSS px
        // относительно соседних успешно собранных спрайтов.
        ctx.save();
        cam.applyToCtx(ctx, this.dpr);
        if (dx || dy) ctx.translate(dx, dy);
        if (s.opacity != null && s.opacity < 1) {
          ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
        }
        this.drawShapeFast(ctx, s, cam, true);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return;
      }
      // Освобождаем ссылку на atlas старого биндинга (если была) ДО записи,
      // иначе refCount atlas entry навсегда останется завышенным.
      if (spr) this.releaseAtlasEntry(spr.atlasKey);
      spr = baked;
      this.sprites.set(s.id, spr);
    }
    spr.used = this.frameCounter;

    // Используем TARGET камеру (worldCam при bake мира, liveCam если блитим
    // в overlay). Результат в координатах целевого canvas, включая PAD offset
    // в worldCam.
    const scr = cam.worldToScreen(spr.ox + dx, spr.oy + dy);
    const scale = z / spr.zoom;
    ctx.drawImage(
      spr.canvas,
      scr.x * this.dpr,
      scr.y * this.dpr,
      spr.canvas.width * scale,
      spr.canvas.height * scale,
    );
  }

  /** Визуальный отпечаток для шаринга одного bake bitmap между несколькими
   *  экземплярами. Возвращает null для типов фигур, где экземпляры вряд ли
   *  разделяют визуал (pen / rect / ellipse / arrow / text), у них уникальный
   *  bitmap на экземпляр. Для db/action/note нод ключ включает все поля,
   *  влияющие на отрисовку (размер, fill/stroke, ширина, opacity, текст,
   *  вариант) плюс bake zoom. Два экземпляра с одинаковым визуалом -> одинаковый
   *  ключ -> ОДИН shared bitmap. */
  private visualKey(s: Shape, Z: number): string | null {
    const op = s.opacity ?? 1;
    switch (s.type) {
      case "db":
        return `db|${s.w}|${s.h}|${s.fill}|${s.color}|${s.sw}|${op}|${s.textColor ?? ""}|${s.title}|${Z}`;
      case "action":
        return `action|${s.w}|${s.h}|${s.fill}|${s.color}|${s.sw}|${op}|${s.variant}|${s.textColor ?? ""}|${s.label}|${Z}`;
      case "note":
        return `note|${s.w}|${s.h}|${s.fill}|${s.color}|${s.sw}|${op}|${s.textColor ?? ""}|${s.text}|${Z}`;
      default:
        return null; // pen / rect / ellipse / arrow / text, дедупа нет
    }
  }

  /** Уменьшает refCount атласа для `key`. Удаляет запись (освобождает canvas)
   *  когда ни один Sprite биндинг на неё не ссылается. Безопасно вызывать с
   *  null (no-op для уникальных спрайтов). */
  private releaseAtlasEntry(key: string | null): void {
    if (key === null) return;
    const entry = this.atlas.get(key);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) this.atlas.delete(key);
  }

  /** Bake фигуры в маленький offscreen bitmap при зуме `Z` (device-resolution).
   *  Атлас-осознанный: db/action/note ноды шарят один bitmap между всеми
   *  экземплярами с одинаковым визуалом; остальные типы получают уникальный.
   *  В обоих случаях bitmap позиционно-независим: временная камера компенсирует
   *  мировую позицию фигуры, поэтому нода на (1000, 1000) и идентичная на
   *  (2000, 500) дают byte-identical bitmap. Мировой origin каждого экземпляра
   *  возвращается как `ox/oy` для blit. */
  private renderSprite(s: Shape, b: Bounds, Z: number): Sprite | null {
    const sw = s.sw > 0 ? s.sw : 2;
    // Padding (CSS px) для stroke half-width bleed + Catmull-Rom overshoot на pen.
    const padCss = Math.max(6, (sw * Z) / 2 + 6) + (s.type === "pen" ? 6 : 0);
    const padWorld = padCss / Z;
    const ox = b.minX - padWorld;
    const oy = b.minY - padWorld;

    // Atlas fast path: переиспользуем shared bitmap если уже есть с тем же
    // visual key (db цилиндр с теми же w/h/fill/title/etc при этом зуме).
    const key = this.visualKey(s, Z);
    if (key !== null) {
      let entry = this.atlas.get(key);
      if (!entry) {
        const baked = this.bakeBitmap(s, b, Z, padCss, ox, oy);
        if (!baked) return null;
        entry = { canvas: baked, zoom: Z, refCount: 0 };
        this.atlas.set(key, entry);
      }
      entry.refCount++;
      return {
        canvas: entry.canvas,
        atlasKey: key,
        shape: s,
        zoom: Z,
        ox,
        oy,
        used: this.frameCounter,
        staleZoom: false,
      };
    }

    // Уникальный путь (pen/rect/ellipse/arrow/text): bake нового bitmap,
    // без атласа.
    const canvas = this.bakeBitmap(s, b, Z, padCss, ox, oy);
    if (!canvas) return null;
    return {
      canvas,
      atlasKey: null,
      shape: s,
      zoom: Z,
      ox,
      oy,
      used: this.frameCounter,
      staleZoom: false,
    };
  }

  /** Чистый bake: фигура -> offscreen bitmap, позиционно-независимый. Временный
   *  camera offset выбирается так, чтобы bounds.minX,minY фигуры попадали на
   *  pad-pixel offset на canvas. Две одинаковые фигуры в разных мировых позициях
   *  дают byte-identical output, что является условием для безопасного шаринга
   *  в атласе. */
  private bakeBitmap(
    s: Shape,
    b: Bounds,
    Z: number,
    padCss: number,
    ox: number,
    oy: number,
  ): HTMLCanvasElement | null {
    const dpr = this.dpr;
    const worldW = b.maxX - b.minX;
    const worldH = b.maxY - b.minY;
    const cssW = worldW * Z + padCss * 2;
    const cssH = worldH * Z + padCss * 2;
    const cw = Math.max(1, Math.ceil(cssW * dpr));
    const ch = Math.max(1, Math.ceil(cssH * dpr));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const sctx = canvas.getContext("2d", { alpha: true });
    if (!sctx) return null;

    const spriteCam = new WhiteboardCamera(-ox * Z, -oy * Z, Z);
    spriteCam.applyToCtx(sctx, dpr);
    if (s.opacity != null && s.opacity < 1) {
      sctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
    }
    // Передаём spriteCam чтобы coord math рисовальщика совпадал с bake camera,
    // важно когда renderNodes начнёт читать cam.x/cam.y (сегодня только .zoom,
    // поэтому this.cam случайно работало бы).
    this.drawShapeFast(sctx, s, spriteCam, false);
    return canvas;
  }

  /** Debounced чёткий re-bake после стабилизации zoom-жеста. Помечает спрайты
   *  как zoom-stale (старый bitmap продолжает блититься с масштабом, без попа)
   *  вместо очистки всей карты. Render loop дренирует re-bake очередь
   *  крупные-первые под 3мс дедлайном. Коротко замыкает когда дельта мала
   *  и scaled blit неотличим от чёткого re-bake. */
  private scheduleResharpen(): void {
    if (this.resharpenTimer !== null) clearTimeout(this.resharpenTimer);
    this.resharpenTimer = setTimeout(() => {
      this.resharpenTimer = null;
      if (this.destroyed) return;
      const z = this.cam.zoom;
      // < 15% zoom delta от bake = scaled blit выглядит идентично re-bake
      // при этом зуме на screen pixel. Пропуск шторма это чистый выигрыш.
      if (
        this.spriteZoom > 0 &&
        Math.abs(z - this.spriteZoom) / this.spriteZoom < 0.15
      ) {
        return;
      }
      this.spriteZoom = z;
      for (const spr of this.sprites.values()) spr.staleZoom = true;
      this.markDirty();
    }, 130);
  }

  /** LRU-эвикция наименее недавно блитнутых спрайтов при превышении лимита.
   *  Было: spread to array + sort + clear + re-insert, O(N log N) + ~900
   *  аллокаций каждый кадр переполнения. Теперь: один линейный проход,
   *  удаляющий `dropCount` записей с наименьшими `used` через маленький
   *  сортированный буфер. O(N * keepK) где keepK мал (~135 в худшем),
   *  ноль аллокаций в steady state, _evictBuf переиспользуется. */
  private _evictBuf: { id: string; used: number }[] = [];
  private evictSprites(): void {
    const keep = Math.floor(SPRITE_CAP * 0.85);
    const dropCount = this.sprites.size - keep;
    if (dropCount <= 0) return;
    // Собрать `dropCount` старейших записей через insertion sort фиксированного
    // размера, полная сортировка не нужна чтобы найти нижние K.
    const buf = this._evictBuf;
    buf.length = 0;
    for (const [id, spr] of this.sprites) {
      if (buf.length < dropCount) {
        // Вставляем, сохраняя буфер отсортированным ASC по `used` (старейшие первые).
        let i = buf.length - 1;
        while (i >= 0 && buf[i].used > spr.used) i--;
        buf.splice(i + 1, 0, { id, used: spr.used });
      } else if (spr.used < buf[dropCount - 1].used) {
        // Новее старейшего отслеживаемого, вытесняем его.
        let i = dropCount - 2;
        while (i >= 0 && buf[i].used > spr.used) i--;
        buf.splice(dropCount - 1, 1);
        buf.splice(i + 1, 0, { id, used: spr.used });
      }
    }
    for (const e of buf) {
      // Освободить atlas-референс (если был) перед удалением биндинга,
      // иначе refCount atlas entry утечёт навсегда и мёртвый bitmap
      // останется закреплённым.
      const spr = this.sprites.get(e.id);
      if (spr) this.releaseAtlasEntry(spr.atlasKey);
      this.sprites.delete(e.id);
    }
  }

  /** Рисует одну фигуру: pen через Path2D cache, новые flowchart ноды через
   *  renderNodes. `cache` = false для live draft (его points меняются каждый
   *  кадр, Path2D нельзя мемоизировать). */
  private drawShapeFast(
    ctx: CanvasRenderingContext2D,
    s: Shape,
    cam: WhiteboardCamera, // целевая камера (worldCam для мира со сдвигом
                            //   WORLD_PAD; this.cam для overlay / sprite bake).
                            //   Жёстко this.cam было безвредно: renderNodes
                            //   сегодня читает только cam.zoom, но latent:
                            //   любое будущее чтение cam.x/cam.y тихо нарисует
                            //   в неправильной мировой позиции на world canvas.
    cache: boolean,
  ): void {
    switch (s.type) {
      case "pen": {
        if (!s.points.length) return;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.sw;
        ctx.stroke(this.penPath(s, cache));
        ctx.restore();
        return;
      }
      case "db":
        drawDbNode(ctx, s, cam);
        return;
      case "action":
        drawActionNode(ctx, s, cam);
        return;
      case "note":
        drawNoteNode(ctx, s, cam);
        return;
      default:
        drawShape(ctx, s, cam);
    }
  }

  /** Кэшированный Catmull-Rom Path2D для закоммиченного pen-штриха; пересчитывается
   *  при каждом вызове для live draft. */
  private penPath(s: Shape & { type: "pen" }, cache: boolean): Path2D {
    if (!cache) return smoothFreehand(s.points);
    let p = this.penCache.get(s);
    if (!p) {
      p = smoothFreehand(s.points);
      this.penCache.set(s, p);
    }
    return p;
  }

  /** Мемоизированный AABB для фигуры (см. boundsCache). */
  private boundsOf(s: Shape): Bounds {
    let b = this.boundsCache.get(s);
    if (!b) {
      b = shapeBounds(s);
      this.boundsCache.set(s, b);
    }
    return b;
  }

  /** Публичный reader кэшированных bounds. Миникарта (и любой другой внешний
   *  потребитель) должен использовать это вместо сырого `shapeBounds(s)`, иначе
   *  pen-штрихи пересчитывают points на каждый тик миникарты. На 20-60fps
   *  миникарты во время pan это доминирующая стоимость на досках со множеством pen. */
  getBoundsOf(s: Shape): Bounds {
    return this.boundsOf(s);
  }

  // ── Мутации: общая инфраструктура ──────────────────────────────────────

  private snapshot(): Snapshot {
    return {
      shapes: this.shapes.map(cloneShape),
      edges: this.edges.map(cloneEdge),
    };
  }

  private restore(s: Snapshot): void {
    this.shapes = s.shapes.map(cloneShape);
    this.edges = s.edges.map(cloneEdge);
  }

  private pushUndo(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Пересобирает spatial index с нуля. Дёшево относительно пользовательского
   *  structural change; per-frame пути это не вызывают. Использует `boundsOf`
   *  (WeakMap cache) вместо сырого `shapeBounds`, поэтому длинные pen-штрихи
   *  не пересчитывают points на каждое несвязанное изменение. Кэш ключится
   *  по identity фигуры, которая меняется только для редактируемой, поэтому
   *  нетронутые фигуры попадают в O(1). */
  private rebuildSpatial(): void {
    this.spatial.rebuild(
      this.shapes.map((s) => ({ id: s.id, bounds: this.boundsOf(s) })),
    );
    this.shapeMap.clear();
    this.shapeIndex.clear();
    let locked = 0;
    for (let i = 0; i < this.shapes.length; i++) {
      this.shapeMap.set(this.shapes[i].id, this.shapes[i]);
      this.shapeIndex.set(this.shapes[i].id, i);
      if (this.shapes[i].locked) locked++;
    }
    this.lockedCount = locked;
    this.edgeMap.clear();
    for (const e of this.edges) this.edgeMap.set(e.id, e);
  }

  /** После закоммиченного shape/edge mutation: переиндексация, инвалидация
   *  кэшей, перерисовка, уведомление state, debounced save. */
  private afterMutation(): void {
    this.structVersion++;
    this.rebuildSpatial();
    // Освобождаем спрайты чьи фигуры больше не существуют (deleteSelection /
    // undo / redo / clear). Каждый спрайт либо владеет canvas, либо держит
    // atlas-референс, оба требуют освобождения, иначе память сжимается только
    // при SPRITE_CAP=900 LRU давлении. shapeMap только что пересобран, он
    // авторитетный.
    if (this.sprites.size > 0) {
      for (const [id, spr] of this.sprites) {
        if (!this.shapeMap.has(id)) {
          this.releaseAtlasEntry(spr.atlasKey);
          this.sprites.delete(id);
        }
      }
    }
    this.markDirty();
    this.emitState();
    this.scheduleChange();
  }

  /** Камера сдвинулась (pan/zoom): перерисовка + state + debounced save
   *  (камера сохраняется). Фигуры не изменились, spatial index остаётся
   *  валидным; static cache пересобирается потому что сигнатура камеры
   *  изменилась. */
  private afterCameraChange(): void {
    this.markDirty();
    this.emitState();
    this.scheduleChange();
    this.reanchorOverlays();
  }

  /** Переотправляем позиции открытых overlay, чтобы text-edit textarea и node
   *  overlay СЛЕДОВАЛИ за фигурой при pan/zoom камеры (они были закреплены
   *  один раз при открытии). Переиспользуем ТОТ ЖЕ id/kind, чтобы React не
   *  рефокусился и не сбрасывал текст, обновляем только left/top (и fontPx
   *  для текста). */
  private reanchorOverlays(): void {
    if (this.editingTextId !== null) {
      const s =
        this.shapeMap.get(this.editingTextId) ??
        (this.draft && this.draft.id === this.editingTextId ? this.draft : null);
      if (s && hasTextField(s)) this.requestTextEdit(s);
    }
    if (this.editingEdgeId !== null) {
      const e = this.edgeMap.get(this.editingEdgeId);
      if (e) this.requestEdgeLabelEdit(e);
    }
    if (this.activeNodeOverlayId !== null) {
      const n = this.shapeMap.get(this.activeNodeOverlayId);
      if (n && isNodeShape(n)) this.activateNode(n);
    }
  }

  /** Уведомляем React что состояние движка изменилось (Toolbox перечитывает
   *  tool/zoom/selection getters). Коалесцируется через microtask, поэтому
   *  вспышка selection/tool/mutation изменений в одном обработчике события
   *  сворачивается в ОДНУ перерисовку. Раньше finishMarquee (добавить
   *  много ids -> emit) или setTool (очистить selection -> emit) запускали
   *  несколько React render за жест. */
  private emitState(): void {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      if (this.destroyed) return;
      this.onState?.();
    });
  }

  private scheduleChange(): void {
    if (this.changeTimer !== null) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      if (this.destroyed) return;
      this.onChange(this.getBoard());
    }, DEBOUNCE_MS);
  }

  private cancelDraft(): void {
    if (this.draft) {
      this.draft = null;
      this.markDirty();
    }
  }

  // ── подключение событий ───────────────────────────────────────────────

  private attachListeners(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.onDblClick);
    // Keyboard глобальный И в CAPTURE phase: доска живёт в модалке чей
    // overlay останавливает keydown propagation, поэтому bubble-phase window
    // listener пропустит клавиши когда фокус попадёт внутрь модалки
    // (например после клика на toolbar кнопку). Capturing на window гарантирует
    // что hotkeys работают пока доска открыта (всё ещё no-ops при вводе текста,
    // см. isEditableTarget guard).
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  private detachListeners(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("dblclick", this.onDblClick);
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

  /** CSS-pixel позиция pointer относительно верхнего левого угла canvas. Rect
   *  кэшируется и переиспользуется (инвалидируется при resize). Без кэша
   *  getBoundingClientRect() форсировал layout flush на каждом pointermove. */
  private localPoint(e: PointerEvent | WheelEvent | MouseEvent): Pt {
    const rect =
      this._rectCache ?? (this._rectCache = this.canvas.getBoundingClientRect());
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ── pointer down ────────────────────────────────────────────────────────
  private onPointerDown = (e: PointerEvent): void => {
    // Реагируем только на primary кнопку (или среднюю для pan). Игнорируем
    // лишние touch/pen контакты пока один активен.
    if (this.activePointerId !== null) return;
    // Сбрасываем устаревшие rAF-очередные hover/move от жеста до этого,
    // иначе drainPendingPointer() в начале следующего кадра направит его
    // В новый drag (дрожь при старте move, расширение pen-draft).
    this.pendingPointerMove = null;

    const screen = this.localPoint(e);
    const world = this.cam.screenToWorld(screen.x, screen.y);
    this.downWorld = world;
    this.lastPointerWorld = world;

    // Левый клик во время align коммитит выравнивание по направляющей.
    if (this.alignMode && e.button === 0) {
      this.commitAlign();
      e.preventDefault();
      return;
    }

    const middle = e.button === 1;
    const left = e.button === 0;

    // Pan: средняя кнопка мыши, или Space+левая, или pan tool.
    if (middle || (left && this.spaceDown) || (left && this.tool === "pan")) {
      this.activePointerId = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { kind: "pan", startX: screen.x, startY: screen.y };
      e.preventDefault();
      return;
    }

    if (!left) return; // правый клик и т.д. игнорируем для рисования

    this.activePointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);

    switch (this.tool) {
      case "select":
        this.beginSelect(world, screen, e.shiftKey);
        break;
      case "pen":
        this.beginPen(world);
        break;
      case "rect":
      case "ellipse":
        this.beginBox(world);
        break;
      case "arrow":
        this.beginArrow(world);
        break;
      case "text":
        this.createText(world);
        // text это click-to-create, сразу релизим capture.
        this.releasePointer();
        break;
      case "db":
      case "action":
      case "note":
        this.createNode(this.tool, world);
        this.releasePointer();
        break;
      case "link":
        this.beginLink(world);
        if (this.drag.kind !== "link") this.releasePointer();
        break;
      case "pan":
        break; // обработано выше
    }
    e.preventDefault();
  };

  // ── pointer move ──────────────────────────────────────────────────────
  /** Нативный pointermove listener. RAF-шлюзует почти всё: мыши на 1000-8000 Hz
   *  засыпали обработчик избыточными вызовами (8-16x на отображённый кадр,
   *  каждый форсировал layout через getBoundingClientRect до кэширования,
   *  плюс полный hit-test на link-hover). Сохраняем последний event и даём
   *  rAF кадру потребить его раз. PEN DRAWING это исключение: каждый сэмпл
   *  важен для fidelity штриха, поэтому идёт синхронно. Marquee/move/resize/
   *  labelDrag/link нуждаются только в последней позиции per frame, коалесценция
   *  для них без потерь. */
  private onPointerMove = (e: PointerEvent): void => {
    // Pen drawing нуждается в каждом сэмпле (stroke fidelity), запускаем синхронно.
    if (this.drag.kind === "draw") {
      this.processPointerMove(e);
      return;
    }
    // Всё остальное: сохраняем + откладываем до следующего rAF тика.
    this.pendingPointerMove = e;
    this.markDirty();
  };

  /** Дренирует pending pointermove (если есть) раз за rAF тик. Запускается
   *  в начале кадра, чтобы следующий render() видел последнее состояние
   *  pointer за один проход. */
  private drainPendingPointer(): void {
    const e = this.pendingPointerMove;
    if (!e) return;
    this.pendingPointerMove = null;
    this.processPointerMove(e);
  }

  /** Тело обработки pointermove (вынесено чтобы rAF gate мог его вызывать).
   *  Поведение не изменилось, обёрнута только точка входа. */
  private processPointerMove(e: PointerEvent): void {
    const screen = this.localPoint(e);
    this.lastPointerWorld = this.cam.screenToWorld(screen.x, screen.y);

    // X/Y align превью следует за курсором (нужна не кнопка pointer).
    if (this.alignMode) {
      this.markDirty();
      return;
    }

    // Hover feedback (нет активного drag): только link tool нуждается, чтобы
    // подсвечивать anchor под курсором.
    if (this.activePointerId === null) {
      if (this.tool === "link") this.updateLinkHover(screen);
      return;
    }
    if (e.pointerId !== this.activePointerId) return;

    switch (this.drag.kind) {
      case "pan": {
        const dx = screen.x - this.drag.startX;
        const dy = screen.y - this.drag.startY;
        this.cam.panByScreen(dx, dy);
        this.drag.startX = screen.x;
        this.drag.startY = screen.y;
        this.markDirty();
        // NB: нет emitState() на live pan пути, pan не меняет ничего что
        // Toolbox показывает, перерисовка каждый кадр была per-frame стоимостью.
        this.reanchorOverlays();
        break;
      }
      case "move": {
        const world = this.cam.screenToWorld(screen.x, screen.y);
        const dx = world.x - this.drag.lastWorld.x;
        const dy = world.y - this.drag.lastWorld.y;
        if (dx !== 0 || dy !== 0) {
          if (!this.drag.moved) this.pushUndo(); // снапшот только при первом реальном движении
          this.applyMoveSelection(dx, dy);
          this.drag.lastWorld = world;
          this.drag.moved = true;
        }
        break;
      }
      case "marquee": {
        this.drag.cur = this.cam.screenToWorld(screen.x, screen.y);
        this.markDirty();
        break;
      }
      case "resize": {
        const world = this.cam.screenToWorld(screen.x, screen.y);
        if (
          world.x !== this.drag.startWorld.x ||
          world.y !== this.drag.startWorld.y
        ) {
          if (!this.drag.resized) this.pushUndo(); // снапшот при первом реальном resize
          this.applyResize(this.drag, world);
          this.drag.resized = true;
        }
        break;
      }
      case "labelDrag": {
        const world = this.cam.screenToWorld(screen.x, screen.y);
        const edgeId = this.drag.edgeId;
        // O(1) edge lookup через edgeMap; indexOf нужен только потому что мы
        // мутируем массив in-place ниже (сохраняя z-order). Этот drag
        // затрагивает ОДНО ребро, поэтому indexOf нормально (per-pointermove x 1).
        const e = this.edgeMap.get(edgeId);
        const idx = e ? this.edges.indexOf(e) : -1;
        if (idx !== -1 && e) {
          const a = this.shapeMap.get(e.from);
          const b = this.shapeMap.get(e.to);
          const ra = a ? nodeRect(a) : null;
          const rb = b ? nodeRect(b) : null;
          if (ra && rb) {
            if (!this.drag.moved) this.pushUndo(); // снапшот при первом реальном движении
            const t = nearestFraction(this.edgePathPoints(e, ra, rb), world);
            const next = { ...e, labelT: t };
            this.edges[idx] = next;
            this.edgeMap.set(edgeId, next); // держим map в sync с массивом
            this.drag.moved = true;
            this.markDirty();
          }
        }
        break;
      }
      case "draw": {
        const world = this.cam.screenToWorld(screen.x, screen.y);
        this.updateDraft(world);
        break;
      }
      case "link": {
        if (!this.linkDraft) break;
        const world = this.cam.screenToWorld(screen.x, screen.y);
        this.linkDraft.cur = world;
        const target = this.findNodeAt(world);
        if (target && target.id !== this.linkDraft.fromId) {
          const r = nodeRect(target)!;
          this.hoverNodeId = target.id;
          this.hoverAnchor = nearestAnchor(r, world).side;
        } else {
          this.hoverNodeId = null;
          this.hoverAnchor = null;
        }
        this.markDirty();
        break;
      }
      case "none":
        break;
    }
  }

  // ── pointer up ────────────────────────────────────────────────────────
  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;

    switch (this.drag.kind) {
      case "pan":
        // Pan завершён, сохраняем камеру (debounced).
        this.scheduleChange();
        break;
      case "move":
        if (this.drag.moved) {
          // undo уже создан на первом движении, просто коммитим.
          this.afterMutation();
        } else if (this.drag.clickId && this.selectedIds.size > 1) {
          // Клик без движения по одному из группы , сворачиваем до него.
          // (редактирование узла только по двойному клику, одиночный клик
          // никогда не открывает редактор и не перехватывает фокус клавиатуры).
          this.selectSingle(this.drag.clickId);
          this.markDirty();
          this.emitState();
        }
        break;
      case "marquee":
        this.finishMarquee(this.drag);
        break;
      case "resize":
        // undo создан на первом дельта-ресайзе; клик по ручке без драга
        // не трогал историю.
        if (this.drag.resized) this.afterMutation();
        break;
      case "labelDrag":
        if (this.drag.moved) this.afterMutation();
        break;
      case "link":
        this.commitLink();
        break;
      case "draw":
        this.commitDraft();
        break;
      case "none":
        break;
    }

    this.drag = { kind: "none" };
    this.releasePointer();
  };

  private releasePointer(): void {
    if (this.activePointerId !== null) {
      try {
        this.canvas.releasePointerCapture(this.activePointerId);
      } catch {
        /* capture мог уже исчезнуть */
      }
      this.activePointerId = null;
    }
  }

  // ── double-click: edit node / text under cursor ───────────────────────────
  private onDblClick = (e: MouseEvent): void => {
    const screen = this.localPoint(e);
    const world = this.cam.screenToWorld(screen.x, screen.y);
    const tol = HIT_TOL_SCREEN / this.cam.zoom;
    const hit = this.hitTestSpatial(world, tol);
    if (hit) {
      if (isNodeShape(hit)) {
        // Ноды флоучарта (db/action/note) редактируются через React overlay.
        this.selectSingle(hit.id);
        this.activateNode(hit);
        this.markDirty();
        this.emitState();
        return;
      }
      if (hasTextField(hit)) {
        this.selectSingle(hit.id);
        this.requestTextEdit(hit);
        this.markDirty();
        this.emitState();
      }
      return;
    }
    // Нет фигуры под курсором, может это коннектор: двойной клик редактирует лейбл.
    const edge = this.edgeAt(world, tol);
    if (edge) {
      this.selectedEdgeId = edge.id;
      this.selectedIds.clear();
      this.requestEdgeLabelEdit(edge);
      this.markDirty();
      this.emitState();
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault(); // наше меню, не браузерное
    // Правый клик отменяет текущий X/Y align (Escape закрывает модалку).
    if (this.alignMode) {
      this.alignMode = null;
      this.markDirty();
      this.emitState();
      this.onContextRequest?.(null);
      return;
    }
    const screen = this.localPoint(e);
    const world = this.cam.screenToWorld(screen.x, screen.y);
    const tol = HIT_TOL_SCREEN / this.cam.zoom;

    // Правый клик по невыбранному объекту выбирает его (чтобы меню
    // действовало на то, что кликнули). Сначала фигура, потом коннектор.
    const hit = this.hitTestSpatial(world, tol);
    if (hit) {
      if (!this.selectedIds.has(hit.id)) this.selectSingle(hit.id);
    } else {
      const edge = this.edgeAt(world, tol);
      if (edge && this.selectedEdgeId !== edge.id) {
        this.selectedEdgeId = edge.id;
        this.selectedIds.clear();
      } else if (!edge) {
        this.clearSelection();
      }
    }
    this.markDirty();
    this.emitState();

    if (!this.onContextRequest || !this.hasSelection()) {
      this.onContextRequest?.(null); // пустой правый клик, закрываем открытое меню
      return;
    }
    // "Все залочены" управляет надписью заблокировать/разблокировать.
    let allLocked = this.selectedIds.size > 0;
    for (const id of this.selectedIds) {
      const s = this.shapeMap.get(id);
      if (!s || !s.locked) {
        allLocked = false;
        break;
      }
    }
    const rect = this.canvas.getBoundingClientRect();
    this.onContextRequest({
      screenX: rect.left + screen.x,
      screenY: rect.top + screen.y,
      hasShapes: this.selectedIds.size > 0,
      hasEdge: this.selectedEdgeId !== null,
      locked: allLocked,
      style: this.selectionStyle(),
    });
  };

  /** Стиль основного выбранного элемента (первая фигура или коннектор) для
   *  отображения в панели стилей. */
  private selectionStyle(): SelectionStyle {
    let s: Shape | undefined;
    for (const id of this.selectedIds) {
      s = this.shapeMap.get(id);
      if (s) break;
    }
    if (s) {
      return {
        fill: "fill" in s ? s.fill : null,
        stroke: s.color,
        textColor: isNodeShape(s)
          ? (s.textColor ?? null)
          : s.type === "text"
            ? s.color
            : null,
        strokeWidth: s.sw,
        opacity: s.opacity ?? 1,
      };
    }
    if (this.selectedEdgeId !== null) {
      const e = this.edges.find((x) => x.id === this.selectedEdgeId);
      return {
        fill: null,
        stroke: e?.color ?? null,
        textColor: null,
        strokeWidth: null,
        opacity: 1,
      };
    }
    return {
      fill: null,
      stroke: null,
      textColor: null,
      strokeWidth: null,
      opacity: 1,
    };
  }

  // ── wheel: pan (plain) / zoom (ctrl|meta) ─────────────────────────────────
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const screen = this.localPoint(e);

    if (e.ctrlKey || e.metaKey) {
      // Зум к указателю. Нормализуем line-delta режим к примерно пикселям.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.cssH : 1;
      const dy = e.deltaY * unit;
      const factor = Math.exp(-dy * WHEEL_ZOOM_INTENSITY);
      this.cam.zoomToPoint(factor, screen.x, screen.y);
      this.afterCameraChange();
    } else {
      // Обычная прокрутка: вертикальная колёсико = вертикальный пан,
      // deltaX = горизонтальный.
      const unit = e.deltaMode === 1 ? 16 : 1;
      this.cam.panByScreen(-e.deltaX * unit, -e.deltaY * unit);
      this.markDirty();
      this.reanchorOverlays();
      this.scheduleChange();
    }
  };

  // ── keyboard ──────────────────────────────────────────────────────────
  private onKeyDown = (e: KeyboardEvent): void => {
    // Игнорируем ввод в input/textarea/contenteditable (текстовый
    // overlay или окружающий редактор заметки).
    if (isEditableTarget(e.target)) {
      if (e.code === "Space") this.spaceDown = false;
      return;
    }

    const mod = e.ctrlKey || e.metaKey;

    // Для шорткатов, которыми управляет доска, ещё и stopPropagation,
    // чтобы app-level listener (например undo на Ctrl+Z) не сработал
    // на ту же клавишу.
    if (mod && e.code === "KeyZ") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.code === "KeyY") {
      e.preventDefault();
      e.stopPropagation();
      this.redo();
      return;
    }

    // Буфер обмена / выделение (с Ctrl/Cmd). ВАЖНО: глотаем событие
    // (preventDefault + stopPropagation) только когда доска реально
    // действует, как и в Delete ниже. Этот листенер в CAPTURE phase и
    // живёт пока открыта модалка доски, так что работает до ProseMirror
    // и нативного браузерного буфера. Безусловный swallow раньше перехватывал
    // буфер ОС/редактора когда фокус не в текстовом поле (canvas, кнопка
    // тулбара, overlay div, body) , из-за этого Ctrl+C/V "иногда не
    // работал". Сначала проверяем, потом забираем клавишу; если нечего
    // делать, пускаем событие дальше в нативную обработку.
    if (mod && e.code === "KeyD") {
      if (this.selectedIds.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.duplicateSelection();
      }
      return;
    }
    if (mod && e.code === "KeyC") {
      if (this.selectedIds.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.copySelection();
      }
      return;
    }
    if (mod && e.code === "KeyV") {
      if (this.clipboard && this.clipboard.shapes.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.pasteClipboard();
      }
      return;
    }
    if (mod && e.code === "KeyA") {
      if (this.shapes.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.selectAll();
      }
      return;
    }

    if (e.code === "Space") {
      this.spaceDown = true;
      // Не блокируем глобально, только ставим флаг. Пан начинается
      // на pointerdown.
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.hasSelection()) {
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelection();
      }
      return;
    }

    if (e.key === "Escape") {
      // Пока панель стилей / пикер цвета открыты, пусть они обрабатывают
      // Escape (клавишу).
      if (this.menuOpen) return;
      let handled = true;
      if (this.alignMode) {
        this.alignMode = null;
        this.markDirty();
        this.emitState();
      } else if (this.linkDraft) {
        this.linkDraft = null;
        this.hoverNodeId = null;
        this.hoverAnchor = null;
        this.releasePointer();
        this.drag = { kind: "none" };
        this.markDirty();
      } else if (this.draft) {
        this.cancelDraft();
        this.releasePointer();
        this.drag = { kind: "none" };
      } else if (this.hasSelection()) {
        this.clearSelection();
        this.markDirty();
        this.emitState();
      } else {
        handled = false;
      }
      // Если мы отменили режим / очистили выделение, глотаем Escape, чтобы
      // bubble-phase обработчик модалки доски тоже не сработал. Если нечего
      // отменять, пусть всплывает , Escape закроет доску.
      if (handled) e.stopPropagation();
      return;
    }

    // X / Y , интерактивное выравнивание выделения вдоль оси (нажать ещё
    // раз для отмены). Фантомная направляющая следует за курсором; клик
    // фиксирует.
    if (
      !mod &&
      !e.altKey &&
      (e.code === "KeyX" || e.code === "KeyY") &&
      this.selectedIds.size > 0
    ) {
      e.preventDefault();
      e.stopPropagation();
      const axis = e.code === "KeyX" ? "x" : "y";
      this.alignMode =
        this.alignMode && this.alignMode.axis === axis ? null : { axis };
      this.markDirty();
      this.emitState();
      return;
    }

    // Хоткейы инструментов (только без модификаторов). Привязаны к e.code
    // (ФИЗИЧЕСКАЯ клавиша), чтобы работали на любой раскладке: e.key на
    // русской раскладке вернёт кириллический глиф и не совпадёт с латиницей.
    if (!mod && !e.altKey) {
      const map: Record<string, Tool> = {
        KeyV: "select",
        KeyS: "select",
        KeyH: "pan",
        KeyP: "pen",
        KeyD: "pen",
        KeyR: "rect",
        KeyO: "ellipse",
        KeyE: "ellipse",
        KeyA: "arrow",
        KeyT: "text",
        KeyB: "db",
        KeyG: "action",
        KeyN: "note",
        KeyC: "link",
      };
      const next = map[e.code];
      if (next) this.setTool(next);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") this.spaceDown = false;
  };

  // ──────────────────────────────────────────────────────────────────────
  //  Поведение инструментов
  // ──────────────────────────────────────────────────────────────────────

  private beginSelect(world: Pt, screen: Pt, shift: boolean): void {
    const tol = HIT_TOL_SCREEN / this.cam.zoom;

    // 1) Resize handle bounding box выделения в приоритете. Работает для
    //    ОДНОЙ или МНОГИХ фигур: групповой resize масштабирует все вокруг
    //    бокса. Undo пушится лениво на первом реальном дельта resize
    //    (клик по хэндлу без drag не должен трогать историю, см. onPointerMove).
    if (this.selectedEdgeId === null) {
      const box = this.selectionResizeBox();
      if (box) {
        const handle = this.handleAt(screen, boundsToRect(box));
        if (handle) {
          this.drag = {
            kind: "resize",
            handle,
            origBox: box,
            orig: this.unlockedSelected().map(cloneShape),
            startWorld: world,
            resized: false,
          };
          this.markDirty();
          return;
        }
      }
    }

    // 1.5) Чип-подпись коннектора: тащим её, чтобы двигать подпись вдоль ребра.
    const labelEdge = this.labelChipAt(screen);
    if (labelEdge) {
      this.selectedEdgeId = labelEdge.id;
      this.selectedIds.clear();
      this.drag = { kind: "labelDrag", edgeId: labelEdge.id, moved: false };
      this.markDirty();
      this.emitState();
      return;
    }

    // 2) Фигура под курсором.
    const hit = this.hitTestSpatial(world, tol);
    if (hit) {
      if (shift) {
        if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id);
        else this.selectedIds.add(hit.id);
        this.selectedEdgeId = null;
        this.drag = { kind: "none" };
      } else {
        if (!this.selectedIds.has(hit.id)) this.selectSingle(hit.id);
        else this.selectedEdgeId = null;
        // Двигаем всё выделение. Undo пушится лениво на первом реальном
        // move (нулевой клик не должен трогать историю). clickId позволяет
        // нулевому клику свернуть мультивыделение в одну фигуру на pointer-up.
        this.drag = { kind: "move", clickId: hit.id, lastWorld: world, moved: false };
      }
      this.markDirty();
      this.emitState();
      return;
    }

    // 3) Коннектор под курсором.
    const edge = this.edgeAt(world, tol);
    if (edge) {
      this.selectedEdgeId = edge.id;
      if (!shift) this.selectedIds.clear();
      this.drag = { kind: "none" };
      this.markDirty();
      this.emitState();
      return;
    }

    // 4) Пустое место: рамка-выделение (сбрасывает выделение, если не аддитивное).
    if (!shift) this.clearSelection();
    this.drag = { kind: "marquee", startWorld: world, cur: world, additive: shift };
    this.markDirty();
    this.emitState();
  }

  private beginPen(world: Pt): void {
    this.draft = {
      id: rid(),
      type: "pen",
      color: this.color,
      sw: this.strokeWidth,
      points: [world],
    };
    this.drag = { kind: "draw" };
    this.markDirty();
  }

  private beginBox(world: Pt): void {
    const type = this.tool === "ellipse" ? "ellipse" : "rect";
    this.draft = {
      id: rid(),
      type,
      color: this.color,
      sw: this.strokeWidth,
      x: world.x,
      y: world.y,
      w: 0,
      h: 0,
      fill: "transparent",
    } as Shape;
    this.drag = { kind: "draw" };
    this.markDirty();
  }

  private beginArrow(world: Pt): void {
    this.draft = {
      id: rid(),
      type: "arrow",
      color: this.color,
      sw: this.strokeWidth,
      x1: world.x,
      y1: world.y,
      x2: world.x,
      y2: world.y,
    };
    this.drag = { kind: "draw" };
    this.markDirty();
  }

  /** Начинает тянуть коннектор из ближайшего анкора ноды под указателем.
   *  No-op (drag остаётся "none") когда указатель не над нодой. */
  private beginLink(world: Pt): void {
    const node = this.findNodeAt(world);
    if (!node) return;
    const r = nodeRect(node)!;
    const { side, point } = nearestAnchor(r, world);
    this.linkDraft = {
      fromId: node.id,
      fromSide: side,
      fromPt: point,
      cur: world,
    };
    this.hoverNodeId = node.id;
    this.hoverAnchor = side;
    this.drag = { kind: "link" };
    this.markDirty();
  }

  /** Завершает drag коннектора: если отпущен над другой нодой, создаёт
   *  ребро к ближайшему анкору этой ноды. */
  private commitLink(): void {
    const ld = this.linkDraft;
    this.linkDraft = null;
    this.hoverNodeId = null;
    this.hoverAnchor = null;
    if (ld) {
      const target = this.findNodeAt(ld.cur);
      if (target && target.id !== ld.fromId) {
        const r = nodeRect(target)!;
        const toSide = nearestAnchor(r, ld.cur).side;
        const edge: Edge = {
          id: rid(),
          from: ld.fromId,
          fromSide: ld.fromSide,
          to: target.id,
          toSide,
          color: this.color,
          routing: this.edgeRouting,
        };
        this.pushUndo();
        this.edges.push(edge);
        this.afterMutation();
        return;
      }
    }
    this.markDirty();
  }

  /** Обновляет, какой якорь подсвечен, пока инструмент связи наводится (без драга). */
  private updateLinkHover(screen: Pt): void {
    const world = this.cam.screenToWorld(screen.x, screen.y);
    const node = this.findNodeAt(world);
    const prevN = this.hoverNodeId;
    const prevA = this.hoverAnchor;
    if (node) {
      const r = nodeRect(node)!;
      this.hoverNodeId = node.id;
      this.hoverAnchor = nearestAnchor(r, world).side;
    } else {
      this.hoverNodeId = null;
      this.hoverAnchor = null;
    }
    if (prevN !== this.hoverNodeId || prevA !== this.hoverAnchor) {
      this.markDirty();
    }
  }

  private updateDraft(world: Pt): void {
    const d = this.draft;
    if (!d) return;
    switch (d.type) {
      case "pen":
        d.points.push(world);
        break;
      case "rect":
      case "ellipse":
        d.x = Math.min(this.downWorld.x, world.x);
        d.y = Math.min(this.downWorld.y, world.y);
        d.w = Math.abs(world.x - this.downWorld.x);
        d.h = Math.abs(world.y - this.downWorld.y);
        break;
      case "arrow":
        d.x2 = world.x;
        d.y2 = world.y;
        break;
      default:
        break;
    }
    this.markDirty();
  }

  private commitDraft(): void {
    const d = this.draft;
    this.draft = null;
    if (!d) {
      this.markDirty();
      return;
    }

    let keep = true;
    switch (d.type) {
      case "pen":
        // Упрощаем RDP сырые сэмплы перед коммитом: меньше точек =
        // дешевле bounds/hit/render навсегда. Epsilon масштабируется с zoom,
        // так что мелкие детали при приближении сохраняются.
        if (d.points.length > 2) {
          d.points = simplifyRDP(d.points, RDP_BASE_EPSILON / this.cam.zoom);
        }
        keep = d.points.length >= 2 || isTinyDot(d.points);
        break;
      case "rect":
      case "ellipse":
        keep = d.w >= MIN_DRAG_TO_CREATE && d.h >= MIN_DRAG_TO_CREATE;
        break;
      case "arrow":
        keep = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= MIN_DRAG_TO_CREATE;
        break;
      default:
        keep = true;
    }

    if (!keep) {
      this.markDirty();
      return;
    }

    this.pushUndo();
    this.shapes.push(d);
    // Не выделяем свежую фигуру: бокс выделения после каждого штриха /
    // прямоугольника / стрелки отвлекал ("как только нарисовал, сразу
    // выделяется, убери"). Выделение остаётся пустым (инструмент рисования
    // очистил его при входе), просто продолжаете рисовать.
    this.afterMutation();
  }

  /** Клик-создание free-text фигуры с немедленным открытием редактора. */
  private createText(world: Pt): void {
    const shape: Shape = {
      id: rid(),
      type: "text",
      color: this.color,
      sw: this.strokeWidth,
      x: world.x,
      y: world.y,
      text: "",
      size: TEXT_DEFAULT_SIZE,
    };
    // Живёт в draft пока overlay не закоммитит текст (пустой cancel не
    // оставляет ничего и не засоряет undo).
    this.draft = shape;
    this.selectSingle(shape.id);
    this.markDirty();
    this.emitState();
    this.requestTextEdit(shape);
  }

  /** Клик-создание flowchart ноды (db/action/note) по центру указателя,
   *  затем открываем overlay и возвращаемся в select tool. */
  private createNode(kind: "db" | "action" | "note", world: Pt): void {
    let node: Shape;
    if (kind === "db") {
      node = {
        id: rid(),
        type: "db",
        x: world.x - DB_NODE_W / 2,
        y: world.y - DB_NODE_H / 2,
        w: DB_NODE_W,
        h: DB_NODE_H,
        title: "",
        query: "",
        color: DB_STROKE,
        fill: DB_FILL,
        sw: 1,
        opacity: 0.8,
      };
    } else if (kind === "action") {
      node = {
        id: rid(),
        type: "action",
        x: world.x - ACTION_NODE_W / 2,
        y: world.y - ACTION_NODE_H / 2,
        w: ACTION_NODE_W,
        h: ACTION_NODE_H,
        label: "",
        variant: "process",
        color: ACTION_STROKE,
        fill: ACTION_FILL,
        sw: 1,
        opacity: 0.8,
      };
    } else {
      node = {
        id: rid(),
        type: "note",
        x: world.x - NOTE_NODE_W / 2,
        y: world.y - NOTE_NODE_H / 2,
        w: NOTE_NODE_W,
        h: NOTE_NODE_H,
        text: "",
        color: NOTE_STROKE,
        fill: NOTE_FILL,
        sw: 1,
        opacity: 0.8,
      };
    }
    this.pushUndo();
    this.shapes.push(node);
    this.selectSingle(node.id);
    this.afterMutation();
    // Разовый инструмент: размещение ноды возвращает в select, чтобы
    // следующий клик не породил ещё одну ноду. Намеренно НЕ открываем
    // редактор автоматически: двойной клик для редактирования. (Автофокус
    // на поле при каждом вставке раздражал и ловил фокус клавиатуры,
    // хоткейы/Ctrl+A переставали работать.)
    this.setTool("select");
  }

  /** Открывает React node-overlay для ноды, якорь справа сверху. */
  private activateNode(s: Shape): void {
    if (!this.onNodeActivate || !isNodeShape(s)) return;
    this.activeNodeOverlayId = s.id; // track so the overlay follows the camera
    const rect = this.canvas.getBoundingClientRect();
    const tr = this.cam.worldToScreen(s.x + s.w, s.y);
    const screenX = rect.left + tr.x + 14;
    const screenY = rect.top + tr.y;
    if (s.type === "db") {
      this.onNodeActivate({
        kind: "db",
        id: s.id,
        title: s.title,
        query: s.query,
        screenX,
        screenY,
      });
    } else if (s.type === "action") {
      this.onNodeActivate({ kind: "action", id: s.id, label: s.label, screenX, screenY });
    } else if (s.type === "note") {
      this.onNodeActivate({ kind: "note", id: s.id, text: s.text, screenX, screenY });
    }
  }

  /** Перемещает одну фигуру на дельту в мировых координатах, сохраняя
   *  индекс/мап/спрайт актуальными. Move только ТРАНСЛИРУЕТ (вид не
   *  меняется), так что сдвигаем origin кэшированного спрайта вместо
   *  пересборки: group-drag тяжёлых нод остаётся чистым blit. */
  private moveOne(id: string, dx: number, dy: number): void {
    // O(1) через shapeIndex: раньше был O(N) findIndex, так что group
    // drag M фигур был O(M*N) на каждый pointermove (а pointermove теперь
    // до fps после rAF-гейта, но всё равно M раз за кадр).
    const idx = this.shapeIndex.get(id);
    if (idx === undefined || this.shapes[idx].locked) return;
    const moved = translateShape(this.shapes[idx], dx, dy);
    this.shapes[idx] = moved;
    // Считаем bounds ОДИН раз и заполняем WeakMap кэш: render's boundsOf(moved)
    // иначе заново обойдёт points pen-штриха уже на следующем кадре.
    const b = shapeBounds(moved);
    this.boundsCache.set(moved, b);
    this.spatial.update(id, b);
    this.shapeMap.set(id, moved);
    const spr = this.sprites.get(id);
    if (spr) {
      spr.ox += dx;
      spr.oy += dy;
      spr.shape = moved;
    }
  }

  /** Двигает каждую выделенную фигуру на дельту (group drag). */
  private applyMoveSelection(dx: number, dy: number): void {
    for (const id of this.selectedIds) this.moveOne(id, dx, dy);
    this.markDirty();
  }

  /** Удаляет всё выделение: выделенные (незалоченные) фигуры + коннекторы,
   *  касающиеся любой удалённой ноды + выбранный коннектор. Залоченные
   *  фигуры выживают. */
  deleteSelection(): void {
    if (!this.hasSelection()) return;
    const removable = new Set<string>();
    const removedNodeIds = new Set<string>();
    for (const id of this.selectedIds) {
      const s = this.shapeMap.get(id);
      if (!s || s.locked) continue; // locked shapes are kept
      removable.add(id);
      if (isNodeShape(s)) removedNodeIds.add(id);
    }
    const deletingEdge = this.selectedEdgeId !== null;
    if (removable.size === 0 && !deletingEdge) return; // everything locked , no-op
    this.pushUndo();
    if (removable.size > 0) {
      this.shapes = this.shapes.filter((s) => !removable.has(s.id));
      if (removedNodeIds.size > 0) {
        this.edges = this.edges.filter(
          (e) => !removedNodeIds.has(e.from) && !removedNodeIds.has(e.to),
        );
      }
    }
    if (deletingEdge) {
      const eid = this.selectedEdgeId;
      this.edges = this.edges.filter((e) => e.id !== eid);
    }
    this.clearSelection();
    this.afterMutation();
  }

  /** Применяет патч стиля к выделению: заливка / обводка (border) / цвет
   *  текста / толщина обводки / opacity. Каждое поле независимо, меняются
   *  только переданные. Пропускает залоченные фигуры; `stroke` ещё и
   *  перекрашивает выбранный коннектор. */
  setSelectionStyle(patch: {
    fill?: string;
    stroke?: string;
    textColor?: string;
    strokeWidth?: number;
    opacity?: number;
  }): void {
    if (!this.hasSelection()) return;
    let changed = false;
    for (const s of this.shapes) {
      if (!this.selectedIds.has(s.id) || s.locked) continue;
      if (styledShape(s, patch) !== s) {
        changed = true;
        break;
      }
    }
    const edgeIdx =
      patch.stroke !== undefined && this.selectedEdgeId !== null
        ? this.edges.findIndex((e) => e.id === this.selectedEdgeId)
        : -1;
    const edgeChanges =
      edgeIdx !== -1 && this.edges[edgeIdx].color !== patch.stroke;
    if (!changed && !edgeChanges) return;
    this.pushUndo();
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      if (!this.selectedIds.has(s.id) || s.locked) continue;
      this.shapes[i] = styledShape(s, patch);
    }
    if (edgeChanges) {
      this.edges[edgeIdx] = { ...this.edges[edgeIdx], color: patch.stroke! };
    }
    this.afterMutation();
  }

  /** Z-порядок: перемещает выделенные фигуры наверх (front) или вниз (back). */
  bringSelectionToFront(): void {
    this.reorderSelection(true);
  }
  sendSelectionToBack(): void {
    this.reorderSelection(false);
  }
  private reorderSelection(front: boolean): void {
    if (this.selectedIds.size === 0) return;
    const sel: Shape[] = [];
    const rest: Shape[] = [];
    for (const s of this.shapes) {
      (this.selectedIds.has(s.id) ? sel : rest).push(s);
    }
    if (sel.length === 0 || rest.length === 0) return;
    this.pushUndo();
    this.shapes = front ? [...rest, ...sel] : [...sel, ...rest];
    this.afterMutation();
  }

  /** Переключает lock на выделенных фигурах: если хотя бы одна незалочена
   *  , лочим все, иначе разлочиваем. (Рёбра не лочатся.) */
  toggleLockSelection(): void {
    if (this.selectedIds.size === 0) return;
    let anyUnlocked = false;
    for (const id of this.selectedIds) {
      const s = this.shapeMap.get(id);
      if (s && !s.locked) {
        anyUnlocked = true;
        break;
      }
    }
    const lock = anyUnlocked;
    // Сначала собираем цели, потом снапшот (pushUndo), потом пишем:
    // иначе undo-снапшот зафиксирует уже переключённое состояние и
    // undo будет no-op.
    const targets: number[] = [];
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      if (this.selectedIds.has(s.id) && !!s.locked !== lock) targets.push(i);
    }
    if (targets.length === 0) return;
    this.pushUndo();
    for (const i of targets) {
      this.shapes[i] = { ...this.shapes[i], locked: lock };
    }
    this.afterMutation();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Resize / marquee / выбор коннектора / буфер обмена
  // ──────────────────────────────────────────────────────────────────────

  /** Какой resize handle (если есть) под указателем для прямоугольника `r`. */
  private handleAt(screen: Pt, r: Rect): HandleId | null {
    const pts = handlePoints(r);
    let best: HandleId | null = null;
    let bestD = RESIZE_HANDLE_HIT;
    for (const key of Object.keys(pts) as HandleId[]) {
      const wp = pts[key];
      const sp = this.cam.worldToScreen(wp.x, wp.y);
      const d = Math.hypot(sp.x - screen.x, sp.y - screen.y);
      if (d <= bestD) {
        bestD = d;
        best = key;
      }
    }
    return best;
  }

  /** Применяет resize drag: двигает захваченный край/угол, фиксирует
   *  противоположный, ограничивает минимумом. */
  private applyResize(
    d: { handle: HandleId; origBox: Bounds; orig: Shape[]; startWorld: Pt },
    world: Pt,
  ): void {
    const ob = d.origBox;
    const ow = ob.maxX - ob.minX;
    const oh = ob.maxY - ob.minY;
    if (ow <= 0 || oh <= 0) return;
    const dx = world.x - d.startWorld.x;
    const dy = world.y - d.startWorld.y;
    const hd = d.handle;

    // Новые края бокса (захваченный край движется, противоположный фиксирован).
    let minX = ob.minX;
    let minY = ob.minY;
    let maxX = ob.maxX;
    let maxY = ob.maxY;
    if (hd.includes("w")) minX = ob.minX + dx;
    if (hd.includes("e")) maxX = ob.maxX + dx;
    if (hd.includes("n")) minY = ob.minY + dy;
    if (hd.includes("s")) maxY = ob.maxY + dy;
    // Ограничиваем минимумом, фиксируя якорный край.
    if (maxX - minX < MIN_SHAPE_SIZE) {
      if (hd.includes("w")) minX = maxX - MIN_SHAPE_SIZE;
      else maxX = minX + MIN_SHAPE_SIZE;
    }
    if (maxY - minY < MIN_SHAPE_SIZE) {
      if (hd.includes("n")) minY = maxY - MIN_SHAPE_SIZE;
      else maxY = minY + MIN_SHAPE_SIZE;
    }

    // Коэффициенты масштабирования + фиксированный якорный угол
    // (противоположный захваченному хэндлу).
    const sx = (maxX - minX) / ow;
    const sy = (maxY - minY) / oh;
    const ax = hd.includes("w") ? ob.maxX : ob.minX;
    const ay = hd.includes("n") ? ob.maxY : ob.minY;

    // Масштабируем КАЖДУЮ снапшотную фигуру вокруг якоря (group resize).
    // O(M) через shapeIndex: раньше был O(M*N) на pointermove (группа из
    // 50 фигур на доске из 500 = ~25k сравнений id за кадр).
    for (const orig of d.orig) {
      const idx = this.shapeIndex.get(orig.id);
      if (idx === undefined) continue;
      const next = scaleShape(orig, ax, ay, sx, sy);
      this.shapes[idx] = next;
      const b = shapeBounds(next);
      this.boundsCache.set(next, b); // заполняем кэш, чтобы render's boundsOf попал
      this.spatial.update(orig.id, b);
      this.shapeMap.set(orig.id, next);
    }
    this.markDirty();
  }

  /** Bounding box выделенных РАЗЛОЧЕННЫХ фигур (бокс group-resize), или
   *  null если.resize не применим. */
  private selectionResizeBox(): Bounds | null {
    let box: Bounds | null = null;
    for (const id of this.selectedIds) {
      const s = this.shapeMap.get(id);
      if (!s || s.locked) continue;
      const b = this.boundsOf(s);
      box = box
        ? {
            minX: Math.min(box.minX, b.minX),
            minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX),
            maxY: Math.max(box.maxY, b.maxY),
          }
        : { ...b };
    }
    return box;
  }

  /** Выделенные фигуры, которые не залочены. */
  private unlockedSelected(): Shape[] {
    const out: Shape[] = [];
    for (const id of this.selectedIds) {
      const s = this.shapeMap.get(id);
      if (s && !s.locked) out.push(s);
    }
    return out;
  }

  /** Фиксирует X/Y выравнивание: двигает каждую выделенную (незалоченную)
   *  фигуру так, чтобы её центр попал на направляющую под курсором. */
  private commitAlign(): void {
    const am = this.alignMode;
    this.alignMode = null;
    if (!am) return;
    const line =
      am.axis === "x" ? this.lastPointerWorld.x : this.lastPointerWorld.y;
    const moves: { id: string; dx: number; dy: number }[] = [];
    for (const id of this.selectedIds) {
      const s = this.shapeMap.get(id);
      if (!s || s.locked) continue;
      const b = this.boundsOf(s);
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      if (am.axis === "x") moves.push({ id, dx: line - cx, dy: 0 });
      else moves.push({ id, dx: 0, dy: line - cy });
    }
    if (!moves.some((m) => m.dx !== 0 || m.dy !== 0)) {
      this.markDirty();
      this.emitState();
      return;
    }
    this.pushUndo();
    for (const m of moves) this.moveOne(m.id, m.dx, m.dy);
    this.afterMutation();
  }

  /** Выделяет все фигуры, пересекающие marquee-бокс (аддитивно если shift). */
  private finishMarquee(d: { startWorld: Pt; cur: Pt; additive: boolean }): void {
    const box: Bounds = {
      minX: Math.min(d.startWorld.x, d.cur.x),
      minY: Math.min(d.startWorld.y, d.cur.y),
      maxX: Math.max(d.startWorld.x, d.cur.x),
      maxY: Math.max(d.startWorld.y, d.cur.y),
    };
    if (!d.additive) this.selectedIds.clear();
    this.selectedEdgeId = null;
    for (const s of this.shapes) {
      if (boundsIntersect(this.boundsOf(s), box)) this.selectedIds.add(s.id);
    }
    this.markDirty();
    this.emitState();
  }

  /** Верхний коннектор, чей нарисованный путь проходит в пределах `tol`
   *  мировых единиц от `p`. */
  private edgeAt(p: Pt, tol: number): Edge | null {
    const slop = tol + 4 / this.cam.zoom;
    for (let i = this.edges.length - 1; i >= 0; i--) {
      const e = this.edges[i];
      const a = this.shapeMap.get(e.from);
      const b = this.shapeMap.get(e.to);
      const ra = a ? nodeRect(a) : null;
      const rb = b ? nodeRect(b) : null;
      if (!ra || !rb) continue;
      if (this.distToEdge(e, ra, rb, p) <= slop) return e;
    }
    return null;
  }

  /** Нарисованный путь коннектора как полилиния (ортогональный дословно,
   *  bezier сэмплируется). Используется и для hit-testing, и для
   *  размещения лейбла, чтобы они совпадали с рендерером. */
  private edgePathPoints(e: Edge, fromRect: Rect, toRect: Rect): Pt[] {
    const from = anchorPoint(fromRect, e.fromSide);
    const to = anchorPoint(toRect, e.toSide);
    if (e.routing === "bezier") {
      const { c1, c2 } = routeBezier(from, e.fromSide, to, e.toSide);
      return sampleCubic(from, c1, c2, to, 24);
    }
    return routeOrthogonal(from, e.fromSide, to, e.toSide);
  }

  /** Мировая точка лейбл-чипа коннектора (по `labelT` вдоль пути). */
  private labelPointOf(e: Edge, fromRect: Rect, toRect: Rect): Pt {
    return pointAtFraction(
      this.edgePathPoints(e, fromRect, toRect),
      e.labelT ?? 0.5,
    );
  }

  /** Минимальная дистанция от мировой точки `p` до нарисованного пути
   *  коннектора. */
  private distToEdge(e: Edge, fromRect: Rect, toRect: Rect, p: Pt): number {
    const pts = this.edgePathPoints(e, fromRect, toRect);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const d = distToSeg(p, pts[i - 1], pts[i]);
      if (d < best) best = d;
    }
    return best;
  }

  /** Коннектор с лейблом, чей лейбл-чип под экранным указателем (для drag). */
  private labelChipAt(screen: Pt): Edge | null {
    for (let i = this.edges.length - 1; i >= 0; i--) {
      const e = this.edges[i];
      if (!e.label || !e.label.trim()) continue;
      const a = this.shapeMap.get(e.from);
      const b = this.shapeMap.get(e.to);
      const ra = a ? nodeRect(a) : null;
      const rb = b ? nodeRect(b) : null;
      if (!ra || !rb) continue;
      const wp = this.labelPointOf(e, ra, rb);
      const sp = this.cam.worldToScreen(wp.x, wp.y);
      if (Math.hypot(sp.x - screen.x, sp.y - screen.y) <= LABEL_GRAB_SCREEN) {
        return e;
      }
    }
    return null;
  }

  /** Открывает текстовый overlay (стиль чипа) для редактирования лейбла
   *  коннектора, якорь в реальной позиции на пути, чтобы редактирование
   *  совпадало с тем, что нарисовано. */
  private requestEdgeLabelEdit(e: Edge): void {
    if (!this.onTextEdit) return;
    const a = this.shapeMap.get(e.from);
    const b = this.shapeMap.get(e.to);
    const ra = a ? nodeRect(a) : null;
    const rb = b ? nodeRect(b) : null;
    if (!ra || !rb) return;
    const lp = this.labelPointOf(e, ra, rb);
    const anchor = this.cam.worldToScreen(lp.x, lp.y);
    const rect = this.canvas.getBoundingClientRect();
    this.editingEdgeId = e.id;
    this.editingTextId = null;
    this.onTextEdit({
      id: e.id,
      screenX: rect.left + anchor.x,
      screenY: rect.top + anchor.y,
      value: e.label ?? "",
      fontPx: 14,
      color: "#e5e7eb",
      chip: true,
    });
  }

  private selectAll(): void {
    if (!this.shapes.length) return;
    this.selectedIds = new Set(this.shapes.map((s) => s.id));
    this.selectedEdgeId = null;
    this.markDirty();
    this.emitState();
  }

  /** Клонирует набор фигур (+ рёбра целиком между ними) со свежими id,
   *  сдвинутыми на (dx,dy). Конечные точки рёбер ремаппятся на новые id. */
  private cloneSelection(
    ids: Set<string>,
    dx: number,
    dy: number,
  ): { shapes: Shape[]; edges: Edge[] } {
    const idMap = new Map<string, string>();
    const shapes: Shape[] = [];
    for (const s of this.shapes) {
      if (!ids.has(s.id)) continue;
      const nid = rid();
      idMap.set(s.id, nid);
      shapes.push(translateShape({ ...cloneShape(s), id: nid }, dx, dy));
    }
    const edges: Edge[] = [];
    for (const e of this.edges) {
      const nf = idMap.get(e.from);
      const nt = idMap.get(e.to);
      if (nf && nt) edges.push({ ...cloneEdge(e), id: rid(), from: nf, to: nt });
    }
    return { shapes, edges };
  }

  duplicateSelection(): void {
    if (this.selectedIds.size === 0) return;
    const { shapes, edges } = this.cloneSelection(
      this.selectedIds,
      DUP_OFFSET,
      DUP_OFFSET,
    );
    if (!shapes.length) return;
    this.pushUndo();
    this.shapes.push(...shapes);
    this.edges.push(...edges);
    this.selectedIds = new Set(shapes.map((s) => s.id));
    this.selectedEdgeId = null;
    this.afterMutation();
  }

  private copySelection(): void {
    if (this.selectedIds.size === 0) {
      this.clipboard = null;
      return;
    }
    this.clipboard = this.cloneSelection(this.selectedIds, 0, 0);
  }

  private pasteClipboard(): void {
    const clip = this.clipboard;
    if (!clip || !clip.shapes.length) return;
    // Новые id при вставке, чтобы повторные вставки не коллидировали;
    // каждый вставка смещается дальше.
    const idMap = new Map<string, string>();
    const shapes = clip.shapes.map((s) => {
      const nid = rid();
      idMap.set(s.id, nid);
      return translateShape(
        { ...cloneShape(s), id: nid },
        PASTE_OFFSET,
        PASTE_OFFSET,
      );
    });
    const edges: Edge[] = [];
    for (const e of clip.edges) {
      const nf = idMap.get(e.from);
      const nt = idMap.get(e.to);
      if (nf && nt) edges.push({ ...cloneEdge(e), id: rid(), from: nf, to: nt });
    }
    this.pushUndo();
    this.shapes.push(...shapes);
    this.edges.push(...edges);
    this.selectedIds = new Set(shapes.map((s) => s.id));
    this.selectedEdgeId = null;
    // Оставляем вставленный набор в буфере, чтобы следующая вставка
    // сместилась дальше.
    this.clipboard = { shapes, edges };
    this.afterMutation();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Hit testing (с ускорением через spatial-hash)
  // ──────────────────────────────────────────────────────────────────────

  /** Верхняя фигура под мировой точкой, учитывая только кандидатов
   *  spatial-hash рядом с точкой. Сохраняет z-порядок (порядок массива). */
  private hitTestSpatial(world: Pt, tol: number): Shape | null {
    const cand = this.spatial.queryPoint(world, tol);
    if (cand.size === 0) return null;
    // Фильтруем до кандидатов, сохраняя порядок отрисовки, затем
    // переиспользуем точный hitTest (идёт от заднего к переднему и
    // возвращает верхний).
    const subset: Shape[] = [];
    for (let i = 0; i < this.shapes.length; i++) {
      if (cand.has(this.shapes[i].id)) subset.push(this.shapes[i]);
    }
    return hitTest(subset, world, tol);
  }

  /** Верхняя flowchart НОДА (db/action/note) под мировой точкой. */
  private findNodeAt(world: Pt): Shape | null {
    const tol = HIT_TOL_SCREEN / this.cam.zoom;
    const cand = this.spatial.queryPoint(world, tol);
    const subset: Shape[] = [];
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      if (cand.has(s.id) && isNodeShape(s)) subset.push(s);
    }
    const hit = hitTest(subset, world, tol);
    return hit && isNodeShape(hit) ? hit : null;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Handshake текстового overlay
  // ──────────────────────────────────────────────────────────────────────

  private requestTextEdit(s: Shape): void {
    if (!this.onTextEdit || !hasTextField(s)) return;
    const fontPx = textFontPx(s) * this.cam.zoom;
    // Якорим overlay в левом верхнем углу текстовой фигуры в экранных
    // координатах.
    const anchor = this.cam.worldToScreen(s.x, s.y);
    const rect = this.canvas.getBoundingClientRect();
    this.editingTextId = s.id; // трекаем, чтобы overlay следовал за камерой
    this.editingEdgeId = null;
    this.onTextEdit({
      id: s.id,
      screenX: rect.left + anchor.x,
      screenY: rect.top + anchor.y,
      value: s.text,
      fontPx,
      color: s.color,
    });
  }

  private closeTextEdit(): void {
    this.editingTextId = null;
    this.editingEdgeId = null;
    this.onTextEdit?.(null);
  }

  /** Вызывается React node-overlay при закрытии (коммит или dismiss),
   *  чтобы engine прекратил перехватывать его при движении камеры. */
  clearNodeOverlay(): void {
    this.activeNodeOverlayId = null;
  }

  /** React сообщает когда панель стилей / пикер цвета открыты, чтобы
   *  Escape шёл к ним (закрыть overlay) вместо очистки выделения / доски. */
  setMenuOpen(open: boolean): void {
    this.menuOpen = open;
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Вспомогательные функции (на уровне модуля)
// ──────────────────────────────────────────────────────────────────────────

/** Снапшот для undo/redo: shapes + edges (камера намеренно не часть
 *  истории, это view state, а не document state). */
type Snapshot = { shapes: Shape[]; edges: Edge[] };

/** Запечённый спрайт на фигуру. Для визуально различных фигур (pen/rect/
 *  ellipse/arrow/text) `canvas` принадлежит этому биндингу. Для типов нод,
 *  где много экземпляров делят визуал (цилиндры db, боксы action, карточки
 *  note, худший сценарий 200 одинаковых "SQL" цилиндров), `canvas` это
 *  ссылка в content-hash атласе по `atlasKey`, а `ox/oy` это мировой origin
 *  экземпляра, куда блитается shared bitmap. Atlas-backed спрайты дают
 *  O(unique visuals) память и bake-cost вместо O(N instances): ~95 KB +
 *  0.5 мс вместо 19 MB + 100+ мс. */
type Sprite = {
  /** Atlas canvas (если atlasKey !== null) ИЛИ уникальный offscreen canvas,
   *  принадлежащий только этому биндингу. */
  canvas: HTMLCanvasElement;
  /** Не null , спрайт поддержан записью атласа, которую могут разделять
   *  другие экземпляры. При dispose вызываем releaseAtlasEntry(atlasKey). */
  atlasKey: string | null;
  shape: Shape;
  zoom: number;
  ox: number;
  oy: number;
  used: number;
  staleZoom: boolean;
};

/** Бухгалтерия атласа: один bitmap на комбо (type|visual fields|zoom),
 *  refcounted по всем Sprite биндингам, указывающим на него. Запись
 *  удаляется когда refCount падает до нуля. */
type AtlasEntry = {
  canvas: HTMLCanvasElement;
  zoom: number;
  refCount: number;
};

/** Достаточный клон для снапшотов: копирует массивы, которые мы мутируем
 *  (points pen), чтобы undo-снапшоты не ссылались на live фигуры. */
function cloneShape(s: Shape): Shape {
  if (s.type === "pen") {
    return { ...s, points: s.points.map((p) => ({ x: p.x, y: p.y })) };
  }
  return { ...s };
}

function cloneEdge(e: Edge): Edge {
  return { ...e };
}

/** Free-text фигура, редактируемая через canvas textarea overlay. (Flowchart
 *  ноды тоже несут текст, но редактируются через React node overlay, так что
 *  они намеренно исключены здесь.) */
type TextShape = Extract<Shape, { type: "text" }>;

function hasTextField(s: Shape): s is TextShape {
  return s.type === "text";
}

function hasText(v: string): boolean {
  return v.trim().length > 0;
}

function setShapeText(s: Shape, text: string): Shape {
  if (s.type === "text") {
    return { ...s, text };
  }
  return s;
}

function textFontPx(s: Shape): number {
  return s.type === "text" ? s.size : 16;
}

function isTinyDot(points: Pt[]): boolean {
  return points.length === 1;
}

/** AABB пересечение для frustum culling. Включительно по краям. */
function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY
  );
}

/** Bounds , {x,y,w,h} rect. */
function boundsToRect(b: Bounds): Rect {
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/** Масштабирует геометрию фигуры вокруг (ax,ay) на (sx,sy), ядро группового ресайза.
 *  Box-фигуры масштабируют углы; pen/arrow масштабируют каждую точку;
 *  text масштабирует позицию и шрифт через среднее геометрическое,
 *  чтобы расти вместе с боксом. */
function scaleShape(s: Shape, ax: number, ay: number, sx: number, sy: number): Shape {
  const fx = (v: number) => ax + (v - ax) * sx;
  const fy = (v: number) => ay + (v - ay) * sy;
  switch (s.type) {
    case "pen":
      return { ...s, points: s.points.map((p) => ({ x: fx(p.x), y: fy(p.y) })) };
    case "arrow":
      return { ...s, x1: fx(s.x1), y1: fy(s.y1), x2: fx(s.x2), y2: fy(s.y2) };
    case "text":
      return {
        ...s,
        x: fx(s.x),
        y: fy(s.y),
        size: Math.max(4, s.size * Math.sqrt(Math.abs(sx * sy))),
      };
    case "rect":
    case "ellipse":
    case "db":
    case "action":
    case "note": {
      const x1 = fx(s.x);
      const y1 = fy(s.y);
      const x2 = fx(s.x + s.w);
      const y2 = fy(s.y + s.h);
      return {
        ...s,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      };
    }
  }
}

/** Применяет независимый патч стиля к фигуре; возвращает ту же ссылку
 *  если ничего не меняется (чтобы вызывающие могли пропустить no-op undo). */
function styledShape(
  s: Shape,
  p: {
    fill?: string;
    stroke?: string;
    textColor?: string;
    strokeWidth?: number;
    opacity?: number;
  },
): Shape {
  let next: Shape = s;
  // Обводка / цвет чернил / border color , каждая фигура имеет `color`.
  if (p.stroke !== undefined && next.color !== p.stroke) {
    next = { ...next, color: p.stroke };
  }
  // Заливка, только у фигур, которые её имеют (rect/ellipse + ноды).
  if (p.fill !== undefined && "fill" in next && next.fill !== p.fill) {
    next = { ...next, fill: p.fill };
  }
  // Цвет текста: ноды используют `textColor`, free-text фигура использует
  // свой `color`.
  if (p.textColor !== undefined) {
    if (isNodeShape(next)) {
      if (next.textColor !== p.textColor) {
        next = { ...next, textColor: p.textColor };
      }
    } else if (next.type === "text" && next.color !== p.textColor) {
      next = { ...next, color: p.textColor };
    }
  }
  // Толщина обводки.
  if (p.strokeWidth !== undefined) {
    const w = Math.max(0.5, Math.min(40, p.strokeWidth));
    if (next.sw !== w) next = { ...next, sw: w };
  }
  // Прозрачность.
  if (p.opacity !== undefined) {
    const o = Math.max(0.05, Math.min(1, p.opacity));
    if ((next.opacity ?? 1) !== o) next = { ...next, opacity: o };
  }
  return next;
}

/** Мировые позиции восьми resize handle вокруг прямоугольника. */
function handlePoints(r: Rect): Record<HandleId, Pt> {
  const { x, y, w, h } = r;
  return {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
  };
}

/** Дистанция от точки `p` до сегмента a, b (мировые единицы). */
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}


function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    t.isContentEditable
  );
}
