/**
 * 2D-геометрия для оболочек кластеров: выпуклая оболочка, раздувание полигона
 * (приближение суммы Минковского) и замкнутый Catmull-Rom сплайн. Всё чистое,
 * без зависимостей. GraphView рисует этим плавный полупрозрачный контур
 * "острова" за кластером папки при наведении.
 */

export type Pt = { x: number; y: number };

/**
 * Выпуклая оболочка методом монотонной цепочки Эндрю, O(n log n). Возвращает
 * оболочку как кольцо против часовой стрелки (без повтора первой/последней
 * точки). Вход меньше 3 точек отдаём как есть.
 */
export function convexHull(pts: Pt[]): Pt[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Pt[] = [];
  for (const pt of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0
    ) {
      lower.pop();
    }
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const pt = p[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0
    ) {
      upper.pop();
    }
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Раздувает выпуклый полигон наружу на `pad` (сумма Минковского полигона с
 * диском радиуса `pad`). Приближаем, толкая каждую вершину вдоль биссектрисы
 * двух нормалей соседних рёбер, так смещённые рёбра остаются параллельны
 * исходным. Держит оболочку подальше от дисков узлов, которые она обводит.
 */
export function inflate(hull: Pt[], pad: number): Pt[] {
  const n = hull.length;
  if (n < 3) return hull.slice();

  // Работаем с CCW-копией, чтобы "наружу" было однозначным.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
  }
  const poly = area < 0 ? hull.slice().reverse() : hull;

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];

    // Внешние нормали двух рёбер, сходящихся в `cur` (для CCW это (dy, -dx)).
    let n1x = cur.y - prev.y;
    let n1y = -(cur.x - prev.x);
    let n2x = next.y - cur.y;
    let n2y = -(next.x - cur.x);
    const l1 = Math.hypot(n1x, n1y) || 1;
    const l2 = Math.hypot(n2x, n2y) || 1;
    n1x /= l1;
    n1y /= l1;
    n2x /= l2;
    n2y /= l2;

    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;

    // Сдвиг вдоль биссектрисы, чтобы рёбра отстояли на `pad`. Зажимаем множитель
    // 1/cos, иначе очень острые углы улетят в бесконечность.
    const dot = Math.max(0.35, bx * n1x + by * n1y);
    const d = pad / dot;
    out.push({ x: cur.x + bx * d, y: cur.y + by * d });
  }
  return out;
}

/**
 * Замкнутый Catmull-Rom сплайн через вершины полигона: даёт мягкие, "жидкие"
 * границы вместо острых углов. На каждый сегмент выдаём `samples` точек.
 * (Равномерный Catmull-Rom, для выпуклой раздутой оболочки хватает.)
 */
export function catmullRom(pts: Pt[], samples = 10): Pt[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}
