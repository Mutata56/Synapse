/**
 * Годовой хитмап дней с записями в стиле GitHub. 53 колонки на 7 строк (с
 * понедельника, как принято у нас). Оттенок ячейки кодирует квартиль числа
 * слов за день внутри видимого года.
 *
 * Питает кликабельные KPI: `highlightRange` обводит ячейки внутри
 * [startMs, endMs], `scrollToKey` плавно прокручивает нужную ячейку в вид. Без
 * подсветки соседей по hover, ячейка реагирует только на свой, по политике
 * проекта.
 */

import { memo, useEffect, useMemo, useRef } from "react";
import { t } from "../../lib/i18n";
import { dayKey, toISODate } from "../../lib/daily";

const ROWS = 7;
/** Размер одной ячейки в пикселях (квадрат). */
const CELL_PX = 10;
const GAP_PX = 2;

type Props = {
  year: number;
  dailyDaySet: Set<string>;
  wordsByDayKey: Map<string, number>;
  highlightRange?: { startMs: number; endMs: number } | null;
  scrollToKey?: string | null;
  onCellClick?: (key: string) => void;
};

type Cell = {
  /** Локальный ключ YYYY-MM-DD для ячейки, или `null` для заполнителя в начале
   *  и конце (до 1 января и после 31 декабря) внутри сетки из 53 колонок. */
  key: string | null;
  /** Уровень квартиля 0..4: 0 это пусто, 1..4 это растущие квартили по словам. */
  level: number;
};

export const YearHeatmap = memo(function YearHeatmap({
  year,
  dailyDaySet,
  wordsByDayKey,
  highlightRange,
  scrollToKey,
  onCellClick,
}: Props) {
  // Колонки по 7 ячеек (с понедельника по воскресенье). Сетку строим один раз
  // на (year, dailyDaySet, wordsByDayKey) и переиспользуем между рендерами.
  const columns = useMemo<Cell[][]>(
    () => buildColumns(year, dailyDaySet, wordsByDayKey),
    [year, dailyDaySet, wordsByDayKey],
  );

  // Проверка попадания в диапазон подсветки, с точностью до локального дня
  // через dayKey(), чтобы переживала переход на летнее время без off-by-one.
  const highlighted = useMemo<Set<string>>(() => {
    if (!highlightRange) return new Set();
    const out = new Set<string>();
    const cursor = new Date(highlightRange.startMs);
    cursor.setHours(0, 0, 0, 0);
    const end = highlightRange.endMs;
    while (cursor.getTime() <= end) {
      out.add(toISODate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [highlightRange]);

  // Рефы ячеек по ключу YYYY-MM-DD, чтобы scrollToKey резолвился за O(1).
  const cellRefs = useRef<Map<string, HTMLButtonElement | HTMLDivElement>>(
    new Map(),
  );

  useEffect(() => {
    if (!scrollToKey) return;
    const el = cellRefs.current.get(scrollToKey);
    if (!el) return;
    // block:'nearest' гасит вертикальный прыжок страницы, inline:'center'
    // подтягивает ячейку в центр горизонтальной дорожки прокрутки.
    el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [scrollToKey]);

  const widthPx = columns.length * (CELL_PX + GAP_PX) - GAP_PX;
  const heightPx = ROWS * (CELL_PX + GAP_PX) - GAP_PX;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600">
          {t("Активность за {year}", { year })}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid"
          style={{
            gridAutoFlow: "column",
            gridTemplateRows: `repeat(${ROWS}, ${CELL_PX}px)`,
            gap: `${GAP_PX}px`,
            minWidth: `${widthPx}px`,
            height: `${heightPx}px`,
          }}
        >
          {columns.flatMap((col, ci) =>
            col.map((cell, ri) => (
              <CellNode
                key={`${ci}-${ri}`}
                cell={cell}
                highlighted={cell.key !== null && highlighted.has(cell.key)}
                refMap={cellRefs.current}
                onCellClick={onCellClick}
              />
            )),
          )}
        </div>
      </div>
    </div>
  );
});

function CellNode({
  cell,
  highlighted,
  refMap,
  onCellClick,
}: {
  cell: Cell;
  highlighted: boolean;
  refMap: Map<string, HTMLButtonElement | HTMLDivElement>;
  onCellClick?: (key: string) => void;
}) {
  // Ячейки-заполнители (до 1 января и после 31 декабря) рисуем невидимыми
  // распорками, чтобы сетка из 7 строк осталась прямоугольной и не сбила
  // индексы колонок.
  if (cell.key === null) {
    return <div style={{ width: CELL_PX, height: CELL_PX }} />;
  }

  const baseStyle = baseCellStyle(cell.level);
  const ringStyle = highlighted
    ? {
        boxShadow: "0 0 0 1px var(--color-accent-border)",
      }
    : undefined;

  // `outline` (а не border), чтобы рамка hover была вне бюджета box-sizing и
  // цветной квадрат не сжимался на 1px при наведении.
  const className =
    "rounded-[2px] transition-colors hover:outline hover:outline-1 hover:outline-[var(--color-border-strong)]";

  const refCb = (el: HTMLButtonElement | HTMLDivElement | null) => {
    if (el && cell.key) refMap.set(cell.key, el);
  };

  if (onCellClick) {
    return (
      <button
        ref={refCb as (el: HTMLButtonElement | null) => void}
        type="button"
        onClick={() => onCellClick(cell.key as string)}
        style={{ ...baseStyle, ...ringStyle }}
        className={className}
        title={cell.key ?? undefined}
      />
    );
  }

  return (
    <div
      ref={refCb as (el: HTMLDivElement | null) => void}
      style={{ ...baseStyle, ...ringStyle }}
      className={className}
      title={cell.key ?? undefined}
    />
  );
}

function buildColumns(
  year: number,
  dailyDaySet: Set<string>,
  wordsByDayKey: Map<string, number>,
): Cell[][] {
  // Пороги квартилей считаем по ненулевому подмножеству дневных итогов года.
  // Ячейки рисуются только для дней из `dailyDaySet`, так что и пороги надо
  // считать по ТОМУ ЖЕ подмножеству. Иначе жирная не-ежедневная заметка в
  // ежедневный день раздует свой итог И перекосит пороги для всех остальных
  // ежедневных ячеек, и дни с одинаковым усилием будут читаться по-разному.
  const totals: number[] = [];
  for (const [k, w] of wordsByDayKey) {
    if (!k.startsWith(`${year}-`)) continue;
    if (!dailyDaySet.has(k)) continue;
    if (w > 0) totals.push(w);
  }
  totals.sort((a, b) => a - b);
  const q = quartiles(totals);

  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);

  // Раскладка колонок с понедельника: monIndex(day) это 0..6, где 0 это
  // понедельник. JS getDay() возвращает 0=вс..6=сб, так что ремапим через (d+6)%7.
  const firstRow = (start.getDay() + 6) % 7;

  const columns: Cell[][] = [];
  let col: Cell[] = new Array<Cell>(firstRow).fill({ key: null, level: 0 });

  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const key = dayKey(cursor.getTime());
    const words = wordsByDayKey.get(key) ?? 0;
    const level = dailyDaySet.has(key) ? bucket(words, q) : 0;
    col.push({ key, level });
    if (col.length === ROWS) {
      columns.push(col);
      col = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (col.length > 0) {
    while (col.length < ROWS) col.push({ key: null, level: 0 });
    columns.push(col);
  }
  return columns;
}

/** Раскладывает `words` по 1..4 через пороги `[p25, p50, p75]`. Возвращает 0,
 *  когда сигнала нет (год из одних нулей). */
function bucket(words: number, q: [number, number, number]): number {
  if (words <= 0) return 0;
  if (words <= q[0]) return 1;
  if (words <= q[1]) return 2;
  if (words <= q[2]) return 3;
  return 4;
}

/** p25/p50/p75 отсортированного непустого массива, или нули для пустого. */
function quartiles(sortedAsc: number[]): [number, number, number] {
  if (sortedAsc.length === 0) return [0, 0, 0];
  const at = (p: number) => {
    const idx = Math.min(
      sortedAsc.length - 1,
      Math.max(0, Math.floor(p * (sortedAsc.length - 1))),
    );
    return sortedAsc[idx];
  };
  return [at(0.25), at(0.5), at(0.75)];
}

function baseCellStyle(level: number): React.CSSProperties {
  if (level === 0) {
    return {
      width: CELL_PX,
      height: CELL_PX,
      backgroundColor: "var(--color-border)",
      opacity: 0.4,
    };
  }
  const opacity = [0.25, 0.5, 0.75, 1.0][level - 1];
  return {
    width: CELL_PX,
    height: CELL_PX,
    backgroundColor: "var(--color-accent)",
    opacity,
  };
}
