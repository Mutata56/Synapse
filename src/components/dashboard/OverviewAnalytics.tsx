import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, FileText, RefreshCw } from "lucide-react";
import { dailyDateOf, dayKey } from "../../lib/daily";
import { overviewCount } from "../../lib/overviewFormat";
import { getLanguage, t } from "../../lib/i18n";
import { loadOverviewWords, overviewWordResource, type OverviewWordLoader } from "../../lib/overviewWords";
import { recentOverviewNotes } from "../../lib/overviewModel";
import type { NoteMeta } from "../../lib/storage";
import { currentStreak, dailyDaySet, longestStreak, medianOf, totalWords, wordsByDay, wordsByMonth, wordsByWeek, type WordEntry } from "../../lib/writingStats";
import { OverviewNoteRow } from "./OverviewNoteRow";
import { MoodWordsOverlay } from "./MoodWordsOverlay";
import { YearHeatmap } from "./YearHeatmap";

type Mode = "day" | "week" | "month";
type Metric = "notes" | "words";
type Bar = { value: number; startMs: number; endMs: number; label: string; name: string };

function barsFor(entries: WordEntry[], mode: Mode, year: number, month: number, locale: string): Bar[] {
  if (mode === "week") return wordsByWeek(entries, year).map((bucket, index) => {
    const start = new Date(bucket.startMs), end = new Date(start); end.setDate(end.getDate() + 7);
    return { value: bucket.words, startMs: start.getTime(), endMs: end.getTime(), label: index % 4 === 0 ? start.toLocaleDateString(locale, { day: "numeric", month: "short" }) : "", name: start.toLocaleDateString(locale, { day: "numeric", month: "long" }) };
  });
  const values = mode === "month" ? wordsByMonth(entries, year) : wordsByDay(entries, year, month);
  return values.map((value, index) => {
    const start = new Date(year, mode === "month" ? index : month, mode === "day" ? index + 1 : 1);
    const end = new Date(year, mode === "month" ? index + 1 : month, mode === "day" ? index + 2 : 1);
    return { value, startMs: start.getTime(), endMs: end.getTime(), label: mode === "month" ? start.toLocaleDateString(locale, { month: "short" }) : index === 0 || (index + 1) % 5 === 0 ? String(index + 1) : "", name: start.toLocaleDateString(locale, mode === "month" ? { month: "long", year: "numeric" } : { day: "numeric", month: "long" }) };
  });
}

export default function OverviewAnalytics({ notes, today, loadWords = loadOverviewWords, onOpen }: { notes: readonly NoteMeta[]; today: string; loadWords?: OverviewWordLoader; onOpen: (id: string) => void }) {
  const todayDate = useMemo(() => new Date(`${today}T12:00:00`), [today]);
  const [metric, setMetric] = useState<Metric>("notes");
  const [mode, setMode] = useState<Mode>("month");
  const [year, setYear] = useState(() => todayDate.getFullYear());
  const [month, setMonth] = useState(() => todayDate.getMonth());
  const [selected, setSelected] = useState<number | null>(null);
  const [entries, setEntries] = useState<WordEntry[] | null>(null);
  const [resolvedRevision, setResolvedRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showMedian, setShowMedian] = useState(false);
  const chartScroll = useRef<HTMLDivElement>(null);
  const revision = useMemo(() => overviewWordResource.version(notes), [notes]);
  const locale = getLanguage() === "en" ? "en-GB" : "ru-RU";
  useEffect(() => {
    if (metric !== "words") return;
    let cancelled = false; setLoading(true); setError(false);
    overviewWordResource.load(notes, loadWords).then(rows => {
      if (!cancelled) { setEntries(rows); setResolvedRevision(revision); setLoading(false); }
    }).catch(() => { if (!cancelled) { setLoading(false); setError(true); } });
    return () => { cancelled = true; };
    // Metadata-only changes keep the same exact content revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, revision, loadWords, retry]);

  const changed = useMemo(() => notes.filter(note => Number.isFinite(note.updatedAt) && note.updatedAt > 0).map(note => ({ createdAt: note.updatedAt, words: 1 })), [notes]);
  const years = useMemo(() => {
    const values = new Set([todayDate.getFullYear()]);
    for (const note of notes) for (const value of [note.createdAt, note.updatedAt]) if (Number.isFinite(value) && value > 0) values.add(new Date(value).getFullYear());
    return [...values].sort((a, b) => b - a);
  }, [notes, todayDate]);
  const bars = useMemo(() => barsFor(metric === "words" ? entries ?? [] : changed, mode, year, month, locale), [metric, entries, changed, mode, year, month, locale]);
  const max = Math.max(1, ...bars.map(bar => bar.value));
  const sum = bars.reduce((value, bar) => value + bar.value, 0);
  const median = useMemo(() => medianOf(bars.map(bar => bar.value)), [bars]);
  const busy = metric === "words" && (loading || (!error && resolvedRevision !== revision));
  const wordsUnavailable = metric === "words" && (busy || error || !entries);
  const selectedBar = selected === null || wordsUnavailable ? null : bars[selected] ?? null;
  const related = useMemo(() => {
    if (!selectedBar) return [];
    const timestamp = (note: NoteMeta) => metric === "words" ? note.createdAt : note.updatedAt;
    return recentOverviewNotes(notes, 6, note => timestamp(note) >= selectedBar.startMs && timestamp(note) < selectedBar.endMs && new Date(timestamp(note)).getFullYear() === year);
  }, [notes, metric, selectedBar, year]);
  const days = useMemo(() => dailyDaySet([...notes]), [notes]);
  const streak = useMemo(() => currentStreak(days, todayDate), [days, todayDate]);
  const record = useMemo(() => longestStreak(days), [days]);
  const wordsByDayKey = useMemo(() => {
    const values = new Map<string, number>();
    if (metric !== "words" || wordsUnavailable) return values;
    for (const entry of entries ?? []) { const key = dayKey(entry.createdAt); values.set(key, (values.get(key) ?? 0) + entry.words); }
    return values;
  }, [entries, metric, wordsUnavailable]);
  const period = mode === "day" ? new Date(year, month, 1).toLocaleDateString(locale, { month: "long", year: "numeric" }) : String(year);
  useEffect(() => {
    const scroll = chartScroll.current;
    const target = scroll?.querySelector<HTMLElement>('[aria-current="date"]');
    if (!scroll || !target) return;
    const revealCurrent = () => { scroll.scrollLeft += target.getBoundingClientRect().left - scroll.getBoundingClientRect().left - scroll.clientWidth / 2 + target.offsetWidth / 2; };
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(scroll); revealCurrent();
    return () => observer.disconnect();
  }, [mode, year, month, metric, busy, error, today]);
  const navigate = (direction: number) => {
    setSelected(null);
    if (mode === "day") { const date = new Date(year, month + direction, 1); setYear(date.getFullYear()); setMonth(date.getMonth()); }
    else setYear(value => value + direction);
  };
  const chooseMetric = (value: Metric) => { if (value === "words" && metric !== "words") setLoading(true); setSelected(null); setMetric(value); };

  return <div className="overview-sheet overview-analytics">
    <div className="overview-analysis-heading"><div><h2>{t("Посмотреть на базу целиком")}</h2><p>{metric === "notes" ? t("Заметки по дате последнего изменения. Каждый файл учитывается один раз.") : t("Текущий объём текстов по дате создания заметок. Это не история каждого редактирования.")}</p></div><div className="overview-metric-toggle" aria-label={t("Показатель")}><button type="button" aria-pressed={metric === "notes"} onClick={() => chooseMetric("notes")}>{t("Заметки")}</button><button type="button" aria-pressed={metric === "words"} onClick={() => chooseMetric("words")}>{t("Объём текстов")}</button></div></div>
    <div className="overview-analysis-summary"><span><strong>{notes.length.toLocaleString(locale)}</strong>{t("заметок в базе")}</span><span><strong aria-label={wordsUnavailable && !busy ? t("Недоступно") : undefined}>{busy ? "…" : wordsUnavailable ? "—" : sum.toLocaleString(locale)}</strong>{metric === "words" ? t("слов в периоде") : t("изменённых в периоде")}</span>{metric === "words" && <span><strong aria-label={wordsUnavailable && !busy ? t("Недоступно") : undefined}>{busy ? "…" : wordsUnavailable ? "—" : totalWords(entries ?? []).toLocaleString(locale)}</strong>{t("слов во всей базе")}</span>}<label>{t("Год")}<select aria-label={t("Год статистики")} value={year} onChange={event => { setYear(Number(event.target.value)); setSelected(null); }}>{[...new Set([year, ...years])].sort((a, b) => b - a).map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
    <section className="overview-chart-section">
      <div className="overview-chart-toolbar"><div className="overview-mode-toggle" aria-label={t("Группировка")} >{(["day", "week", "month"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setSelected(null); setMode(value); }}>{value === "day" ? t("Дни") : value === "week" ? t("Недели") : t("Месяцы")}</button>)}</div><div className="overview-period"><button type="button" aria-label={t("Предыдущий период")} onClick={() => navigate(-1)}><ChevronLeft size={16} /></button><span>{period}</span><button type="button" aria-label={t("Следующий период")} onClick={() => navigate(1)}><ChevronRight size={16} /></button></div><button type="button" className="overview-median-toggle" aria-pressed={showMedian} onClick={() => setShowMedian(value => !value)}>{t("Медиана")}</button></div>
      {busy ? <div className="overview-chart-state" role="status">{t("Считаем слова…")}</div> : error && metric === "words" ? <div className="overview-chart-state" role="alert"><p>{t("Не удалось загрузить статистику текстов")}</p><button className="overview-secondary" type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />{t("Повторить")}</button></div> : sum === 0 ? <div className="overview-chart-state"><FileText size={26} /><p>{t("В этом периоде пока нет записей")}</p><button className="overview-text-action" type="button" onClick={() => { setYear(todayDate.getFullYear()); setMonth(todayDate.getMonth()); setSelected(null); }}>{t("Вернуться к текущему периоду")}</button></div> : <>
        <div className="overview-chart-scroll" ref={chartScroll}><div className="overview-chart" style={{ "--overview-bar-count": bars.length } as CSSProperties} role="group" aria-label={t("График статистики")}><div className="overview-chart-grid"><span>{max.toLocaleString(locale)}</span><span>{Math.round(max / 2).toLocaleString(locale)}</span><span>0</span></div><div className="overview-chart-bars" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(24px, 1fr))` }} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")], current = buttons.indexOf(event.target as HTMLButtonElement);
          if (current < 0) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1))); buttons[next]?.focus();
        }}>{showMedian && <div className="overview-chart-median" style={{ bottom: `${median / max * 100}%` }}><span>{t("Медиана")}: {median.toLocaleString(locale)}</span></div>}{bars.map((bar, index) => <button key={bar.startMs} type="button" className="overview-bar" aria-current={todayDate.getTime() >= bar.startMs && todayDate.getTime() < bar.endMs ? "date" : undefined} aria-pressed={selected === index} aria-label={`${bar.name}: ${overviewCount(bar.value, metric === "words" ? "word" : "note")}`} title={`${bar.name}: ${bar.value.toLocaleString(locale)}`} onClick={() => setSelected(selected === index ? null : index)}><span className="overview-bar-fill" style={{ height: `${Math.max(1, bar.value / max * 100)}%` }} /><span className="overview-bar-value">{bar.value.toLocaleString(locale)}</span><span className="overview-bar-label">{bar.label}</span></button>)}</div></div></div>
        <p className="overview-chart-help">{t("Выбери столбик, чтобы увидеть заметки этого периода.")}</p>
        {metric === "words" && <MoodWordsOverlay notes={[...notes]} buckets={bars.map(bar => ({ startMs: bar.startMs, endMs: bar.endMs }))} wordsSeries={bars.map(bar => bar.value)} mode={mode} />}
      </>}
    </section>
    {selectedBar && <section className="overview-analysis-notes"><div className="overview-section-heading"><h2>{selectedBar.name}</h2><button type="button" className="overview-quiet-action" onClick={() => setSelected(null)}>{t("Снять выделение")}</button></div>{related.map(note => <OverviewNoteRow key={note.id} note={note} onOpen={onOpen} />)}{!related.length && <p className="overview-muted">{t("В этом периоде пока нет записей")}</p>}</section>}
    {days.size > 0 && <section className="overview-journal"><div className="overview-section-heading"><h2>{t("Ежедневные записи")}</h2><span>{t("Серия: {current} · рекорд: {record}", { current: streak, record })}</span></div><YearHeatmap year={year} dailyDaySet={days} wordsByDayKey={wordsByDayKey} highlightRange={null} scrollToKey={null} onCellClick={key => { const note = notes.find(note => dailyDateOf(note.id) === key); if (note) onOpen(note.id); }} /></section>}
  </div>;
}
