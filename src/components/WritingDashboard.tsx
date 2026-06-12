import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Flame,
  PenLine,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { dayKey, toISODate } from "../lib/daily";
import { wordCountsFor } from "../lib/fullTextSearch";
import { t } from "../lib/i18n";
import { flattenNotes } from "../lib/treeUtils";
import { MoodWordsOverlay } from "./dashboard/MoodWordsOverlay";
import { RecentRail } from "./dashboard/RecentRail";
import { TopTagsLeaderboard } from "./dashboard/TopTagsLeaderboard";
import { YearHeatmap } from "./dashboard/YearHeatmap";
import {
  coverageStats,
  currentStreak,
  currentStreakRange,
  dailyDaySet,
  entriesInYear,
  longestStreak,
  longestStreakRange,
  medianOf,
  totalWords,
  trailingMedian,
  wordsByDay,
  wordsByMonth,
  wordsByWeek,
  wordsInDay,
  wordsInYear,
  wordsLastNDays,
  yearsWithEntries,
  type WordEntry,
} from "../lib/writingStats";
import { useNotesStore } from "../store/notes";

const MONTH_ABBR = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];
const MONTHS_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
/** Месяцы в родительном падеже, чтобы день читался как "5 июня". */
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const GRANULARITIES = [
  { id: "day", label: "Дни" },
  { id: "week", label: "Недели" },
  { id: "month", label: "Месяцы" },
] as const;

type Granularity = (typeof GRANULARITIES)[number]["id"];

/** Ключ в localStorage для последней выбранной гранулярности графика. */
const MODE_LS_KEY = "overview-mode";

/** Читаем сохранённый режим, иначе "day". Самый безопасный дефолт для
 *  первого захода (иначе вид по месяцам за год покажет 12 пустых столбиков). */
function readPersistedMode(): Granularity {
  try {
    const raw = localStorage.getItem(MODE_LS_KEY);
    if (raw === "day" || raw === "week" || raw === "month") return raw;
  } catch {
    /* приватный режим или storage отключён, проваливаемся дальше */
  }
  return "day";
}

const fmt = (n: number): string => n.toLocaleString("ru-RU");
const dayMonth = (ms: number): string =>
  new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

/** Один столбик графика. `label` это (разреженная) подпись оси, пустая если
 *  столбик без подписи. `name` это полное имя периода для тултипа и подписи
 *  к пику. */
type Bar = { words: number; label: string; name: string };

// ─── Компонент ───────────────────────────────────────────────────────────────

export function WritingDashboard() {
  const tree = useNotesStore((s) => s.tree);
  const notes = useMemo(() => flattenNotes(tree), [tree]);

  // Стабильная сигнатура контента: добавление, удаление или сохранение её
  // двигают, а косметические смены идентичности дерева (от посторонних мутаций
  // на автосейве) нет. Без этого каждое нажатие клавиши в редакторе (оно
  // двигает `tree` через цепочку сохранения) запускало полный скан диска и
  // подсчёт слов заново.
  //
  // Дёшево: `length:maxUpdatedAt`. Новая заметка двигает length, любая правка
  // двигает maxUpdatedAt. Корректность та же, что у старого джойна
  // `id:updatedAt|...`, но без аллокации строки на ~250КБ на каждое нажатие
  // при 10k заметок.
  const notesSig = useMemo(() => {
    let mx = 0;
    for (const n of notes) if (n.updatedAt > mx) mx = n.updatedAt;
    return `${notes.length}:${mx}`;
  }, [notes]);

  // Счётчики слов по заметкам берём из кэша тел полнотекстового поиска
  // (прогретого на старте), так что повторное открытие дашборда мгновенно и
  // перечитываем только изменённые заметки. Сериям ниже тела не нужны, они
  // отрисуются ещё до загрузки этого.
  const [entries, setEntries] = useState<WordEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    wordCountsFor(notes)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        setLoading(false);
      })
      .catch((err) => {
        console.warn("wordCountsFor failed", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Зависим от стабильной сигнатуры (а НЕ от ссылки на массив), чтобы
    // посторонние ререндеры не запускали тяжёлый обход диска.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesSig]);

  // Серии (синхронно, считаем из дней ежедневных заметок в кэше дерева).
  const days = useMemo(() => dailyDaySet(notes), [notes]);
  const record = useMemo(() => longestStreak(days), [days]);
  const current = useMemo(() => currentStreak(days), [days]);
  // Серии в виде диапазонов: подсвечивают рамку в YearHeatmap и задают цель
  // для scroll-into-view при клике по KPI-плиткам Trophy и Flame.
  const recordRange = useMemo(() => longestStreakRange(days), [days]);
  const currentRange = useMemo(() => currentStreakRange(days), [days]);

  // Состояние кликабельных KPI. `highlightRange` обводит каждую ячейку внутри
  // диапазона, `scrollToKey` подтягивает конкретную ячейку в центр дорожки
  // хитмапа. При быстрых тапах побеждает последний клик.
  const [highlightRange, setHighlightRange] = useState<
    { startMs: number; endMs: number } | null
  >(null);
  const [scrollToKey, setScrollToKey] = useState<string | null>(null);

  // Слова по дням, ключ это локальный YYYY-MM-DD. Задаёт заливку по квартилям
  // в YearHeatmap и стабильно, пока стабильны `entries`.
  const wordsByDayKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      const k = dayKey(e.createdAt);
      m.set(k, (m.get(k) ?? 0) + e.words);
    }
    return m;
  }, [entries]);

  // Гранулярность графика и курсор периода. Месяц и неделя листаются по годам,
  // день по месяцам (целый год дневных столбиков нечитаем).
  //
  // Режим сохраняется между сессиями в localStorage. Вернувшийся юзер получит
  // ту гранулярность, что выбрал в прошлый раз, новичок попадает на "day",
  // потому что в первый день вид по месяцам за год это 12 пустых столбиков.
  // (Старая эвристика `entries.length < 7 ? day : ...` была мёртвой: ленивый
  // инициализатор useState всегда отрабатывает до того, как зарезолвится
  // асинхронный эффект с entries, так что `n` всегда был 0 и условие всегда
  // выбирало "day".)
  const [mode, setModeRaw] = useState<Granularity>(readPersistedMode);
  const setMode = useCallback((next: Granularity) => {
    setModeRaw(next);
    try {
      localStorage.setItem(MODE_LS_KEY, next);
    } catch {
      /* приватный режим или квота, не критично */
    }
  }, []);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());

  const years = useMemo(() => yearsWithEntries(entries), [entries]);
  const minYear = years[0] ?? year;
  const maxYear = years[years.length - 1] ?? year;

  // Когда данные загрузились и в выбранном году ничего нет, прыгаем на
  // последний год, где что-то есть. `year` намеренно не в зависимостях, чтобы
  // ручной переход на пустой год потом не отщёлкивало назад.
  useEffect(() => {
    if (years.length > 0 && !years.includes(year)) {
      setYear(years[years.length - 1]);
    }
  }, [years]); // eslint-disable-line react-hooks/exhaustive-deps

  // Итоги по году для заголовка, не зависят от гранулярности графика ниже.
  const yearWords = useMemo(() => wordsInYear(entries, year), [entries, year]);
  const yearEntriesCount = useMemo(
    () => entriesInYear(entries, year),
    [entries, year],
  );
  const allWords = useMemo(() => totalWords(entries), [entries]);

  // Статы за сегодня и за 7 дней, питают KPI-карточки Сегодня и За неделю.
  // `today` это ЛОКАЛЬНЫЙ ISO-ключ (а не объект Date), чтобы он был стабилен
  // внутри календарного дня. new Date() на каждый рендер ломал бы мемо на
  // любом ререндере родителя и заново дёргал wordsInDay.
  //
  // Реагирует на полночь: одноразовый таймер планирует смену состояния на
  // ближайшую локальную полночь, чтобы дашборд, оставленный открытым после
  // 23:59:59, не показывал вчерашнее "Сегодня". Эффект перевзводит себя после
  // срабатывания.
  const [today, setToday] = useState(() => toISODate(new Date()));
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      1, // +1с запаса, чтобы new Date() внутри таймаута надёжно прочитал
         // следующий день, даже если таймер сработает на пару мс раньше.
    );
    const ms = nextMidnight.getTime() - now.getTime();
    const id = window.setTimeout(() => setToday(toISODate(new Date())), ms);
    return () => window.clearTimeout(id);
  }, [today]); // перевзводим после каждой смены
  const todayWords = useMemo(
    () => wordsInDay(entries, today),
    [entries, today],
  );
  // Прокидываем `today` (только дата) в опцию `today?: Date` у wordsLastNDays,
  // чтобы скользящее окно тоже переключалось в полночь вместе с `today`.
  // Перевычисляем по ISO-строке, чтобы мемо обновлялось на смене дня, а не на
  // каждый рендер.
  const todayDate = useMemo(() => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [today]);
  const last7 = useMemo(
    () => wordsLastNDays(entries, 7, todayDate),
    [entries, todayDate],
  );
  const weekWords = useMemo(
    () => last7.reduce((s, v) => s + v, 0),
    [last7],
  );
  const medianLast7 = useMemo(() => medianOf(last7), [last7]);
  // Медиана осмысленна, только если хотя бы в 3 из последних 7 дней что-то
  // писали, иначе "+200 к медиане" на почти пустой неделе это шум.
  const nonZeroDays = useMemo(
    () => last7.reduce((c, v) => c + (v > 0 ? 1 : 0), 0),
    [last7],
  );

  // Столбики для активной гранулярности и периода, у каждого подпись оси
  // (разреженная в плотных режимах) и полное имя для тултипа и подписи.
  const bars = useMemo<Bar[]>(() => {
    if (mode === "month") {
      return wordsByMonth(entries, year).map((w, i) => ({
        words: w,
        label: MONTH_ABBR[i],
        name: MONTHS_FULL[i],
      }));
    }
    if (mode === "week") {
      // Подписываем неделю только там, где начинается новый месяц, как маркеры
      // месяцев в стиле GitHub.
      let prevMonth = -1;
      const out: Bar[] = [];
      for (const b of wordsByWeek(entries, year)) {
        const m = new Date(b.startMs).getMonth();
        out.push({
          words: b.words,
          label: m !== prevMonth ? MONTH_ABBR[m] : "",
          name: `с ${dayMonth(b.startMs)}`,
        });
        prevMonth = m;
      }
      return out;
    }
    return wordsByDay(entries, year, month).map((w, i) => {
      const day = i + 1;
      return {
        words: w,
        label: day === 1 || day % 5 === 0 ? String(day) : "",
        name: `${day} ${MONTHS_GEN[month]}`,
      };
    });
  }, [mode, entries, year, month]);

  // Интервалы времени по столбикам, ровно 1:1 с `bars`. Питают усреднение
  // настроения по бакетам в MoodWordsOverlay. Режим дня это один календарный
  // день, режим недели это окно в 7 дней от startMs столбика (как
  // `wordsByWeek`), режим месяца это весь месяц (оверлей в этом режиме сам
  // прячется, но интервалы мы всё равно строим, чтобы структура данных была
  // однородной).
  const bucketSpans = useMemo<{ startMs: number; endMs: number }[]>(() => {
    if (mode === "month") {
      return bars.map((_, i) => {
        const start = new Date(year, i, 1);
        const end = new Date(year, i + 1, 0);
        return { startMs: start.getTime(), endMs: end.getTime() };
      });
    }
    if (mode === "week") {
      return bars.map((_, i) => {
        const start = new Date(year, 0, 1 + i * 7).getTime();
        // 6 дней спустя, конец дня. `avgMoodForRange` идёт включительно.
        const end = start + 6 * 86_400_000;
        return { startMs: start, endMs: end };
      });
    }
    return bars.map((_, i) => {
      const d = new Date(year, month, i + 1);
      return { startMs: d.getTime(), endMs: d.getTime() };
    });
  }, [bars, mode, year, month]);

  // Оверлей скользящей медианы поверх столбиков. В режиме месяца скрыт (12
  // столбиков слишком мало для осмысленной скользящей медианы). Окно 7 дней в
  // режиме дня, 4 недели в режиме недели.
  const medianSeries = useMemo<(number | null)[] | null>(() => {
    if (mode === "month") return null;
    const win = mode === "day" ? 7 : 4;
    return trailingMedian(
      bars.map((b) => b.words),
      win,
    );
  }, [bars, mode]);

  // Навигация по периодам: по годам (месяц, неделя) или по месяцам (день).
  const atStart =
    mode === "day" ? year <= minYear && month <= 0 : year <= minYear;
  const atEnd = mode === "day" ? year >= maxYear && month >= 11 : year >= maxYear;
  const periodLabel = mode === "day" ? `${MONTHS_FULL[month]} ${year}` : String(year);

  const step = (delta: number) => {
    if (mode !== "day") {
      setYear((y) => y + delta);
      return;
    }
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  // Горячие клавиши дашборда:
  //   стрелки влево/вправо  листают период (с учётом atStart / atEnd)
  //   1/2/3  переключают на Дни / Недели / Месяцы
  //   t/T/е/Е  прыжок на сегодня (кириллическая е как в хелпере Ctrl+Z в App.tsx)
  // Игнорируем поля ввода и оставляем Ctrl/Meta/Alt+клавиша приложению:
  // Ctrl+1 и подобное должны оставаться за браузером и ОС.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (target.isContentEditable) return;
      }

      switch (e.key) {
        case "ArrowLeft":
          if (atStart) return;
          e.preventDefault();
          step(-1);
          return;
        case "ArrowRight":
          if (atEnd) return;
          e.preventDefault();
          step(1);
          return;
        case "1":
          e.preventDefault();
          setMode("day");
          return;
        case "2":
          e.preventDefault();
          setMode("week");
          return;
        case "3":
          e.preventDefault();
          setMode("month");
          return;
      }

      // "t"/"T" на латинской раскладке, "е"/"Е" на кириллице (физическая KeyT).
      if (
        e.code === "KeyT" ||
        e.key === "t" ||
        e.key === "T" ||
        e.key === "е" ||
        e.key === "Е"
      ) {
        e.preventDefault();
        const now = new Date();
        setYear(now.getFullYear());
        if (mode === "day") setMonth(now.getMonth());
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // step / setMode / setYear / setMonth достаточно стабильны между рендерами
    // (сеттеры стабильны, `step` замыкает month/year/mode, а они в зависимостях).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, year, month, atStart, atEnd]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 border-b border-[var(--color-border)] shrink-0">
        {/* Внутренний max-w-6xl повторяет скроллер ниже, чтобы заголовок был
            выровнен по левому краю с сеткой StatCard на широких экранах (без
            этого рассинхрон обёртки виден где-то после 1232px). */}
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Обзор
          </h2>
          <p className="text-[13px] text-zinc-500 mt-1">
            {loading
              ? "Считаю слова…"
              : entries.length > 0
                ? `Всего написано ${fmt(allWords)} ${pluralWords(allWords)} в ${fmt(entries.length)} ${pluralNotes(entries.length)}`
                : "Здесь появится статистика, когда вы начнёте писать"}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-6xl mx-auto">
          {/* Двухколоночный каркас: слева статы и график, справа рейл. */}
          <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
            <div className="lg:col-span-1 space-y-8 min-w-0">
              {/* Главные статы, сетку не трогаем, чтобы карточки не растягивало. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  icon={Trophy}
                  iconClass="text-amber-400"
                  value={fmt(record)}
                  unit={pluralDays(record)}
                  label="Рекордная серия"
                  onClick={
                    recordRange
                      ? () => {
                          // Хитмап по годам: если рекордная серия была в
                          // другом году, сначала листаем страницу, иначе
                          // scrollIntoView ничего не сделает, а рамка
                          // подсветки нарисует ноль ячеек.
                          setYear(new Date(recordRange.startMs).getFullYear());
                          setHighlightRange(recordRange);
                          setScrollToKey(dayKey(recordRange.startMs));
                        }
                      : undefined
                  }
                />
                <StatCard
                  icon={Flame}
                  iconClass={current > 0 ? "text-orange-400" : "text-zinc-600"}
                  value={fmt(current)}
                  unit={pluralDays(current)}
                  label="Текущая серия"
                  onClick={
                    currentRange
                      ? () => {
                          setYear(new Date(currentRange.startMs).getFullYear());
                          setScrollToKey(dayKey(currentRange.startMs));
                        }
                      : undefined
                  }
                />
                <StatCard
                  icon={PenLine}
                  iconClass={
                    todayWords > 0 ? "text-[var(--color-accent)]" : "text-zinc-600"
                  }
                  value={loading ? "…" : fmt(todayWords)}
                  unit={loading ? "" : pluralWords(todayWords)}
                  label="Сегодня"
                  sparkline={last7}
                  chip={
                    !loading && nonZeroDays >= 3 ? (
                      // Сначала вычитаем, ПОТОМ округляем. `Math.round(median)`
                      // до вычитания давал перекос в 1 слово на маленьких
                      // окнах, где медиана попадает на .5.
                      <MedianChip delta={Math.round(todayWords - medianLast7)} />
                    ) : undefined
                  }
                  onClick={() => {
                    setMode("day");
                    const now = new Date();
                    setYear(now.getFullYear());
                    setMonth(now.getMonth());
                  }}
                />
                <StatCard
                  icon={Activity}
                  iconClass={
                    weekWords > 0
                      ? "text-[var(--color-accent)]"
                      : "text-zinc-600"
                  }
                  value={loading ? "…" : fmt(weekWords)}
                  unit={loading ? "" : pluralWords(weekWords)}
                  label="За неделю"
                  onClick={() => {
                    setMode("week");
                    setYear(new Date().getFullYear());
                  }}
                />
              </div>

              {/* Слова во времени, по выбранной гранулярности. Clamp на
                  обёртке ChartFrame не даёт ряду столбиков выпихнуть правый
                  рейл за экран на низких вьюпортах, но позволяет ему дорасти
                  до естественного h-44, когда место есть. */}
              <section>
                <div className="flex items-center justify-between mb-4 gap-3">
                  <ModeToggle value={mode} onChange={setMode} />
                  <PeriodNav
                    label={periodLabel}
                    wide={mode === "day"}
                    atStart={atStart}
                    atEnd={atEnd}
                    onPrev={() => step(-1)}
                    onNext={() => step(1)}
                  />
                </div>
                <div className="max-h-[clamp(11rem,28vh,18rem)]">
                  {loading ? (
                    <SkeletonBars mode={mode} />
                  ) : (
                    <Bars
                      bars={bars}
                      mode={mode}
                      medianSeries={medianSeries}
                      yearWords={yearWords}
                      yearEntriesCount={yearEntriesCount}
                      year={year}
                    />
                  )}
                </div>
                {!loading && (
                  <MoodWordsOverlay
                    notes={notes}
                    buckets={bucketSpans}
                    wordsSeries={bars.map((b) => b.words)}
                    mode={mode}
                  />
                )}
              </section>

              {/* Годовой хитмап: сетка дней с записями за `year` в стиле
                  GitHub. `highlightRange` и `scrollToKey` задаются кликами по
                  KPI-плиткам Trophy и Flame (побеждает последний клик). Клик по
                  ячейке переключает график выше в режим "day" на нужный месяц,
                  чтобы юзер попал на нужный кусок без скролла. */}
              <YearHeatmap
                year={year}
                dailyDaySet={days}
                wordsByDayKey={wordsByDayKey}
                highlightRange={highlightRange}
                scrollToKey={scrollToKey}
                onCellClick={(key) => {
                  // key это YYYY-MM-DD из dayKey(), split+map безопасны.
                  const [y, m] = key.split("-").map(Number);
                  setMode("day");
                  setYear(y);
                  setMonth(m - 1);
                  setScrollToKey(key);
                }}
              />
              {!loading && days.size > 0 && <HeatmapCaption days={days} />}
            </div>

            {/* Правый рейл: Недавнее и Топ тегов. Оба виджета сами аккуратно
                прячутся, когда данных нет. */}
            <aside className="space-y-6 min-w-0">
              <RecentRail notes={notes} />
              <TopTagsLeaderboard notes={notes} />
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Подкомпоненты ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  iconClass,
  value,
  unit,
  label,
  onClick,
  sparkline,
  chip,
}: {
  icon: LucideIcon;
  iconClass: string;
  value: string;
  unit?: string;
  label: string;
  /** Необязательный обработчик клика. Если задан, обёртка становится кнопкой с
   *  hover/focus, если нет, рисуем тот же статичный div без изменений, чтобы
   *  некликабельные вызовы остались байт-в-байт прежними. */
  onClick?: () => void;
  /** Необязательный ряд из 7 точек, рисуется крошечным спарклайном 56x16 под
   *  значением. Скрыт, если все значения нули (чтобы холодная карточка была
   *  чистой). */
  sparkline?: number[];
  /** Необязательный чип справа на строке значения (дельта к медиане). */
  chip?: React.ReactNode;
}) {
  const base =
    "rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3.5";
  const interactive =
    "text-left transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-border)] cursor-pointer";
  // Вертикальный стек, чтобы чип и спарклайн не теснили строку значения. Раньше
  // чип был на одной строке со значением и единицей (justify-between), и на
  // узких карточках (например плитка Сегодня с "+50 к медиане") он налезал на
  // единицу. Теперь подпись, значение с единицей, спарклайн, чип, каждое на
  // своей строке. Высота карточки авто, так что пустые плитки (без спарклайна
  // и чипа) остаются компактными.
  const hasSpark = sparkline && sparkline.some((v) => v > 0);
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-zinc-500 mb-2">
        <Icon size={13} strokeWidth={2} className={iconClass} />
        <span className="text-[10.5px] uppercase tracking-wider font-semibold truncate">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="text-2xl font-semibold text-zinc-100 tabular-nums">
          {value}
        </span>
        {unit && <span className="text-[12px] text-zinc-500">{unit}</span>}
      </div>
      {hasSpark && <Sparkline values={sparkline} />}
      {chip && <div className={hasSpark ? "mt-1.5" : "mt-2"}>{chip}</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        // Явный role и keydown на Enter/Space, чтобы юзеры с клавиатуры
        // получили тот же клик. Требует контракт "кликабельных KPI" в проекте.
        role="button"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(base, interactive)}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

/** Крошечная полилиния 56x16 по тому же рецепту, что и оверлей медианы в Bars,
 *  урезанная до одного сегмента (без null). `currentColor` приходит от
 *  родительского токена text-muted, `vector-effect="non-scaling-stroke"`
 *  держит волосок резким несмотря на `preserveAspectRatio="none"`. Возвращает
 *  null, когда рисовать нечего (n<2 или ряд из одних нулей, второй случай уже
 *  отсечён вызывающим, но подстрахуемся и тут). */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  // `, 1` страхует от деления на ноль, тот же приём, что и у peakIdx.
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => `${i},${100 - (v / max) * 100}`)
    .join(" ");
  return (
    <svg
      aria-hidden
      className="block w-14 h-4 text-[var(--color-text-muted)] mt-2"
      viewBox={`0 0 ${values.length - 1} 100`}
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.55}
        strokeWidth={0.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        points={points}
      />
    </svg>
  );
}

/** Компактный чип дельты для карточки Сегодня: сегодняшние слова против медианы
 *  за 7 дней. Изумрудный сверху, нейтральный zinc снизу (красный держим под
 *  ошибки, написать меньше медианы это не ошибка). При delta=0 чип скрыт
 *  целиком: ArrowDown над "0 к медиане" читается как "написал на 0 меньше
 *  медианы", бессмыслица. Полный контекст лежит в нативном title=, так что чип
 *  может быть крошечным и не терять смысл. */
function MedianChip({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  const tone = positive
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-[var(--color-border)] bg-white/[0.04] text-zinc-400";
  const Icon = positive ? ArrowUp : ArrowDown;
  return (
    <span
      title={`${positive ? "+" : ""}${fmt(delta)} vs медиана за 7 дней`}
      className={`inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full border ${tone}`}
    >
      <Icon size={10} strokeWidth={2.4} />
      <span className="tabular-nums">
        {positive ? "+" : ""}
        {fmt(delta)}
      </span>
    </span>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (v: Granularity) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-white/[0.04]">
      {GRANULARITIES.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => onChange(g.id)}
          className={cn(
            "px-2.5 py-1 rounded text-[12px] transition-colors",
            value === g.id
              ? "bg-white/[0.08] text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300",
          )}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

function PeriodNav({
  label,
  wide,
  atStart,
  atEnd,
  onPrev,
  onNext,
}: {
  label: string;
  wide: boolean;
  atStart: boolean;
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <NavBtn label={t("Назад")} disabled={atStart} onClick={onPrev}>
        <ChevronLeft size={15} strokeWidth={2} />
      </NavBtn>
      <span
        className={cn(
          "text-[13px] font-semibold text-zinc-200 tabular-nums text-center",
          wide ? "w-32" : "w-12",
        )}
      >
        {label}
      </span>
      <NavBtn label={t("Вперёд")} disabled={atEnd} onClick={onNext}>
        <ChevronRight size={15} strokeWidth={2} />
      </NavBtn>
    </div>
  );
}

function NavBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const Bars = memo(function Bars({
  bars,
  mode,
  medianSeries,
  yearWords,
  yearEntriesCount,
  year,
}: {
  bars: Bar[];
  mode: Granularity;
  /** Ряд скользящей медианы, ровно 1:1 с `bars`. Слоты `null` рисуются как
   *  разрывы (линия рвётся на недозаполненном начале). Передай `null`, чтобы
   *  выключить оверлей совсем (так делает режим месяца). */
  medianSeries?: (number | null)[] | null;
  /** Итоги по году, переехавшие из KPI-сетки в подпись графика. Строка KPI
   *  теперь несёт Сегодня и За неделю, так что годовые числа живут тут
   *  подписью под строкой пика. */
  yearWords: number;
  yearEntriesCount: number;
  year: number;
}) {
  // Один проход по столбикам: total, max, peakIdx. Два плюса против старых трёх
  // отдельных сканов: (1) `Math.max(...bars.map(...))` на дневных столбиках
  // рисковал переполнить стек при 31 и более аргументах на некоторых движках,
  // (2) нет промежуточных аллокаций массивов. `peakIdx === -1` заодно сигналит
  // про пустой ряд или одни нули, экономя отдельный ранний выход по
  // `total === 0`.
  let total = 0;
  let max = 0;
  let peakIdx = -1;
  for (let i = 0; i < bars.length; i++) {
    const w = bars[i].words;
    total += w;
    if (w > max) {
      max = w;
      peakIdx = i;
    }
  }

  // Индекс наведения для своего стеклянного тултипа. Живёт внутри Bars, чтобы
  // сбрасываться при листании периодов (идентичность компонента
  // переиспользуется, меняется только массив `bars`, так что устаревший
  // hoverIdx на новом наборе не уронит, но сброс при уходе мыши держит
  // контракт чистым).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (total === 0 || peakIdx === -1) {
    return (
      <ChartFrame>
        <div className="h-44 flex items-center justify-center text-[13px] text-zinc-600">
          Нет записей за этот период
        </div>
      </ChartFrame>
    );
  }

  // Зазор поплотнее, когда столбиков много (недели, дни).
  const gap = bars.length <= 12 ? "gap-1.5" : "gap-[2px]";

  // Строим полилинию медианы как набор сплошных сегментов: `null` рвёт линию,
  // так что недозаполненное начало рисуется настоящим разрывом, а не отрезком
  // в ноль.
  const medianSegments = medianSegmentsFor(medianSeries, max, bars.length);

  return (
    <ChartFrame>
      <div className={cn("relative", gap === "gap-1.5" ? "" : "")}>
        <div className={cn("flex items-end h-44", gap)}>
        {bars.map((b, i) => (
          // Колонка во всю высоту И ЕСТЬ зона наведения (каждая `flex-1`
          // колонка тянется на высоту ряда столбиков, так что hover ловится
          // где угодно в колонке, а не только на 2px заливке столбика).
          // `title=` оставлен как запасной для скринридера и скриншотов,
          // React-тултип это визуальный hover и побеждает на реальном курсоре.
          <div
            // Стабильный key, переживает смену режима без путаницы с
            // переиспользованием DOM. `name` уникален внутри графика во всех
            // трёх режимах.
            key={b.name || b.label || `${mode}-${i}`}
            className="flex-1 flex flex-col items-center justify-end gap-2 h-full min-w-0"
            title={tooltip(mode, b)}
            onMouseEnter={() => setHoverIdx(i)}
            // Страхуемся от запоздалого `leave`, который затрёт быстрый `enter`
            // на следующий столбик: обнуляем, только если мы ещё активны.
            onMouseLeave={() =>
              setHoverIdx((prev) => (prev === i ? null : prev))
            }
          >
            <div className="w-full flex-1 flex items-end">
              <div
                style={{ height: `${(b.words / max) * 100}%` }}
                className={cn(
                  "w-full rounded-t-[3px] transition-colors",
                  b.words === 0 && "min-h-[2px]",
                  i === peakIdx
                    ? "bg-[var(--color-accent)]"
                    : "bg-[var(--color-accent)]/55 hover:bg-[var(--color-accent)]/80",
                )}
              />
            </div>
            {/* Подпись центрирована абсолютно, чтобы широкая подпись (например
                маркер месяца над тонкой колонкой недели) могла вылезти в пустых
                соседей, не расширяя колонку и не сдвигая вёрстку. */}
            <div className="relative h-3 w-full">
              {b.label && (
                <span className="absolute left-1/2 -translate-x-1/2 text-[11px] leading-tight text-zinc-600 select-none whitespace-nowrap">
                  {b.label}
                </span>
              )}
            </div>
          </div>
        ))}
        </div>
        {/* Стеклянный тултип над наведённой колонкой.
            ПОЗИЦИЯ: якорим через `left:%` на обёртке (он считается от ширины
            родителя, в отличие от `translateX(%)`, который считается от
            СОБСТВЕННОЙ ширины тултипа и тут бессмыслен). Пара
            `left: ((hoverIdx + 0.5) / N) * 100%` плюс `translateX(-50%)`
            центрирует тултип по колонке, дальше зажимаем в процентный коридор,
            чтобы панель не вывалилась из ChartFrame на крайних столбиках.
            АНИМАЦИЯ: анимируем только `opacity`. framer-motion пишет свою
            transform-строку для x/y/scale и затёр бы инлайновый
            translateX(-50%). Только фейд сохраняет центрирование на всей
            анимации. У motion.div постоянный `key="bar-tooltip"`, так что
            enter/exit анимируются только на вход и выход мыши, прыжки между
            столбиками обновляют контент мгновенно. */}
        <AnimatePresence>
          {hoverIdx !== null && bars[hoverIdx] && (
            <motion.div
              key="bar-tooltip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
              aria-hidden="true"
              className="absolute bottom-full mb-2 px-3 py-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-overlay)] shadow-[var(--shadow-float)] backdrop-blur-xl backdrop-saturate-[1.7] pointer-events-none whitespace-nowrap"
              style={{
                // (i + 0.5) / N это центр наведённой колонки, потом зажимаем в
                // [4%, 96%], чтобы тултип не вылез за края графика в плотных
                // режимах (неделя=53, день около 30 столбиков).
                left: `${Math.max(4, Math.min(96, ((hoverIdx + 0.5) / bars.length) * 100))}%`,
                transform: "translateX(-50%)",
              }}
            >
              <BarTooltip
                bar={bars[hoverIdx]}
                prev={hoverIdx > 0 ? bars[hoverIdx - 1] : null}
                mode={mode}
                index={hoverIdx}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {/* Оверлей скользящей медианы: тонкая статичная линия приглушённого
            цвета текста, чтобы визуально была позади столбиков.
            `pointer-events-none` не мешает hover столбиков,
            `vector-effect="non-scaling-stroke"` держит линию постоянной
            пиксельной ширины при любой ширине графика. preserveAspectRatio="none"
            растягивает полилинию ровно под ряд столбиков (низ viewBox совпадает
            с базой столбиков). */}
        {medianSegments && medianSegments.length > 0 && (
          <svg
            className="absolute inset-0 pointer-events-none"
            // Высота SVG совпадает только с рядом столбиков, полоску подписей в
            // 12px снизу намеренно НЕ накрываем.
            style={{ height: "calc(100% - 0.75rem - 0.5rem)" }}
            viewBox={`0 0 ${bars.length} 100`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {medianSegments.map((seg, idx) => (
              <polyline
                key={idx}
                fill="none"
                stroke="var(--color-text-muted)"
                strokeOpacity={0.6}
                strokeWidth={0.4}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                points={seg}
              />
            ))}
          </svg>
        )}
      </div>
      <p className="mt-3 pt-3 border-t border-[var(--color-border)] text-[12px] text-zinc-500">
        {peakNoun(mode)} ,{" "}
        <span className="text-zinc-300">{bars[peakIdx].name}</span> ({fmt(max)}{" "}
        {pluralWords(max)})
        <span className="block mt-1">
          За {year}:{" "}
          <span className="text-zinc-300 tabular-nums">{fmt(yearWords)}</span>{" "}
          {pluralWords(yearWords)} в{" "}
          <span className="text-zinc-300 tabular-nums">
            {fmt(yearEntriesCount)}
          </span>{" "}
          {pluralNotes(yearEntriesCount)}
        </span>
      </p>
    </ChartFrame>
  );
});

/** Содержимое стеклянного тултипа столбика, три строки: имя периода, сумма и
 *  чип дельты против прошлого столбика (на первом столбике и при нулевой дельте
 *  опущен). Процент дельты зажат, чтобы почти нулевой предшественник не раздул
 *  чип до "+9900%". */
function BarTooltip({
  bar,
  prev,
  mode,
  index,
}: {
  bar: Bar;
  prev: Bar | null;
  mode: Granularity;
  index: number;
}) {
  const title = mode === "week" ? `Неделя ${bar.name}` : bar.name;
  const amount = `${fmt(bar.words)} ${pluralWords(bar.words)}`;

  let chip: React.ReactNode = null;
  if (index > 0 && prev) {
    const delta = bar.words - prev.words;
    if (delta !== 0) {
      const tone =
        delta > 0
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-[var(--color-border)] bg-white/[0.04] text-zinc-400";
      const Icon = delta > 0 ? ArrowUp : ArrowDown;
      // Процент только при prev.words > 0, иначе абсолют (защита от /0 и Infinity).
      let body: string;
      if (prev.words === 0) {
        body = `${delta > 0 ? "+" : ""}${fmt(delta)}`;
      } else {
        const pctRaw = Math.round((delta / prev.words) * 100);
        const capped = Math.max(-999, Math.min(999, pctRaw));
        const prefix = delta > 0 ? "+" : "";
        body = `${prefix}${capped}%`;
      }
      chip = (
        <span
          className={`inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded-full border ${tone}`}
        >
          <Icon size={10} strokeWidth={2.4} />
          <span className="tabular-nums">{body}</span>
        </span>
      );
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="text-[12px] text-zinc-300 font-medium">{title}</div>
        {chip}
      </div>
      <div className="text-[11px] text-zinc-500 tabular-nums mt-0.5">
        {amount}
      </div>
    </>
  );
}

/**
 * Режет ряд медианы на сплошные строки `points` для полилиний, по одной на
 * каждый непрерывный кусок не-null значений. Слоты `null` дают разрывы в линии
 * вместо отрезка в ноль. Каждый x в центре столбика (`i + 0.5`), каждый y это
 * инвертированный процент от `max` (так что у viewBox SVG `y=0` это верх
 * графика, а `y=100` это база). Возвращает null, когда рисовать нечего (нет
 * ряда, нет положительного max или нет не-null значений).
 */
function medianSegmentsFor(
  series: (number | null)[] | null | undefined,
  max: number,
  count: number,
): string[] | null {
  if (!series || max <= 0 || count === 0) return null;
  const segments: string[] = [];
  let current: string[] = [];
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${i + 0.5},${100 - (v / max) * 100}`);
  }
  if (current.length > 1) segments.push(current.join(" "));
  return segments.length > 0 ? segments : null;
}

function ChartFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      {children}
    </div>
  );
}

/** Заглушка для `<Bars/>` на время загрузки. Рисует приглушённые столбики
 *  фиксированной псевдослучайной высоты, чтобы они не дёргались между
 *  рендерами, и пульсирует через `animate-pulse` из Tailwind. Живёт в той же
 *  оболочке `ChartFrame`, чтобы подмена на реальный график не дёргала вёрстку.
 *
 *  ЧИСЛО столбиков совпадает с текущим `mode` (12 / ~53 / ~30), чтобы при
 *  приходе данных они не переразложились по горизонтали. Высоты это крошечный
 *  LCG-подобный хэш от `i`, детерминированный и стабильный на каждом рендере,
 *  без `Math.random()` в рендере. Bars использует `gap-1.5` для 12 и менее
 *  столбиков и `gap-[2px]` иначе, тут повторяем. */
const SKELETON_BAR_COUNTS: Record<Granularity, number> = {
  month: 12,
  week: 53,
  day: 30,
};
const skeletonHeight = (i: number): number =>
  25 + ((i * 9301 + 49297) % 7000) / 100;

function SkeletonBars({ mode }: { mode: Granularity }) {
  const count = SKELETON_BAR_COUNTS[mode];
  const gap = count <= 12 ? "gap-1.5" : "gap-[2px]";
  return (
    <ChartFrame>
      <div className={`flex items-end h-44 ${gap} animate-pulse`}>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            style={{ height: `${skeletonHeight(i)}%` }}
            className="flex-1 rounded-t-[3px] bg-white/[0.04]"
          />
        ))}
      </div>
      {/* Резервируем ту же строку подписи, что и Bars, чтобы подмена на
          реальный график не сдвигала контент ниже на строку. Подпись теперь в
          две строки (пик и итоги года), поэтому заглушка выше старой
          однострочной. */}
      <div className="mt-3 pt-3 border-t border-[var(--color-border)] h-[36px]" />
    </ChartFrame>
  );
}

/** Строка-сводка под годовым хитмапом: заполнено столько-то из стольких-то
 *  дней (с процентом) и самый длинный пропуск. Вызывающий уже проверяет
 *  `days.size > 0`, так что null из `coverageStats` это лишь подстраховка. */
function HeatmapCaption({ days }: { days: Set<string> }) {
  const stats = useMemo(() => coverageStats(days), [days]);
  if (!stats) return null;
  return (
    <p className="mt-3 text-[12px] text-zinc-500">
      Заполнено:{" "}
      <span className="text-zinc-300 tabular-nums">{fmt(stats.written)}</span>/
      <span className="tabular-nums">{fmt(stats.total)}</span>{" "}
      {pluralDays(stats.total)} (
      <span className="tabular-nums">{stats.pct}%</span>) · самый длинный
      пропуск:{" "}
      <span className="text-zinc-300 tabular-nums">
        {fmt(stats.longestGap)}
      </span>{" "}
      {pluralDays(stats.longestGap)}
    </p>
  );
}

function tooltip(mode: Granularity, b: Bar): string {
  const amount = `${fmt(b.words)} ${pluralWords(b.words)}`;
  return mode === "week" ? `Неделя ${b.name}: ${amount}` : `${b.name}: ${amount}`;
}

function peakNoun(mode: Granularity): string {
  if (mode === "month") return "Самый продуктивный месяц";
  if (mode === "week") return "Самая продуктивная неделя";
  return "Самый продуктивный день";
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function pluralDays(n: number): string {
  return plural(n, "день", "дня", "дней");
}

function pluralWords(n: number): string {
  return plural(n, "слово", "слова", "слов");
}

function pluralNotes(n: number): string {
  return plural(n, "запись", "записи", "записей");
}
