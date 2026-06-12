// src/editor2026/blocks/whiteboard/render.ts
//
// Чистый Canvas-2D рендеринг для самописной бесконечной доски. Без React,
// без состояния движка , просто функции, принимающие контекст + данные
// и рисующие.

// ── СОГЛАШЕНИЕ ПО КООРИДНАТНОМУ ПРОСТРАНСТВУ (читай перед правками движка) ──
//   -  drawDotGrid работает в ЭКРАННОМ пространстве. Движок вызывает его
//     с трансформом, сброшенным на DPR (ctx.setTransform(dpr,0,0,dpr,0,0)).
//     Позиции точек считаем сами из камеры. Причина: рисовать сетку в мировых
//     координатах при отдалении потребует огромного цикла, а при приближении
//     1px-точка превращается в жирное пятно. Экранные координаты дают
//     постоянный чёткий радиус точки при любом зуме.
//
//   -  drawShape / drawSelectionBox работают в МИРОВЫХ координатах. Перед
//     вызовом движок ОБЯЗАН применить камеру: cam.applyToCtx(ctx, dpr),
//     чтобы контекст маппил мир в device пиксели (DPR * zoom + DPR * translate).
//     Шейпы рисуются по мировым координатам. Поскольку контекст масштабирован
//     через zoom, любое значение, которое должно выглядеть постоянным на экране
//     (толщины обводки селекции, геометрия стрелок, размеры хэндлов), делится
//     на cam.zoom. Толщины обводки шейпов (sw) задаются в мировых единицах
//     и масштабируются вместе с зумом , это ожидаемое поведение "чернил
//     на холсте".
//
//   -  smoothFreehand возвращает Path2D в МИРОВЫХ координатах (тот же space,
//     в котором захватываются точки пера), поэтому компонируется с мировым
//     трансформом.

import type { Bounds, Pt, Shape } from "./model";
import type { WhiteboardCamera } from "./camera";

// ── настраиваемые параметры ────────────────────────────────────────────
const GRID_BASE = 28; // базовое расстояние между точками в мировых единицах при zoom = 1
const GRID_DOT_R = 1.1; // радиус точки в экранных пикселях (css px)
const GRID_COLOR = "rgba(255,255,255,0.16)";
// Адаптивная сетка: мировой шаг привязывается к GRID_BASE × GRID_STEP_FACTOR^k,
// чтобы экранный шаг всегда был в [GRID_MIN_SCREEN, GRID_MAX_SCREEN] px.
// Это держит количество точек ограниченным при любом зуме, иначе при отдалении
// экранный шаг уменьшается и количество точек взрывается до десятков тысяч.
const GRID_MIN_SCREEN = 24;
const GRID_MAX_SCREEN = 120;
const GRID_STEP_FACTOR = 5;
const ARROW_HEAD = 13; // длина наконечника стрелки в экранных пикселях
const ARROW_SPREAD = 0.42; // полуугол наконечника (радианы)

// ──────────────────────────────────────────────────────────────────────────────
// Точечная сетка (ЭКРАННОЕ пространство). Движок сбрасывает трансформ
// на DPR перед вызовом: ctx.setTransform(dpr,0,0,dpr,0,0).
// ──────────────────────────────────────────────────────────────────────────────
export function drawDotGrid(
  ctx: CanvasRenderingContext2D,
  cam: WhiteboardCamera,
  cssW: number,
  cssH: number,
  _dpr: number,
): void {
  const zoom = cam.zoom || 1;
  // Выбираем адаптивный мировой шаг, чтобы экранный попал в комфортную зону,
  // привязываясь степенями GRID_STEP_FACTOR. Конечное число итераций.
  let worldSpacing = GRID_BASE;
  let step = worldSpacing * zoom;
  if (step > 0) {
    while (step < GRID_MIN_SCREEN) {
      worldSpacing *= GRID_STEP_FACTOR;
      step = worldSpacing * zoom;
    }
    while (step > GRID_MAX_SCREEN) {
      worldSpacing /= GRID_STEP_FACTOR;
      step = worldSpacing * zoom;
    }
  }
  if (!Number.isFinite(step) || step <= 0) return;

  // Мировая координата левого верхнего видимого угла.
  const topLeft = cam.screenToWorld(0, 0);
  // Первая сеточная точка (в мировых единицах) на или до левого/верхнего края.
  const startWorldX = Math.floor(topLeft.x / worldSpacing) * worldSpacing;
  const startWorldY = Math.floor(topLeft.y / worldSpacing) * worldSpacing;
  // Конвертируем в экранную позицию, потом шагаем по step.
  const first = cam.worldToScreen(startWorldX, startWorldY);

  ctx.save();
  ctx.fillStyle = GRID_COLOR;
  const r = GRID_DOT_R;
  const twoPi = Math.PI * 2;

  // Все точки в одном пути - одна команда fill, гораздо быстрее чем по точке.
  ctx.beginPath();
  for (let sx = first.x; sx <= cssW + step; sx += step) {
    if (sx < -step) continue;
    for (let sy = first.y; sy <= cssH + step; sy += step) {
      if (sy < -step) continue;
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, twoPi);
    }
  }
  ctx.fill();
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────────────
// Сглаживание freehand: сплайн Кэтмулл-Ром через захваченные точки,
// конвертированный в кубические bezier-сегменты, чтобы штрих был
// непрерывным и органичным, а не полилинией из прямых хорд. Возвращает
// Path2D в мировых координатах.
// ──────────────────────────────────────────────────────────────────────────────
export function smoothFreehand(points: Pt[]): Path2D {
  const path = new Path2D();
  const n = points.length;
  if (n === 0) return path;

  if (n === 1) {
    // Один тап - крошечная точка, чтобы штрих был виден.
    const p = points[0];
    path.moveTo(p.x, p.y);
    path.arc(p.x, p.y, 0.01, 0, Math.PI * 2);
    return path;
  }
  if (n === 2) {
    path.moveTo(points[0].x, points[0].y);
    path.lineTo(points[1].x, points[1].y);
    return path;
  }

  // Кэтмулл-Ром в Безье. Для каждого сегмента p1, p2 вычисляем контрольные
  // точки из соседних p0 и p3 (на концах клипаем).
  path.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < n ? i + 2 : n - 1];

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    path.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
  return path;
}

// ──────────────────────────────────────────────────────────────────────────────
// Рендеринг шейпов (МИРОВЫЕ координаты, ctx уже трансформирован камерой).
// ──────────────────────────────────────────────────────────────────────────────
export function drawShape(
  ctx: CanvasRenderingContext2D,
  s: Shape,
  cam: WhiteboardCamera,
): void {
  const z = cam.zoom || 1;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (s.type) {
    case "pen": {
      if (!s.points.length) break;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.sw;
      ctx.stroke(smoothFreehand(s.points));
      break;
    }

    case "rect": {
      if (s.fill && s.fill !== "none" && s.fill !== "transparent") {
        ctx.fillStyle = s.fill;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.sw;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      break;
    }

    case "ellipse": {
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      const rx = Math.abs(s.w / 2);
      const ry = Math.abs(s.h / 2);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (s.fill && s.fill !== "none" && s.fill !== "transparent") {
        ctx.fillStyle = s.fill;
        ctx.fill();
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.sw;
      ctx.stroke();
      break;
    }

    case "arrow": {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.sw;
      // Стержень.
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      // Наконечник , размер в экранных пикселях (÷z), чтобы пропорция
      // на экране оставалась постоянной.
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const head = (ARROW_HEAD + s.sw * 1.5) / z;
      const a1 = ang - ARROW_SPREAD;
      const a2 = ang + ARROW_SPREAD;
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(a1), s.y2 - head * Math.sin(a1));
      ctx.lineTo(s.x2 - head * Math.cos(a2), s.y2 - head * Math.sin(a2));
      ctx.closePath();
      ctx.fill();
      break;
    }

    case "text": {
      ctx.fillStyle = s.color;
      ctx.textBaseline = "top";
      ctx.font = fontFor(s.size);
      const lines = s.text.length ? s.text.split("\n") : [""];
      const lh = s.size * 1.3;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], s.x, s.y + i * lh);
      }
      break;
    }

  }

  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────────────
// Селекция (МИРОВЫЕ координаты, ctx уже трансформирован камерой). Все
// размеры, постоянные на экране, делятся на zoom.
// ──────────────────────────────────────────────────────────────────────────────
export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  b: Bounds,
  cam: WhiteboardCamera,
  subtle = false,
): void {
  const z = cam.zoom || 1;
  const pad = (subtle ? 2.5 : 3) / z;
  const x = b.minX - pad;
  const y = b.minY - pad;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  const r = Math.min(6 / z, w / 2, h / 2);

  ctx.save();
  selectionRoundRect(ctx, x, y, w, h, r);
  if (subtle) {
    // Тихая обводка отдельного шейпа внутри мульти-селекции.
    ctx.strokeStyle = "rgba(165,180,252,0.40)";
    ctx.lineWidth = 1 / z;
    ctx.stroke();
  } else {
    // Мягкий акцент-глоу под чёткой hairline-линией , чисто и премиально,
    // без "марширующих муравьёв". Угловые хэндлы рисуются отдельно
    // (drawResizeHandles).
    ctx.strokeStyle = "rgba(129,140,248,0.22)";
    ctx.lineWidth = 3.5 / z;
    ctx.stroke();
    ctx.strokeStyle = "#a5b4fc";
    ctx.lineWidth = 1.25 / z;
    ctx.stroke();
  }
  ctx.restore();
}

/** Подпуть скруглённого прямоугольника (для селекции). */
function selectionRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, r);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ── хелперы ───────────────────────────────────────────────────────────
function fontFor(px: number): string {
  return `${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
}
