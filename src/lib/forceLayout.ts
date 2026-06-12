/**
 * Силовой layout-движок для задачи n тел.
 *
 * На каждый узел на каждом шаге действуют пять сил:
 *
 *   1. Кулоновское отталкивание (каждая пара, одноимённые заряды):
 *          F = k_e · q_i · q_j / r², вдоль i к j (расталкивает).
 *      Считаем через quadtree Barnes-Hut (ниже), а не наивной суммой по всем парам.
 *
 *   2. Пружина ребра (длина покоя L), один из двух законов:
 *          линейный Гук:          F = −k_s · (r − L)
 *          логарифмический (Eades): F = −k_s · L · ln(r / L)
 *      Оба зануляются при r=L и расталкивают при сжатии; лог-закон для длинных
 *      рёбер растёт куда мягче, так что растянутые связи не "щёлкают" резинкой.
 *
 *   3. Анти-перекрытие (мягкая коллизия): короткодействующее линейное
 *      отталкивание, включается, только когда диски двух узлов пересекутся
 *      (r < R_i+R_j+pad):
 *          F = k_c · (minSep − r).
 *      Не даёт спрайтам слипаться; считается точно (всегда разрешается в листьях
 *      quadtree, ведь перекрытые узлы заведомо рядом).
 *
 *   4. Барицентрическая гравитация: слабое линейное притяжение к барицентру c,
 *      средней позиции активных узлов (а не к фиксированному началу мира):
 *          F = −k_g · (p − c)
 *      так несвязные куски держатся вместе, но layout инвариантен к сдвигу
 *      (Σ F = 0) и не уползает к фиксированной "магической точке".
 *
 *   5. Когезия кластера: члены общей группы (например папка и её заметки)
 *      чувствуют слабую пружину к барицентру группы, F = −k_cl · (p − g), так
 *      темы сгущаются в читаемые острова.
 *
 * Трение/сопротивление делаем через интегратор, а не отдельной силой: Verlet
 * хранит скорость неявно как (p − p_prev), и домножение этого члена на μ∈(0,1)
 * каждый шаг это ровно линейное вязкое затухание F_drag = −c·v.
 *
 * Интегрирование, Verlet без скорости (по позиции):
 *          p_next = p + (p − p_prev)·μ + (F/m)·dt²
 * Симплектичен и обратим во времени, так что сохраняет энергию куда лучше явного
 * Эйлера: layout плавно расслабляется, а не дрожит. `step()` возвращает суммарную
 * кинетическую энергию Σ‖v‖² (где v ≈ Δp/dt), по ней вызывающий понимает, что всё
 * "осело", и паркует симуляцию.
 *
 * ── Barnes-Hut ──────────────────────────────────────────────────────────────
 * Отталкивание это единственный all-pairs член, так что оно и доминирует по
 * стоимости. Quadtree рекурсивно делит пространство; каждая ячейка кэширует
 * суммарный заряд и взвешенный по заряду центр своих тел. При расчёте силы на
 * узел ячейку, чей угловой размер достаточно мал (s/d < θ, критерий принятия
 * мультиполя), берём как один псевдозаряд в центре масс, не раскрывая. Это
 * сводит стоимость на узел с O(n) к O(log n), и весь шаг выходит O(n log n)
 * вместо O(n²). θ меняет точность на скорость (θ к 0 даёт точный all-pairs,
 * больше θ это грубее/быстрее); θ≈0.8 хороший дефолт для layout. Дерево
 * пересобираем каждый шаг (позиции двигаются) из пула ячеек, так что в
 * установившемся режиме аллокаций ноль.
 */

export type PhysicsNode = {
  x: number;
  y: number;
  /** Прошлая позиция: Verlet хранит скорость неявно как (x − px). */
  px: number;
  py: number;
  /** Инерционная масса: a = F/m, так что тяжёлые (с большой степенью) узлы тянет к ядру. */
  mass: number;
  /** Заряд q в законе Кулона (и вес мультиполя в Barnes-Hut). */
  charge: number;
  /** Радиус диска для отрисовки: задаёт короткодействующую силу анти-перекрытия. */
  radius: number;
  /** Неактивен (например скрыт focus-режимом): исключён из всех сил, заморожен. */
  active: boolean;
  /** Закреплён (например его тащат): интегратор держит его на месте. */
  fixed: boolean;
};

export type PhysicsEdge = { a: number; b: number; rest: number };

export type ForceSettings = {
  repulsion: number; // k_e
  intraRepulsion: number; // доп. кулоновский толчок между членами ОДНОГО кластера (распускает папки)
  stiffness: number; // k_s
  springLog: boolean; // лог-закон пружины (Eades) вместо линейного Гука
  cohesion: number; // k_cl, притяжение к барицентру общего кластера
  interCluster: number; // сила отталкивания между центроидами кластеров (разнос островов)
  gravity: number; // k_g
  damping: number; // μ ∈ (0,1), трение Verlet (вязкое сопротивление)
  collision: number; // k_c, жёсткость анти-перекрытия
  theta: number; // угол раскрытия Barnes-Hut (критерий мультиполя)
  minDist: number; // нижний порог r для члена 1/r² (уходит от сингулярности)
  maxSpeed: number; // зажим ‖Δp‖/dt, держит явное интегрирование стабильным
  dt: number; // фиксированный шаг времени
};

export const DEFAULT_FORCE_SETTINGS: ForceSettings = {
  repulsion: 20000,
  intraRepulsion: 0, // по умолчанию выкл, опционально разводит узлы внутри одной папки
  stiffness: 0.08,
  springLog: true,
  cohesion: 0.09,
  interCluster: 10000, // разнос островов, открывает тёмные зазоры между папками (крутится слайдером)
  gravity: 0.025, // умеренное центрирование, папки собираются в одну связную массу
  damping: 0.9,
  collision: 0.7,
  theta: 0.8,
  minDist: 3,
  maxSpeed: 80,
  dt: 0.6,
};

/** Запас (px), добавляемый к R_i+R_j перед включением силы анти-перекрытия. */
const COLLIDE_PAD = 4;
/** Потолок рекурсии: защита от (почти) совпадающих тел, дробящихся бесконечно. */
const MAX_DEPTH = 48;

/**
 * Ячейка quadtree. Дети это индексы в пуле (−1 = нет); `body` это индекс тела
 * для листа с одним телом, иначе −1. Ячейка без тела и без детей, но с
 * положительной массой это "ведро": совпадающие тела, схлопнутые на MAX_DEPTH,
 * считаются одним псевдозарядом.
 */
type QuadCell = {
  cx: number;
  cy: number;
  h: number; // полуширина (ячейки квадратные)
  mass: number; // Σ заряд
  comX: number; // Σ заряд·x  (центр заряда = comX/mass)
  comY: number;
  body: number;
  c0: number;
  c1: number;
  c2: number;
  c3: number;
};

export class ForceLayout {
  readonly nodes: PhysicsNode[];
  readonly edges: PhysicsEdge[];
  /** Кластеры когезии: каждый это список индексов узлов, которых тянет к общему
   *  барицентру. Пусто = когезия выключена. */
  readonly groups: number[][];
  /** Id кластера на узел (−1 = нет). Отталкивание между разными кластерами
   *  масштабируется на `interCluster`, разводя острова. Null = один кластер. */
  readonly clusterId: Int32Array | null;
  settings: ForceSettings;

  private readonly fx: Float64Array;
  private readonly fy: Float64Array;
  private readonly X: Float64Array;
  private readonly Y: Float64Array;
  private readonly Q: Float64Array;
  private readonly clusterCount: number;
  private readonly cCx: Float64Array; // центроид по кластерам, пересчитываем каждый шаг
  private readonly cCy: Float64Array;
  private readonly cN: Float64Array;

  // Пул ячеек quadtree, каждый шаг сбрасываем (а не аллоцируем заново).
  private pool: QuadCell[] = [];
  private poolUsed = 0;
  // Переиспользуемый стек обхода (индексы ячеек).
  private stack: number[] = [];

  constructor(
    nodes: PhysicsNode[],
    edges: PhysicsEdge[],
    settings: ForceSettings = DEFAULT_FORCE_SETTINGS,
    groups: number[][] = [],
    clusterId: Int32Array | null = null,
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.settings = settings;
    this.groups = groups;
    this.clusterId = clusterId;
    const n = nodes.length;
    this.fx = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.X = new Float64Array(n);
    this.Y = new Float64Array(n);
    this.Q = new Float64Array(n);
    let cc = 0;
    if (clusterId) {
      for (let i = 0; i < clusterId.length; i++) {
        if (clusterId[i] + 1 > cc) cc = clusterId[i] + 1;
      }
    }
    this.clusterCount = cc;
    this.cCx = new Float64Array(cc);
    this.cCy = new Float64Array(cc);
    this.cN = new Float64Array(cc);
  }

  /** Двигает симуляцию на один шаг времени. Возвращает суммарную кинетическую энергию. */
  step(): number {
    const fx = this.fx;
    const fy = this.fy;
    fx.fill(0);
    fy.fill(0);

    // ── 1. Кулоновское отталкивание через Barnes-Hut ────────────────────────────
    const root = this.buildTree();
    if (root !== -1) {
      for (let i = 0; i < this.nodes.length; i++) {
        if (this.nodes[i].active) this.repulsionOn(i, root);
      }
    }

    // ── 2. Пружины рёбер (линейный Гук или лог Eades) ────────────
    const { stiffness, springLog, cohesion } = this.settings;
    const n = this.nodes;
    for (let e = 0; e < this.edges.length; e++) {
      const { a: ia, b: ib, rest } = this.edges[e];
      const a = n[ia];
      const b = n[ib];
      if (!a.active || !b.active) continue; // скрытый конец = нет пружины
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let r = Math.sqrt(dx * dx + dy * dy);
      if (r < 1e-9) r = 1e-9;
      // >0 растянуто, тянем вместе. Лог-закон насыщается на длинных рёбрах.
      const f = springLog
        ? stiffness * rest * Math.log(r / rest)
        : stiffness * (r - rest);
      const ux = dx / r;
      const uy = dy / r;
      fx[ia] += f * ux;
      fy[ia] += f * uy;
      fx[ib] -= f * ux;
      fy[ib] -= f * uy;
    }

    // ── 2b. Когезия кластера: слабая пружина от каждого члена группы к её
    //        активному барицентру, так папки сгущаются в острова ────
    if (cohesion > 0) {
      for (let g = 0; g < this.groups.length; g++) {
        const members = this.groups[g];
        let gx = 0;
        let gy = 0;
        let cnt = 0;
        for (let k = 0; k < members.length; k++) {
          const m = n[members[k]];
          if (!m.active) continue;
          gx += m.x;
          gy += m.y;
          cnt++;
        }
        if (cnt < 2) continue;
        gx /= cnt;
        gy /= cnt;
        for (let k = 0; k < members.length; k++) {
          const mi = members[k];
          if (!n[mi].active) continue;
          fx[mi] += cohesion * (gx - n[mi].x);
          fy[mi] += cohesion * (gy - n[mi].y);
        }
      }
    }

    // ── 2c. Разнос кластеров: считаем каждый кластер заряженным блобом в его
    //        центроиде и отталкиваем каждый узел от центроидов ДРУГИХ кластеров,
    //        так острова расходятся по отдельным территориям.
    const cid = this.clusterId;
    const interCluster = this.settings.interCluster;
    if (cid && this.clusterCount > 0 && interCluster > 0) {
      const cc = this.clusterCount;
      const cCx = this.cCx;
      const cCy = this.cCy;
      const cN = this.cN;
      cCx.fill(0);
      cCy.fill(0);
      cN.fill(0);
      for (let i = 0; i < n.length; i++) {
        const c = cid[i];
        if (c < 0 || !n[i].active) continue;
        cCx[c] += n[i].x;
        cCy[c] += n[i].y;
        cN[c]++;
      }
      for (let c = 0; c < cc; c++) {
        if (cN[c] > 0) {
          cCx[c] /= cN[c];
          cCy[c] /= cN[c];
        }
      }
      const minD = this.settings.minDist;
      for (let i = 0; i < n.length; i++) {
        const node = n[i];
        const c = cid[i];
        if (c < 0 || !node.active) continue;
        for (let o = 0; o < cc; o++) {
          if (o === c || cN[o] === 0) continue;
          let dx = node.x - cCx[o];
          let dy = node.y - cCy[o];
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) d2 = 1;
          const d = Math.sqrt(d2);
          const dEff = d < minD ? minD : d;
          const f = (interCluster * cN[o]) / (dEff * dEff); // пропорц. "заряду" другого острова
          fx[i] += (f * dx) / d;
          fy[i] += (f * dy) / d;
        }
      }
    }

    // ── 2d. Отталкивание внутри кластера: ДОПОЛНИТЕЛЬНЫЙ попарный кулон между
    //        членами ОДНОЙ группы, чтобы заметки папки можно было развести
    //        (рыхлее остров), не трогая разнос между кластерами. Кластеры
    //        небольшие, так что O(k²) на группу пренебрежимо. ────────────
    const intraRep = this.settings.intraRepulsion;
    if (intraRep > 0) {
      for (let g = 0; g < this.groups.length; g++) {
        const members = this.groups[g];
        for (let a = 0; a < members.length; a++) {
          const ia = members[a];
          const na = n[ia];
          if (!na.active) continue;
          for (let b = a + 1; b < members.length; b++) {
            const ib = members[b];
            const nb = n[ib];
            if (!nb.active) continue;
            let dx = nb.x - na.x;
            let dy = nb.y - na.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) d2 = 1;
            const d = Math.sqrt(d2);
            const f = intraRep / d2; // пропорц. 1/r², как глобальный кулоновский член
            const ux = dx / d;
            const uy = dy / d;
            fx[ia] -= f * ux;
            fy[ia] -= f * uy;
            fx[ib] += f * ux;
            fy[ib] += f * uy;
          }
        }
      }
    }

    // ── 3. Гравитация + интегрирование Verlet ──────────────────────────────────
    const { gravity, damping, maxSpeed, dt } = this.settings;
    const maxStep = maxSpeed * dt;
    const maxStep2 = maxStep * maxStep;
    const dt2 = dt * dt;

    // Барицентр активных узлов. Гравитация тянет к этой движущейся точке, а не к
    // фиксированному началу мира, так что граф не уползает к "магическому месту"
    // и layout остаётся инвариантным к сдвигу.
    let bx = 0;
    let by = 0;
    let activeN = 0;
    for (let i = 0; i < n.length; i++) {
      if (!n[i].active) continue;
      bx += n[i].x;
      by += n[i].y;
      activeN++;
    }
    if (activeN > 0) {
      bx /= activeN;
      by /= activeN;
    }

    let energy = 0;
    for (let i = 0; i < n.length; i++) {
      const node = n[i];
      if (!node.active || node.fixed) {
        node.px = node.x;
        node.py = node.y;
        continue;
      }
      const ax = (fx[i] - gravity * (node.x - bx)) / node.mass;
      const ay = (fy[i] - gravity * (node.y - by)) / node.mass;
      let dx = (node.x - node.px) * damping + ax * dt2;
      let dy = (node.y - node.py) * damping + ay * dt2;
      const step2 = dx * dx + dy * dy;
      if (step2 > maxStep2) {
        const k = maxStep / Math.sqrt(step2);
        dx *= k;
        dy *= k;
      }
      node.px = node.x;
      node.py = node.y;
      node.x += dx;
      node.y += dy;
      const vx = dx / dt;
      const vy = dy / dt;
      energy += vx * vx + vy * vy;
    }
    return energy;
  }

  // ── Quadtree Barnes-Hut ──────────────────────────────────────────────

  private newCell(cx: number, cy: number, h: number): number {
    let cell = this.pool[this.poolUsed];
    if (!cell) {
      cell = {
        cx: 0, cy: 0, h: 0, mass: 0, comX: 0, comY: 0,
        body: -1, c0: -1, c1: -1, c2: -1, c3: -1,
      };
      this.pool[this.poolUsed] = cell;
    }
    cell.cx = cx;
    cell.cy = cy;
    cell.h = h;
    cell.mass = 0;
    cell.comX = 0;
    cell.comY = 0;
    cell.body = -1;
    cell.c0 = -1;
    cell.c1 = -1;
    cell.c2 = -1;
    cell.c3 = -1;
    return this.poolUsed++;
  }

  /** Пересобирает дерево из текущих позиций узлов; возвращает индекс корня или −1. */
  private buildTree(): number {
    const nodes = this.nodes;
    const X = this.X;
    const Y = this.Y;
    const Q = this.Q;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const x = nodes[i].x;
      const y = nodes[i].y;
      X[i] = x;
      Y[i] = y;
      Q[i] = nodes[i].charge;
      if (!nodes[i].active) continue; // скрытые тела не формируют дерево
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return -1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let h = Math.max(maxX - minX, maxY - minY) / 2;
    if (h < 1e-3) h = 1;
    h += 1; // запас, чтобы каждое тело лежало строго внутри корневого квадрата

    this.poolUsed = 0;
    const root = this.newCell(cx, cy, h);
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].active) this.insert(root, i, 0);
    }
    return root;
  }

  private insert(ci: number, i: number, depth: number): void {
    const cell = this.pool[ci];
    const x = this.X[i];
    const y = this.Y[i];
    const q = this.Q[i];

    // Пустой лист: паркуем тело сюда.
    if (cell.mass === 0) {
      cell.body = i;
      cell.mass = q;
      cell.comX = q * x;
      cell.comY = q * y;
      return;
    }

    // Лист с одним телом: надо дробить (или схлопнуть в ведро на потолке глубины).
    if (cell.body >= 0) {
      if (depth >= MAX_DEPTH) {
        cell.body = -1; // схлопываем в ведро совпадающих
        cell.mass += q;
        cell.comX += q * x;
        cell.comY += q * y;
        return;
      }
      const e = cell.body;
      cell.body = -1;
      this.insertIntoChild(ci, e, depth);
      // проваливаемся дальше, чтобы добавить ещё и i
    } else if (cell.c0 === -1 && cell.c1 === -1 && cell.c2 === -1 && cell.c3 === -1) {
      // Ведро (без детей): просто накапливаем.
      cell.mass += q;
      cell.comX += q * x;
      cell.comY += q * y;
      return;
    }

    // Внутренняя ячейка: накапливаем и спускаемся.
    cell.mass += q;
    cell.comX += q * x;
    cell.comY += q * y;
    this.insertIntoChild(ci, i, depth);
  }

  private insertIntoChild(ci: number, i: number, depth: number): void {
    const cell = this.pool[ci];
    const east = this.X[i] >= cell.cx;
    const south = this.Y[i] >= cell.cy;
    const half = cell.h / 2;
    const q = south ? (east ? 3 : 2) : east ? 1 : 0;

    let child = q === 0 ? cell.c0 : q === 1 ? cell.c1 : q === 2 ? cell.c2 : cell.c3;
    if (child === -1) {
      const ccx = east ? cell.cx + half : cell.cx - half;
      const ccy = south ? cell.cy + half : cell.cy - half;
      child = this.newCell(ccx, ccy, half);
      // pool[ci] не меняет identity при newCell, так что `cell` ещё валиден.
      if (q === 0) cell.c0 = child;
      else if (q === 1) cell.c1 = child;
      else if (q === 2) cell.c2 = child;
      else cell.c3 = child;
    }
    this.insert(child, i, depth + 1);
  }

  /** Накапливает на узле i отталкивание Barnes-Hut (плюс точное анти-перекрытие). */
  private repulsionOn(i: number, root: number): void {
    const { repulsion, theta, minDist, collision } = this.settings;
    const theta2 = theta * theta;
    const X = this.X;
    const Y = this.Y;
    const Q = this.Q;
    const pool = this.pool;
    const stack = this.stack;
    const xi = X[i];
    const yi = Y[i];
    const qi = Q[i];
    const ri = this.nodes[i].radius;
    let fx = 0;
    let fy = 0;

    stack[0] = root;
    let sp = 1;
    while (sp > 0) {
      const cell = pool[stack[--sp]];
      if (cell.mass === 0) continue;

      if (cell.body >= 0) {
        // Точное одиночное тело: полный кулон плюс короткодействующая коллизия.
        const e = cell.body;
        if (e === i) continue;
        let dx = X[e] - xi;
        let dy = Y[e] - yi;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-12) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const invd = 1 / d;
        const dEff = d < minDist ? minDist : d;
        let f = (repulsion * qi * Q[e]) / (dEff * dEff);
        const minSep = ri + this.nodes[e].radius + COLLIDE_PAD;
        if (d < minSep) f += collision * (minSep - d);
        fx -= f * dx * invd; // dx это i к e, так что −û отталкивает i от e
        fy -= f * dy * invd;
        continue;
      }

      // Внутренняя ячейка или ведро: пробуем мультипольное приближение.
      const inv = 1 / cell.mass;
      const comx = cell.comX * inv;
      const comy = cell.comY * inv;
      let dx = comx - xi;
      let dy = comy - yi;
      let d2 = dx * dx + dy * dy;
      const size = 2 * cell.h;
      const hasChildren =
        cell.c0 >= 0 || cell.c1 >= 0 || cell.c2 >= 0 || cell.c3 >= 0;

      if (!hasChildren || size * size < theta2 * d2) {
        if (d2 < 1e-12) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const invd = 1 / d;
        const dEff = d < minDist ? minDist : d;
        const f = (repulsion * qi * cell.mass) / (dEff * dEff);
        fx -= f * dx * invd;
        fy -= f * dy * invd;
      } else {
        if (cell.c0 >= 0) stack[sp++] = cell.c0;
        if (cell.c1 >= 0) stack[sp++] = cell.c1;
        if (cell.c2 >= 0) stack[sp++] = cell.c2;
        if (cell.c3 >= 0) stack[sp++] = cell.c3;
      }
    }

    this.fx[i] += fx;
    this.fy[i] += fy;
  }
}
