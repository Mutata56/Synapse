/**
 * Парный спарклайн-оверлей: дневная или недельная выработка слов рядом с
 * настроением из ежедневных заметок. Отвечает на вопрос "пишу ли я больше в
 * хорошие дни?". Коэффициент Пирсона `r` показываем над спарклайнами, когда
 * парных данных хватает (не меньше 14 не-null пар).
 *
 * Правила видимости (намеренно осторожные, плохие данные показывать не надо):
 *   - Скрыт целиком, если ни у одной заметки нет оценки настроения.
 *   - Скрыт в режиме месяца, как и оверлей скользящей медианы (12 бакетов
 *     слишком грубо для обоих сигналов).
 *   - Подпись `r` скрыта, когда выборка ниже порога.
 *
 * Тот же приём с SVG, что и в `CalendarView.MoodTrend`: viewBox в единицах
 * домена плюс `preserveAspectRatio="none"` плюс
 * `vector-effect="non-scaling-stroke"`, так что полилинии растягиваются, а
 * штрихи остаются резкими в 1px. Без hover, без анимаций, по правилу проекта
 * "тонкая статичная линия".
 */

import { useMemo } from "react";
import { dailyDateOf, toISODate } from "../../lib/daily";
import { t } from "../../lib/i18n";
import type { NoteMeta } from "../../lib/storage";

const PEARSON_MIN_PAIRS = 14;

type Props = {
  notes: NoteMeta[];
  /** Интервалы периодов по столбикам, ровно 1:1 с `wordsSeries`. Каждый это
   *  включающий `[startMs, endMs]`, так что режим дня это один календарный
   *  день, а режим недели это интервал в 7 дней (как `wordsByWeek` из
   *  writingStats). */
  buckets: { startMs: number; endMs: number }[];
  /** Слова, написанные за бакет, ровно 1:1. */
  wordsSeries: number[];
  /** Текущая гранулярность. В режиме `month` оверлей сам прячется. */
  mode: "day" | "week" | "month";
};

export function MoodWordsOverlay({ notes, buckets, wordsSeries, mode }: Props) {
  const hasMoodData = useMemo(
    () => notes.some((n) => typeof n.mood === "number"),
    [notes],
  );

  // Настроение по ISO-ключу дня ежедневной заметки (настроение есть только у них).
  const moodByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      if (typeof n.mood !== "number") continue;
      const dd = dailyDateOf(n.id);
      if (dd) m.set(dd, n.mood);
    }
    return m;
  }, [notes]);

  // Среднее настроение за бакет: проходим каждый день в [startMs, endMs] и
  // усредняем только те дни, где настроение ЕСТЬ. Бакет без таких дней даёт
  // `null` (ноль не выдумываем), так что полилиния там рвётся.
  const moodSeries = useMemo<(number | null)[]>(() => {
    return buckets.map((b) => avgMoodForRange(moodByDay, b.startMs, b.endMs));
  }, [buckets, moodByDay]);

  // Корреляция Пирсона по парным не-null бакетам. Скрыта, когда выборка ниже
  // порога (иначе слишком много места для случайных значений).
  const r = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < wordsSeries.length && i < moodSeries.length; i++) {
      const m = moodSeries[i];
      if (m == null) continue;
      xs.push(wordsSeries[i]);
      ys.push(m);
    }
    return xs.length >= PEARSON_MIN_PAIRS ? pearson(xs, ys) : null;
  }, [wordsSeries, moodSeries]);

  if (!hasMoodData || mode === "month") return null;

  const n = Math.min(wordsSeries.length, moodSeries.length);
  if (n === 0) return null;

  const maxWords = wordsSeries.reduce((m, v) => (v > m ? v : m), 0);
  const wordsPoints = buildPoints(
    wordsSeries.slice(0, n).map((v) => (maxWords > 0 ? v / maxWords : 0)),
  );
  // Домен настроения это 1..5, зажимаем в viewBox, чтобы случайный 0 не сломал.
  const moodPoints = buildMoodPoints(moodSeries.slice(0, n));

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] uppercase tracking-wider text-zinc-600">
          {t("Настроение и слова")}
        </h4>
        {r != null && (
          <span className="text-[11px] tabular-nums text-zinc-500">
            r = {r.toFixed(2)}
          </span>
        )}
      </div>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 space-y-1">
        <svg
          viewBox={`0 0 ${n} 1`}
          preserveAspectRatio="none"
          className="w-full h-8"
          aria-hidden
        >
          {wordsPoints.map((seg, i) => (
            <polyline
              key={i}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={0.6}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={seg}
            />
          ))}
        </svg>
        <div className="h-px bg-[var(--color-border)]" />
        <svg
          viewBox={`0 0 ${n} 4`}
          preserveAspectRatio="none"
          className="w-full h-8"
          aria-hidden
        >
          {moodPoints.map((seg, i) => (
            <polyline
              key={i}
              fill="none"
              stroke="var(--color-tag-accent)"
              strokeWidth={0.6}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={seg}
            />
          ))}
        </svg>
      </div>
    </section>
  );
}

/** Среднее настроение по `[startMs, endMs]`, учитываем только дни с
 *  записанным настроением. Возвращает null, если в диапазоне данных нет. */
function avgMoodForRange(
  moodByDay: Map<string, number>,
  startMs: number,
  endMs: number,
): number | null {
  let sum = 0;
  let count = 0;
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= endMs) {
    const k = toISODate(cursor);
    const v = moodByDay.get(k);
    if (typeof v === "number") {
      sum += v;
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count > 0 ? sum / count : null;
}

/** Режет ряд 0..1 на сегменты полилинии на каждом null-разрыве. Y инвертирован
 *  (1 - v), чтобы линия росла со значением внутри единичного viewBox. */
function buildPoints(series: (number | null)[]): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
      continue;
    }
    cur.push(`${i + 0.5},${1 - Math.max(0, Math.min(1, v))}`);
  }
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}

/** То же, что buildPoints, но для домена настроения 1..5 в viewBox высотой 4
 *  (рисуем `5 - mood`, чтобы "счастливее = выше"). */
function buildMoodPoints(series: (number | null)[]): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
      continue;
    }
    const clamped = Math.max(1, Math.min(5, v));
    cur.push(`${i + 0.5},${5 - clamped}`);
  }
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}

/** Обычная корреляция Пирсона. Вызывающий гарантирует `xs.length === ys.length`
 *  и не меньше 2 пар. Возвращает `null`, когда дисперсия любого из рядов нулевая
 *  (вырожденный плоский сигнал). Так отличаем "связи не измерить" от настоящего
 *  r = 0.00, который иначе показался бы уверенно напечатанным числом. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const ax = xs[i] - mx;
    const ay = ys[i] - my;
    num += ax * ay;
    dx2 += ax * ax;
    dy2 += ay * ay;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : null;
}
