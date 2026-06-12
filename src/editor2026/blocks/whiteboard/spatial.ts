// src/editor2026/blocks/whiteboard/spatial.ts
//
// Слой производительности для самописной бесконечной доски.

// ЗАЧЕМ ЭТО НУЖНО
// ───────────────
// Наивный путь рендера/хит-теста , O(n): каждый кадр движок обходит все
// шейпы, считает bounds и проверяет каждый с viewport'ом (рендер) или
// указателем (хит-тест). На нескольких сотнях объектов это нормально;
// на тысячах (особенно при панорамировании/зуме на 120 Hz) это убивает
// кадровый бюджет.
//
// Две структуры решают проблему, обе чистые данные + математика (без DOM,
// без React, без канваса):
//
//   -  SpatialHash , равномерная сетка, группирующая id по мировым ячейкам,
//     которые пересекают их bounds. queryBounds(view) возвращает только id
//     из ячеек, видимых камерой; queryPoint(p) , только id рядом с курсором.
//     Движок пересекает этот маленький *кандидатный набор* с точными проверками,
//     превращая стоимость кадра из O(n) примерно в O(visible).
//
//   -  simplifyRDP , сворачивает freehand-штрих (накапливающий десятки тысяч
//     сырых сэмплов указателя) до горстки точек, реально определяющих его
//     форму, чтобы каждая следующая проверка bounds/хит/рендер/сериализация
//     для этого штриха была быстрой. Итеративно, не рекурсивно, поэтому
//     штрих в 100k точек не переполнит стек вызовов.

import type { Bounds, Pt } from "./model";

// ──────────────────────────────────────────────────────────────────────────────
// Пространственный хэш
// ──────────────────────────────────────────────────────────────────────────────

/** Длина ребра ячейки сетки по умолчанию в мировых единицах. */
const DEFAULT_CELL_SIZE = 256;

/**
 * Максимальное количество ячеек, которое может занимать один элемент,
 * прежде чем он будет отнесён к "переросшим" и помещён в список перелива
 * вместо распределения по ячейкам.
 *
 * Причина: bounds, охватывающий (допустим) весь мир при размере ячейки 256,
 * может задевать миллионы ячеек, и вставка/удаление будет занимать весь кадр
 * , именно тот столл, который хэш призван устранить. Ограничение по размаху
 * держит update()/rebuild() детерминированными; переросшие элементы всегда
 * попадают в результат запроса, что корректно (они действительно потенциально
 * видимы везде) и дёшево, т.к. таких мало.
 */
const MAX_CELLS_PER_ITEM = 1024;

/** Включительный блок целочисленных координат ячеек, покрываемых bounds. */
type CellSpan = {
  minCx: number;
  minCy: number;
  maxCx: number;
  maxCy: number;
};

/**
 * Равномерно-сеточный пространственный индекс для осевыравненных bounds.
 *
 * Инварианты:
 *   -  `items`   : id , bounds, индексированные для этого id. Позволяет
 *                  remove()/update() находить ранее занятые ячейки без
 *                  повторного обхода всей сетки.
 *   -  `cells`   : "cx:cy" , множество id, чьи bounds пересекают эту ячейку.
 *   -  `oversized`: id, чей размах превысил MAX_CELLS_PER_ITEM; не в `cells`,
 *                  всегда добавляются в результаты запроса.
 *
 * Все три поддерживаются консистентными при clear/rebuild/update/remove.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<string>>();
  private readonly items = new Map<string, Bounds>();
  private readonly oversized = new Set<string>();

  /** @param cellSize длина ребра ячейки сетки в мировых единицах (по умолчанию 256). */
  constructor(cellSize: number = DEFAULT_CELL_SIZE) {
    // Защита от нуля/отрицательного/NaN, из-за которых floor(min/cell) взорвётся.
    this.cellSize = cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE;
  }

  /** Удалить все индексированные элементы. O(buckets), но вызывается редко. */
  clear(): void {
    this.cells.clear();
    this.items.clear();
    this.oversized.clear();
  }

  /**
   * Заменить всё содержимое за один вызов. Движок вызывает это при
   * структурном изменении (шейпы добавлены/удалены/переставлены), когда
   * полный реиндекс проще и дешевле, чем дифф. Сначала clear, потом
   * вставка каждой записи.
   */
  rebuild(entries: ReadonlyArray<{ id: string; bounds: Bounds }>): void {
    this.clear();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      this.insert(e.id, e.bounds);
    }
  }

  /**
   * Вставка нового элемента или перемещение существующего. Движок вызывает
   * это каждый кадр при перетаскивании/изменении размера шейпа. Если id уже
   * индексирован, сначала удаляем его старое размещение (по сохранённым bounds),
   * чтобы не оставалось stale-ссылок , для этого хранится `items`.
   */
  update(id: string, bounds: Bounds): void {
    if (this.items.has(id)) this.remove(id);
    this.insert(id, bounds);
  }

  /** Удалить один элемент из всех ячеек, которые он занимал, плюс список перелива. */
  remove(id: string): void {
    const prev = this.items.get(id);
    if (prev === undefined) return;
    this.items.delete(id);

    if (this.oversized.delete(id)) return; // переросшие никогда не распределялись

    const span = this.cellSpan(prev);
    for (let cx = span.minCx; cx <= span.maxCx; cx++) {
      for (let cy = span.minCy; cy <= span.maxCy; cy++) {
        const key = cellKey(cx, cy);
        const set = this.cells.get(key);
        if (set === undefined) continue;
        set.delete(id);
        if (set.size === 0) this.cells.delete(key); // держим маппу разреженной
      }
    }
  }

  /**
   * Кандидатные id для рендера: каждый id, чьи ячейки пересекают view rect.
   * Может включать ложноположительные результаты вблизи краёв ячеек (шейп
   * может задевать ячейку, но находиться за viewport'ом) , движок делает
   * точный viewport-каттинг. Ложноотрицательных быть не может, это главное.
   */
  queryBounds(view: Bounds): Set<string> {
    const out = new Set<string>();
    this.queryBoundsInto(view, out);
    return out;
  }

  /** Вариант queryBounds с буфером вызывающего: пишет в `out` (сначала очищает)
   *  вместо аллокации нового Set. Используется в пути рендера, где старый
   *  свежий-Set-за-кадр давал заметный GC-шум. */
  queryBoundsInto(view: Bounds, out: Set<string>): void {
    out.clear();
    const span = this.cellSpan(view);
    for (let cx = span.minCx; cx <= span.maxCx; cx++) {
      for (let cy = span.minCy; cy <= span.maxCy; cy++) {
        const set = this.cells.get(cellKey(cx, cy));
        if (set === undefined) continue;
        for (const id of set) out.add(id);
      }
    }
    // Переросшие могут перекрывать view из-за пределов своих номинальных ячеек.
    for (const id of this.oversized) out.add(id);
  }

  /**
   * Кандидатные id для хит-тестинга: id в ячейках в пределах `tol` мировых
   * единиц от точки. Расширяет точку в маленький bounds-бокс и переиспользует
   * сканирование ячеек, чтобы наведение у края ячейки всё ещё находило
   * соседей.
   */
  queryPoint(p: Pt, tol: number = 0): Set<string> {
    const t = tol > 0 ? tol : 0;
    return this.queryBounds({
      minX: p.x - t,
      minY: p.y - t,
      maxX: p.x + t,
      maxY: p.y + t,
    });
  }

  /** Количество индексированных элементов (распределённых + переросших). */
  get size(): number {
    return this.items.size;
  }

  /**
   * Сколько ячеек сетки обойдёт queryBounds(view). Растёт с ПЛОЩАДЬЮ
   * view, поэтому при сильном отдалении может превысить количество элементов ,
   * тогда вызывающему лучше обходить все элементы напрямую, а не ползти
   * по огромному в основном пустому блоку ячеек. Дешёвый O(1), просто
   * арифметика размаха ячеек.
   */
  queryCellCount(view: Bounds): number {
    const span = this.cellSpan(view);
    return (
      (span.maxCx - span.minCx + 1) * (span.maxCy - span.minCy + 1)
    );
  }

  // ── внутренности ──────────────────────────────────────────────────────

  /**
   * Распределить (предположительно новый) id по всем ячейкам, которые
   * пересекают его bounds. Если размах слишком большой , в список перелива.
   * Bounds всегда записывается в `items`, чтобы remove()/update() могли
   * это отменить.
   */
  private insert(id: string, bounds: Bounds): void {
    this.items.set(id, bounds);

    const span = this.cellSpan(bounds);
    const wCells = span.maxCx - span.minCx + 1;
    const hCells = span.maxCy - span.minCy + 1;

    // Умножаем, т.к. каждое измерение может быть большим; произведение ,
    // количество задеваемых ячеек.
    if (wCells * hCells > MAX_CELLS_PER_ITEM) {
      this.oversized.add(id);
      return;
    }

    for (let cx = span.minCx; cx <= span.maxCx; cx++) {
      for (let cy = span.minCy; cy <= span.maxCy; cy++) {
        const key = cellKey(cx, cy);
        let set = this.cells.get(key);
        if (set === undefined) {
          set = new Set<string>();
          this.cells.set(key, set);
        }
        set.add(id);
      }
    }
  }

  /**
   * Включительный блок целочисленных координат ячеек для bounds. Нефинитные
   * координаты клипаются в 0, чтобы некорректные bounds не порождали
   * бесконечный цикл сканирования.
   */
  private cellSpan(b: Bounds): CellSpan {
    const cs = this.cellSize;
    return {
      minCx: toCell(b.minX, cs),
      minCy: toCell(b.minY, cs),
      maxCx: toCell(b.maxX, cs),
      maxCy: toCell(b.maxY, cs),
    };
  }
}

/** Мировая координата , целочисленный индекс ячейки (с защитой от нефинитных). */
function toCell(v: number, cellSize: number): number {
  return Number.isFinite(v) ? Math.floor(v / cellSize) : 0;
}

/** Стабильная строковая ключ ячейки. Вынесена в отдельную функцию для моноформных вызовов. */
function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// simplifyRDP , упрощение полилинии по Рамеру-Дугласу-Пекеру
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Уменьшает freehand-полилинию до значительно меньшего числа точек, оставаясь
 * в пределах `epsilon` мировых единиц от оригинальной кривой.
 *
 * ЗАЧЕМ: штрих пера, захваченный со скоростью указателя, может содержать
 * десятки тысяч почти коллинеарных сэмплов. Упрощение один раз (по окончании
 * штриха) делает все последующие проверки bounds/хит/сериализации/рендера
 * для этого шейпа пропорционально дешевле и уменьшает сохраняемый документ.
 *
 * АЛГОРИТМ: классический Дуглас-Пекер. Для сегмента (a..b) ищем внутреннюю
 * точку с максимальным перпендикулярным расстоянием до прямой a, b. Если это
 * расстояние превышает `epsilon`, точка , настоящий угол: сохраняем и рекурсивно
 * обе половины. Иначе весь размах "достаточно плоский" и все внутренние
 * точки удаляются.
 *
 * РЕАЛИЗАЦИЯ , итеративная, не рекурсивная: глубина рекурсии O(n) в худшем
 * случае (штрих, отсекающий по одной точке за раз), поэтому штрих в 100k
 * точек переполнит стек JS. Делим-и-властствуй через явный стек диапазонов
 * [start, end], отмечаем сохраняемые индексы в булевом массиве, потом
 * собираем выживших в исходном порядке.
 *
 * ГАРАНТИИ: первая и последняя точки всегда сохраняются; вход длины >= 2
 * никогда не вернёт менее 2 точек; вырожденный сегмент (a == b) откатывается
 * на прямое расстояние point-to-point.
 *
 * @param points  исходная полилиния (не мутируется)
 * @param epsilon макс. допустимое отклонение в мировых единицах; <= 0 значит "сохранить всё"
 */
export function simplifyRDP(points: Pt[], epsilon: number): Pt[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  // Нефинитный допуск не может ничего осмысленного отбросить; сохраняем всё.
  if (!(epsilon > 0)) return points.slice();

  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  // Явный рабочий стек диапазонов [start, end] для деления.
  const stack: Array<[number, number]> = [[0, n - 1]];

  while (stack.length > 0) {
    const range = stack.pop()!;
    const start = range[0];
    const end = range[1];
    if (end - start < 2) continue; // нет внутренних точек между концами

    const a = points[start];
    const b = points[end];

    // Ищем внутреннюю точку, наиболее удалённую от сегмента a, b.
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    // Если самая дальняя точка отклоняется дальше epsilon , это настоящий угол:
    // сохраняем и делим. Иначе весь размах упрощается в a, b (внутренние удаляются).
    if (maxDist > epsilon && maxIdx > start) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/**
 * Перпендикулярное расстояние от точки `p` до прямой через `a` и `b`.
 * Вырожденный сегмент (a == b, нулевая длина) откатывается на прямое
 * расстояние от `p` до этой единственной совпадающей точки.
 */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // |векторное произведение| / |длина сегмента| = перпендикулярное расстояние.
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx);
  return cross / Math.sqrt(len2);
}
