// src/editor2026/blocks/whiteboard/model.ts
//
// Чистая модель данных + геометрия для самописной бесконечной доски.
// Без рендеринга, без React , только шейпы, математика камеры, bounds,
// хит-тестинг.

export type Pt = { x: number; y: number };

/** Камера: screen = world * zoom + (x,y). */
export type Camera = { x: number; y: number; zoom: number };

export type Tool =
  | "select"
  | "pan"
  | "pen"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  // ── инструменты флоучарта (Стадия 2/3) ──
  | "db" // узел базы данных (цилиндр, SQL редактируется в оверлее, не на канвасе)
  | "action" // узел процесса / решения
  | "note" // узел-заметка (связываемая карточка, заменяет старый freeform sticky)
  | "link"; // связь между двумя якорями узлов (в стиле draw.io)

export type Shape = (
  | { id: string; type: "pen"; color: string; sw: number; points: Pt[] }
  | { id: string; type: "rect"; color: string; sw: number; x: number; y: number; w: number; h: number; fill: string }
  | { id: string; type: "ellipse"; color: string; sw: number; x: number; y: number; w: number; h: number; fill: string }
  | { id: string; type: "arrow"; color: string; sw: number; x1: number; y1: number; x2: number; y2: number }
  | { id: string; type: "text"; color: string; sw: number; x: number; y: number; text: string; size: number }
  // ── узлы флоучарта (Стадия 2). Все прямоугольные {x,y,w,h}, чтобы система
  //    якорей/граней могла обрабатывать их единообразно через isNodeShape()/nodeRect(). ──
  | DbNode
  | ActionNode
  | NoteNode
) & {
  /** Заблокированные шейпы нельзя двигать, менять размер или удалять до
   *  разблокировки (через контекстное меню). Опционально для совместимости
   *  со старыми снимками. */
  locked?: boolean;
  /** Прозрачность шейпа, 0..1 (по умолчанию 1). */
  opacity?: number;
};

/**
 * Узел базы данных. Рендерится как цилиндр с `title` , SQL `query` не
 * рисуется, он редактируется в плавающем React-оверлее при активации
 * узла (клике инструментом select).
 */
export type DbNode = {
  id: string;
  type: "db";
  x: number;
  y: number;
  w: number;
  h: number;
  title: string; // короткое имя таблицы/сущности на цилиндре
  query: string; // SQL, не рендерится на канвасе
  color: string; // обводка / акцент
  fill: string; // заливка тела
  sw: number; // толщина обводки (оставлено для универсального кода шейпов)
  textColor?: string; // явный цвет заголовка (иначе авто-контраст от заливки)
};

/**
 * Узел действия , шаг процесса (`variant:"process"`, прямоугольник со
 * скруглёнными углами) или ветка (`variant:"decision"`, ромб). Рендерит
 * короткий `label` + иконку шестерёнки.
 */
export type ActionNode = {
  id: string;
  type: "action";
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  variant: "process" | "decision";
  color: string;
  fill: string;
  sw: number;
  textColor?: string; // явный цвет лейбла (иначе авто-контраст от заливки)
};

/** Узел-заметка , связываемая карточка с описанием (отличается от freeform sticky). */
export type NoteNode = {
  id: string;
  type: "note";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  fill: string;
  sw: number;
  textColor?: string; // явный цвет текста (иначе авто-контраст от заливки)
};

/** Четыре якорные точки, которые каждый узел предоставляет для связей. */
export type AnchorSide = "top" | "right" | "bottom" | "left";

/**
 * Направленная связь между двумя якорями узлов (в стиле draw.io). Концы
 * хранятся как ссылки (nodeId, side), а не абсолютные точки, поэтому грань
 * автоматически перестраивается при движении или изменении размера узла.
 */
export type Edge = {
  id: string;
  from: string; // id исходного узла
  fromSide: AnchorSide;
  to: string; // id целевого узла
  toSide: AnchorSide;
  color: string;
  routing: "orthogonal" | "bezier";
  label?: string;
  /** Позиция лейбла вдоль пути как доля длины дуги (0..1).
   *  По умолчанию 0.5 (середина), пользователь может перетащить лейбл-чип. */
  labelT?: number;
};

export type Board = { shapes: Shape[]; edges: Edge[]; camera: Camera };

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function emptyBoard(): Board {
  return { shapes: [], edges: [], camera: { ...DEFAULT_CAMERA } };
}

export const DB_NODE_W = 150;
export const DB_NODE_H = 96;
export const ACTION_NODE_W = 168;
export const ACTION_NODE_H = 84;
export const DECISION_NODE_W = 150;
export const DECISION_NODE_H = 110;
export const NOTE_NODE_W = 200;
export const NOTE_NODE_H = 120;
/** Расстояние (мировые единицы, до зума), в пределах которого якорь "хватает" указатель. */
export const ANCHOR_HIT_R = 12;
export const ANCHOR_SIDES: readonly AnchorSide[] = [
  "top",
  "right",
  "bottom",
  "left",
];

export function rid(): string {
  return crypto.randomUUID();
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function parseBoard(raw: string | undefined | null): Board {
  if (!raw) return emptyBoard();
  try {
    const b = JSON.parse(raw) as Partial<Board>;
    if (!b || !Array.isArray(b.shapes)) return emptyBoard();
    const cam = b.camera;
    const camera: Camera =
      cam && typeof cam.zoom === "number" && typeof cam.x === "number"
        ? { x: cam.x, y: cam.y, zoom: clampZoom(cam.zoom) }
        : { ...DEFAULT_CAMERA };
    // `edges` добавлен после первых досок , по умолчанию [], чтобы старые
    // снимки (только shapes) открывались без изменений.
    const edges = Array.isArray(b.edges) ? (b.edges as Edge[]) : [];
    // Миграция старых sticky в note (инструмент sticky убран, note покрывает
    // тот же функционал). Остальные шейпы проходят как есть.
    const shapes = (b.shapes as unknown[]).map(migrateShape);
    return { shapes, edges, camera };
  } catch {
    return emptyBoard();
  }
}

export function serializeBoard(b: Board): string {
  return JSON.stringify(b);
}

function numOr(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

/**
 * Миграция распарсенного шейпа. Старые `sticky` становятся `note` (инструмент
 * sticky убран, note покрывает ту же потребность), сохраняя текст, позицию,
 * размер и тёплую заливку. Остальные шейпы проходят без изменений.
 */
function migrateShape(raw: unknown): Shape {
  const r = raw as { type?: string; [k: string]: unknown };
  if (r && r.type === "sticky") {
    return {
      id: typeof r.id === "string" ? r.id : rid(),
      type: "note",
      x: numOr(r.x, 0),
      y: numOr(r.y, 0),
      w: numOr(r.w, NOTE_NODE_W),
      h: numOr(r.h, NOTE_NODE_H),
      text: typeof r.text === "string" ? r.text : "",
      color: "rgba(0,0,0,0.22)",
      fill: typeof r.fill === "string" ? r.fill : "#fde68a",
      sw: numOr(r.sw, 1.25),
    };
  }
  return raw as Shape;
}

// ── математика камеры ──────────────────────────────────────────────────
export function screenToWorld(p: Pt, cam: Camera): Pt {
  return { x: (p.x - cam.x) / cam.zoom, y: (p.y - cam.y) / cam.zoom };
}
export function worldToScreen(p: Pt, cam: Camera): Pt {
  return { x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y };
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function shapeBounds(s: Shape): Bounds {
  switch (s.type) {
    case "pen": {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      if (!s.points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return { minX, minY, maxX, maxY };
    }
    case "arrow":
      return {
        minX: Math.min(s.x1, s.x2),
        minY: Math.min(s.y1, s.y2),
        maxX: Math.max(s.x1, s.x2),
        maxY: Math.max(s.y1, s.y2),
      };
    case "rect":
    case "ellipse":
    case "db":
    case "action":
    case "note":
      return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h };
    case "text":
      return {
        minX: s.x,
        minY: s.y,
        maxX: s.x + Math.max(20, s.text.length * s.size * 0.58),
        maxY: s.y + s.size * 1.3,
      };
  }
}

export function boardBounds(shapes: readonly Shape[]): Bounds | null {
  if (!shapes.length) return null;
  let b = shapeBounds(shapes[0]);
  for (let i = 1; i < shapes.length; i++) {
    const o = shapeBounds(shapes[i]);
    b = {
      minX: Math.min(b.minX, o.minX),
      minY: Math.min(b.minY, o.minY),
      maxX: Math.max(b.maxX, o.maxX),
      maxY: Math.max(b.maxY, o.maxY),
    };
  }
  return b;
}

// ── хит-тестинг (самый верхний шейп под мировой точкой) ────────────────
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function insideBounds(b: Bounds, p: Pt, tol: number): boolean {
  return (
    p.x >= b.minX - tol &&
    p.x <= b.maxX + tol &&
    p.y >= b.minY - tol &&
    p.y <= b.maxY + tol
  );
}

function hits(s: Shape, p: Pt, tol: number): boolean {
  switch (s.type) {
    case "rect":
    case "ellipse":
    case "text":
    case "db":
    case "action":
    case "note":
      return insideBounds(shapeBounds(s), p, tol);
    case "arrow":
      return (
        distToSegment(p, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }) <=
        tol + s.sw
      );
    case "pen": {
      for (let i = 1; i < s.points.length; i++) {
        if (distToSegment(p, s.points[i - 1], s.points[i]) <= tol + s.sw) {
          return true;
        }
      }
      return s.points.length === 1
        ? Math.hypot(p.x - s.points[0].x, p.y - s.points[0].y) <= tol + s.sw
        : false;
    }
  }
}

export function hitTest(shapes: Shape[], p: Pt, tol: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (hits(shapes[i], p, tol)) return shapes[i];
  }
  return null;
}

export function translateShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case "pen":
      return { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "arrow":
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case "rect":
    case "ellipse":
    case "text":
    case "db":
    case "action":
    case "note":
      return { ...s, x: s.x + dx, y: s.y + dy };
  }
}

/** Связываемый узел флоучарта (db / action / note). */
export type NodeShape = DbNode | ActionNode | NoteNode;

/** Сужает шейп до связываемого узла. Только db/action/note участвуют в
 *  системе якорей/граней; rect/ellipse/sticky , простые примитивы рисования. */
export function isNodeShape(s: Shape): s is NodeShape {
  return s.type === "db" || s.type === "action" || s.type === "note";
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Мировой бокс связываемого узла или null для не-узловых шейпов. */
export function nodeRect(s: Shape): Rect | null {
  return isNodeShape(s) ? { x: s.x, y: s.y, w: s.w, h: s.h } : null;
}

/** Мировая точка якоря узла на указанной стороне (середина ребра). */
export function anchorPoint(r: Rect, side: AnchorSide): Pt {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2, y: r.y };
    case "right":
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 };
  }
}

/** Найти узел по id (только связываемые узлы). */
export function findNode(shapes: Shape[], id: string): NodeShape | null {
  for (const s of shapes) {
    if (s.id === id && isNodeShape(s)) return s;
  }
  return null;
}
