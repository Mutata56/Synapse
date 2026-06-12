// src/editor2026/blocks/whiteboard/routing.ts
//
// Мозг геометрии коннекторов , умный роутинг в стиле draw.io для самописной
// доски. Чистая математика: без канваса, без React, без I/O. Все координаты
// мировые; вызывающий сам делит размеры, постоянные на экране (наконечники
// и т.д.), на cam.zoom.
//
// Задумано как детерминированное и лёгкое по аллокациям: эти функции
// запускаются каждый кадр для каждой грани, поэтому каждая возвращает только
// маленький результат и по возможности избегает замыканий/промежуточных
// массивов.

import { ANCHOR_SIDES, anchorPoint } from "./model";
import type { AnchorSide, Pt, Rect } from "./model";

/** Длина штыря (мировые единицы), выталкиваемого прямо из якоря до того,
 *  как коннектору разрешено сгибаться , чтобы линия чисто входила/выходила
 *  из бокса. */
const STUB = 20;

/** Полуугол барбов наконечника, в радианах (~25.8°). */
const ARROW_HALF_ANGLE = 0.45;

/** Натяжение контрольных точек Безье как доля расстояния между концами. */
const BEZIER_PULL_FACTOR = 0.42;
/** Клип натяжения контрольных точек Безье (мировые единицы). */
const BEZIER_PULL_MIN = 28;
const BEZIER_PULL_MAX = 160;

/** Точки ближе этого порога (мировые единицы) считаются одинаковыми при
 *  сворачивании коллинеарных/дублирующихся вершин в ортогональном роутинге. */
const EPS = 0.01;

/**
 * Единичная наружная нормаль стороны якоря.
 * top = (0,-1), right = (1,0), bottom = (0,1), left = (-1,0).
 *
 * (Экранная/мировая y растёт вниз, поэтому "top" смотрит в отрицательный y.)
 */
export function sideNormal(side: AnchorSide): Pt {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "right":
      return { x: 1, y: 0 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
  }
}

/** Четыре мировые точки якорей прямоугольника, по сторонам. */
export function anchorsOf(r: Rect): Record<AnchorSide, Pt> {
  return {
    top: anchorPoint(r, "top"),
    right: anchorPoint(r, "right"),
    bottom: anchorPoint(r, "bottom"),
    left: anchorPoint(r, "left"),
  };
}

/**
 * Ближайший якорь прямоугольника `r` к мировой точке `p`. Используется
 * инструментом link для привязки и для обратной связи при наведении.
 * Возвращает сторону, мировую точку и евклидово расстояние от `p`.
 */
export function nearestAnchor(
  r: Rect,
  p: Pt,
): { side: AnchorSide; point: Pt; dist: number } {
  let bestSide: AnchorSide = ANCHOR_SIDES[0];
  let bestPoint: Pt = anchorPoint(r, bestSide);
  let bestDist = Math.hypot(p.x - bestPoint.x, p.y - bestPoint.y);
  for (let i = 1; i < ANCHOR_SIDES.length; i++) {
    const side = ANCHOR_SIDES[i];
    const point = anchorPoint(r, side);
    const dist = Math.hypot(p.x - point.x, p.y - point.y);
    if (dist < bestDist) {
      bestSide = side;
      bestPoint = point;
      bestDist = dist;
    }
  }
  return { side: bestSide, point: bestPoint, dist: bestDist };
}

/**
 * Автоматически выбирает лучшую пару (fromSide, toSide) для грани между
 * двумя прямоугольниками.
 *
 * Оценивает все комбинации сторон по качеству роутинга: якори, чьи наружные
 * нормали смотрят друг на друга (скалярное произведение нормали с направлением
 * между якорями), сильно предпочитаются, с тай-брейком по расстоянию.
 * Результат , пара, через которую линия входит/выходит каждой фигуры наиболее
 * естественно.
 */
export function autoSides(
  a: Rect,
  b: Rect,
): { fromSide: AnchorSide; toSide: AnchorSide } {
  const aAnchors = anchorsOf(a);
  const bAnchors = anchorsOf(b);

  let bestFrom: AnchorSide = "right";
  let bestTo: AnchorSide = "left";
  let bestScore = -Infinity;

  for (const fromSide of ANCHOR_SIDES) {
    const fp = aAnchors[fromSide];
    const fn = sideNormal(fromSide);
    for (const toSide of ANCHOR_SIDES) {
      const tp = bAnchors[toSide];
      const dx = tp.x - fp.x;
      const dy = tp.y - fp.y;
      const dist = Math.hypot(dx, dy);
      const inv = dist > EPS ? 1 / dist : 0;
      // Единичное направление от исходного якоря к целевому.
      const ux = dx * inv;
      const uy = dy * inv;
      const tn = sideNormal(toSide);
      // Нормаль исходного должна совпадать с направлением движения;
      // нормаль целевого , противоречить (коннектор влетает в грань).
      const facing = fn.x * ux + fn.y * uy - (tn.x * ux + tn.y * uy);
      // Facing доминирует; ближайшие якори разрешают ничью. Коэффициент
      // расстояния мал, чтобы никогда не перебивал явно лучшую пару.
      const score = facing * 1000 - dist;
      if (score > bestScore) {
        bestScore = score;
        bestFrom = fromSide;
        bestTo = toSide;
      }
    }
  }
  return { fromSide: bestFrom, toSide: bestTo };
}

/** Выталкивает точку из якоря наружу по нормали его стороны на STUB. */
function stubPoint(p: Pt, side: AnchorSide): Pt {
  const n = sideNormal(side);
  return { x: p.x + n.x * STUB, y: p.y + n.y * STUB };
}

/** true, если сторона горизонтальная (left/right), а не вертикальная (top/bottom). */
function isHorizontal(side: AnchorSide): boolean {
  return side === "left" || side === "right";
}

/** Добавляет `p` в `out`, если это не дубликат и не коллинеарная точка
 *  с предыдущими двумя , держит полилинию минималистичной для чистых
 *  скруглённых соединений. */
function pushClean(out: Pt[], p: Pt): void {
  const n = out.length;
  if (n > 0) {
    const prev = out[n - 1];
    if (Math.abs(prev.x - p.x) < EPS && Math.abs(prev.y - p.y) < EPS) {
      return; // дубликат
    }
    if (n > 1) {
      const prev2 = out[n - 2];
      // Тест коллинеарности для осевыравненных сегментов: убираем среднюю
      // точку, когда prev2, prev, p идёт прямо по x или по y.
      const sameX =
        Math.abs(prev2.x - prev.x) < EPS && Math.abs(prev.x - p.x) < EPS;
      const sameY =
        Math.abs(prev2.y - prev.y) < EPS && Math.abs(prev.y - p.y) < EPS;
      if (sameX || sameY) {
        out[n - 1] = p; // заменяем лишнюю среднюю точку
        return;
      }
    }
  }
  out.push(p);
}

/**
 * ОРТОГОНАЛЬНЫЙ роутинг: упорядоченная полилиния в мировых координатах
 * от исходного якоря к целевому, используя только горизонтальные/вертикальные
 * сегменты (повороты на 90°), в стиле draw.io.
 *
 * Коннектор сначала выталкивает короткий штырь из каждого якоря наружу,
 * потом соединяет два конца штыря L- или Z-образным путём, где локоть
 * выбирается по ориентации сторон:
 *   - противоположные стороны (например right/left) - Z через середину штырей;
 *   - перпендикулярные стороны - одиночный L через естественный локоть;
 *   - одна и та же сторона - обход за оба штыря.
 *
 * Первая точка , ровно `from`, последняя , ровно `to`. Дублирующие и
 * коллинеарные вершины сворачиваются, чтобы скруглённые соединения рендера
 * оставались чёткими.
 */
export function routeOrthogonal(
  from: Pt,
  fromSide: AnchorSide,
  to: Pt,
  toSide: AnchorSide,
): Pt[] {
  const s = stubPoint(from, fromSide);
  const e = stubPoint(to, toSide);
  const out: Pt[] = [from];
  pushClean(out, s);

  const fromH = isHorizontal(fromSide);
  const toH = isHorizontal(toSide);

  if (fromH === toH) {
    // ── Параллельные стороны (обе горизонтальные или обе вертикальные). ──
    if (fromSide === toSide) {
      // ОДНА СТОРОНА - обход вокруг: оба штыря удлиняются до крайних
      // точек, потом один поперечный сегмент соединяет их.
      if (fromH) {
        // left/left или right/right - локоть x, это крайний x штыря.
        const ex =
          fromSide === "right" ? Math.max(s.x, e.x) : Math.min(s.x, e.x);
        pushClean(out, { x: ex, y: s.y });
        pushClean(out, { x: ex, y: e.y });
      } else {
        const ey =
          fromSide === "bottom" ? Math.max(s.y, e.y) : Math.min(s.y, e.y);
        pushClean(out, { x: s.x, y: ey });
        pushClean(out, { x: e.x, y: ey });
      }
    } else {
      // ПРОТИВОПОЛОЖНЫЕ стороны - Z-сгиб через середину между штырями.
      if (fromH) {
        const mx = (s.x + e.x) / 2;
        pushClean(out, { x: mx, y: s.y });
        pushClean(out, { x: mx, y: e.y });
      } else {
        const my = (s.y + e.y) / 2;
        pushClean(out, { x: s.x, y: my });
        pushClean(out, { x: e.x, y: my });
      }
    }
  } else {
    // ── Перпендикулярные стороны - одиночный L. Локоть берёт x от
    //    горизонтального штыря и y от вертикального, поэтому сгиб
    //    находится там, где сходятся два направления штырей. ──
    const elbow: Pt = fromH ? { x: e.x, y: s.y } : { x: s.x, y: e.y };
    pushClean(out, elbow);
  }

  pushClean(out, e);
  pushClean(out, to);
  return out;
}

/**
 * BEZIER роутинг: кубические контрольные точки, вытянутые из каждого якоря
 * наружу по нормали. Длина натяжения пропорциональна расстоянию между концами
 * (короткие связи сгибаются мягко, длинные , широко) и клипается в приятный
 * диапазон. Концы кривой , `from` и `to`, возвращает только две контрольные
 * точки (`c1` для `from`/`fromSide`, `c2` для `to`/`toSide`).
 */
export function routeBezier(
  from: Pt,
  fromSide: AnchorSide,
  to: Pt,
  toSide: AnchorSide,
): { c1: Pt; c2: Pt } {
  const gap = Math.hypot(to.x - from.x, to.y - from.y);
  const pull = Math.max(
    BEZIER_PULL_MIN,
    Math.min(BEZIER_PULL_MAX, gap * BEZIER_PULL_FACTOR),
  );
  const fn = sideNormal(fromSide);
  const tn = sideNormal(toSide);
  return {
    c1: { x: from.x + fn.x * pull, y: from.y + fn.y * pull },
    c2: { x: to.x + tn.x * pull, y: to.y + tn.y * pull },
  };
}

/**
 * Треугольник наконечника на кончике. `dir` , единичный вектор, смотрящий
 * В кончик (направление движения коннектора при приближении); `size` , desired
 * длина барба. Вызывающие передают `size / cam.zoom` для постоянного размера
 * на экране.
 *
 * Возвращает две точки барбов; залитый треугольник , `[tip, b1, b2]`. Барбы
 * , это `tip` минус `dir`, повёрнутый на ±ARROW_HALF_ANGLE, масштабированный
 * на `size`. Если `degenerate` (нулевая длина), барбы схлопываются в `tip`.
 */
export function arrowHead(
  tip: Pt,
  dir: Pt,
  size: number,
): { b1: Pt; b2: Pt } {
  // Нормализуем dir на всякий случай; обычно передают единичный вектор,
  // но при перетаскивании концы могут совпадать.
  const len = Math.hypot(dir.x, dir.y);
  if (len < EPS) {
    return { b1: { x: tip.x, y: tip.y }, b2: { x: tip.x, y: tip.y } };
  }
  const ux = dir.x / len;
  const uy = dir.y / len;
  const cos = Math.cos(ARROW_HALF_ANGLE);
  const sin = Math.sin(ARROW_HALF_ANGLE);

  // Вектор от кончика назад вдоль коннектора.
  const bx = -ux * size;
  const by = -uy * size;

  // Поворачиваем обратный вектор на +/- полуугол, чтобы раздвинуть два барба.
  const b1: Pt = {
    x: tip.x + (bx * cos - by * sin),
    y: tip.y + (bx * sin + by * cos),
  };
  const b2: Pt = {
    x: tip.x + (bx * cos + by * sin),
    y: tip.y + (-bx * sin + by * cos),
  };
  return { b1, b2 };
}

// ── хелперы параметра пути (общие для рендера и движка) ───────────────
// Лейбл грани сидит на доле длины дуги `t` (0..1) вдоль коннектора.
// Использование длины дуги (а не сырых параметров Безье) гарантирует точность
// "поставь лейбл туда, где я его бросил" для обоих роутингов: рендерер рисует
// чип на pointAtFraction(path, t), движок маппит drag обратно через
// nearestFraction.

/** Сэмплирует кубический Безье в `n+1` точек, чтобы кривую можно было
 *  обработать как полилинию для расчёта длины дуги и хит-тестинга. */
export function sampleCubic(
  p0: Pt,
  c1: Pt,
  c2: Pt,
  p1: Pt,
  n: number,
): Pt[] {
  const out: Pt[] = [];
  const steps = Math.max(1, n);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push({
      x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
      y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
    });
  }
  return out;
}

/** Точка на полилинии на доле длины дуги `t` (0..1). */
export function pointAtFraction(pts: Pt[], t: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
  const clamped = Math.max(0, Math.min(1, t));
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  if (total === 0) return { x: pts[0].x, y: pts[0].y };
  const target = clamped * total;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= target) {
      const f = seg === 0 ? 0 : (target - acc) / seg;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      };
    }
    acc += seg;
  }
  return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
}

/** Доля длины дуги (0..1) точки на полилинии, ближайшей к `p`. */
export function nearestFraction(pts: Pt[], p: Pt): number {
  if (pts.length < 2) return 0;
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(total);
  }
  if (total === 0) return 0;
  let best = Infinity;
  let bestLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let f = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    f = Math.max(0, Math.min(1, f));
    const cx = a.x + f * dx;
    const cy = a.y + f * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) {
      best = d;
      bestLen = cum[i - 1] + f * Math.sqrt(len2);
    }
  }
  return bestLen / total;
}
