/**
 * Минимальный ридер iCalendar (RFC 5545) для оверлея календаря только на чтение.
 *
 * Скоуп сознательно узкий, ровно чтобы показать удалённый календарь (скажем,
 * приватный экспорт `.ics` из Яндекс.Календаря) на нашей сетке месяца:
 *   только VEVENT (VTODO, VJOURNAL, будильники игнорим)
 *   DTSTART / DTEND, весь день (VALUE=DATE), UTC (…Z) и локальное/плавающее время
 *   базовое разворачивание RRULE (DAILY, WEEKLY+BYDAY, MONTHLY, YEARLY,
 *     INTERVAL, COUNT, UNTIL) плюс исключения EXDATE
 *
 * IANA TZID uses Intl's timezone database; UTC repeats stay UTC. Floating
 * times and all-day dates follow the machine's zone. Custom VTIMEZONE aliases
 * without an IANA name are reported as unsupported, never silently remapped.
 */

import { ICAL_DAY_MS as DAY_MS, parseIcsTime, wallDate, wallInstant } from "./icsTime";

/** Жёсткий лимит на число сгенерированных повторов одного события, страховка от
 *  кривого/бесконечного RRULE, который крутился бы вечно. Хватает, чтобы пройти
 *  десятилетия ежедневной/недельной серии, начавшейся задолго до видимого окна. */
const MAX_OCCURRENCES = 10_000;

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

type RRule = {
  freq: Freq;
  interval: number;
  count?: number;
  /** Конец серии включительно, ms epoch. */
  until?: number;
  /** Дни недели для WEEKLY (0=вс, 6=сб), как у JS `Date.getDay()`. */
  byday?: number[];
  weekStart?: number;
};

/** Событие календаря, как распарсили из фида. Через `rrule` может описывать
 *  целую серию. В конкретные `CalEvent` разворачивает {@link expandEvents}. */
export type ParsedEvent = {
  uid: string;
  summary: string;
  location?: string;
  /** Начало первого повтора, ms epoch. */
  start: number;
  /** Конец первого повтора, ms epoch. */
  end: number;
  allDay: boolean;
  timeZone?: string;
  /** Calendar-day length for DATE values; a DST day need not be 24 hours. */
  durationDays?: number;
  recurrenceId?: number;
  cancelled?: boolean;
  rrule?: RRule;
  /** Исключённые начала повторов (ms epoch). */
  exDates?: number[];
};

/** Конкретный одиночный повтор, готовый к рендеру. */
export type CalEvent = {
  uid: string;
  summary: string;
  location?: string;
  start: number;
  end: number;
  allDay: boolean;
};

/** Парсит документ iCalendar в события (серии остаются неразвёрнутыми). */
export function parseIcs(text: string): ParsedEvent[] {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];

  let cur: Partial<ParsedEvent> | null = null;
  let exDates: number[] = [];

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      exDates = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && typeof cur.start === "number") {
        const allDay = cur.allDay ?? false;
        const defaultEnd = new Date(cur.start);
        if (allDay) defaultEnd.setDate(defaultEnd.getDate() + 1);
        const end = typeof cur.end === "number" ? cur.end : allDay ? defaultEnd.getTime() : cur.start;
        const durationDays = allDay ? Math.max(1, Math.round((wallDate(end).getTime() - wallDate(cur.start).getTime()) / DAY_MS)) : undefined;
        events.push({
          uid: cur.uid || randomId(),
          summary: cur.summary || "(без названия)",
          location: cur.location,
          start: cur.start,
          end,
          allDay,
          timeZone: cur.timeZone,
          durationDays,
          recurrenceId: cur.recurrenceId,
          cancelled: cur.cancelled,
          rrule: cur.rrule,
          exDates: exDates.length ? exDates : undefined,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const parsed = parseContentLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    switch (name) {
      case "UID":
        cur.uid = value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(value);
        break;
      case "LOCATION":
        cur.location = unescapeText(value) || undefined;
        break;
      case "DTSTART": {
        const d = parseIcsDate(value, params);
        if (d) {
          cur.start = d.ms;
          cur.allDay = d.allDay;
          cur.timeZone = d.zone;
        }
        break;
      }
      case "DTEND": {
        const d = parseIcsDate(value, params);
        if (d) cur.end = d.ms;
        break;
      }
      case "RRULE": {
        const r = parseRRule(value);
        if (r) cur.rrule = r;
        break;
      }
      case "RECURRENCE-ID": {
        const date = parseIcsDate(value, params);
        if (date) { cur.recurrenceId = date.ms; if (cur.start === undefined) { cur.start = date.ms; cur.allDay = date.allDay; cur.timeZone = date.zone; } }
        break;
      }
      case "STATUS": cur.cancelled = value.trim().toUpperCase() === "CANCELLED"; break;
      case "EXDATE": {
        for (const piece of value.split(",")) {
          const d = parseIcsDate(piece, params);
          if (d) exDates.push(d.ms);
        }
        break;
      }
    }
  }

  return events;
}

/**
 * Разворачивает события (в том числе повторяющиеся серии) в конкретные повторы,
 * пересекающие `[rangeStart, rangeEnd)`. Возвращает их по времени начала.
 */
export function expandEvents(
  events: ParsedEvent[],
  rangeStart: number,
  rangeEnd: number,
): CalEvent[] {
  const out: CalEvent[] = [];
  const overrides = new Map<string, Set<number>>();
  for (const event of events) if (event.recurrenceId !== undefined) {
    if (!overrides.has(event.uid)) overrides.set(event.uid, new Set());
    overrides.get(event.uid)!.add(event.recurrenceId);
  }

  for (const ev of events) {
    if (ev.cancelled) continue;
    const dur = Math.max(0, ev.end - ev.start);
    const touches = (event: CalEvent) => event.start < rangeEnd && (event.end > rangeStart || event.end === event.start && event.start >= rangeStart);

    if (!ev.rrule || ev.recurrenceId !== undefined) {
      const event = toCal(ev, ev.start, dur);
      if (touches(event)) out.push(event);
      continue;
    }

    const rule = ev.rrule;
    const excluded = new Set([...(ev.exDates ?? []), ...(overrides.get(ev.uid) ?? [])]);
    let guard = 0;

    // COUNT counts valid instances, including ones removed by EXDATE.
    for (const { ms: s, idx } of occurrences(rule, ev.start, rangeStart - dur - (ev.allDay ? DAY_MS : 0), ev.timeZone)) {
      if (rule.until != null && s > rule.until) break;
      if (rule.count != null && idx >= rule.count) break;
      // Повторы монотонны, всё за окном уже не покажется.
      if (s >= rangeEnd) break;
      if (s < rangeStart - dur - (ev.allDay ? DAY_MS : 0)) continue;
      if (++guard > MAX_OCCURRENCES) break;
      // EXDATE убирает повтор, но в COUNT выше он всё равно засчитался.
      if (excluded.has(s)) continue;
      const event = toCal(ev, s, dur);
      if (touches(event)) out.push(event);
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

// ─── Повторы ─────────────────────────────────────────────────────────────────

/** Unbounded rules seek near the visible range. Finite rules count only valid
 * instances, so skipped month dates and DST gaps cannot consume COUNT. */
function* occurrences(rule: RRule, startMs: number, seekMs: number, zone?: string): Generator<{ ms: number; idx: number }> {
  const start = wallDate(startMs, zone), seek = wallDate(seekMs, zone);
  const day = start.getUTCDate(), month = start.getUTCMonth();
  const weekStart = rule.weekStart ?? 1;
  const weekOffset = (start.getUTCDay() - weekStart + 7) % 7;
  const week = new Date(start); week.setUTCDate(day - weekOffset);
  const offsets = rule.freq === "WEEKLY" && rule.byday?.length
    ? [...new Set(rule.byday.map(value => (value - weekStart + 7) % 7))].sort((a, b) => a - b) : null;
  let estimate = 0;
  if (rule.freq === "DAILY" || rule.freq === "WEEKLY") estimate = Math.floor((seek.getTime() - start.getTime()) / (DAY_MS * rule.interval * (rule.freq === "WEEKLY" ? 7 : 1)));
  else if (rule.freq === "MONTHLY") estimate = Math.floor(((seek.getUTCFullYear() - start.getUTCFullYear()) * 12 + seek.getUTCMonth() - month) / rule.interval);
  else estimate = Math.floor((seek.getUTCFullYear() - start.getUTCFullYear()) / rule.interval);
  // Finite COUNT needs the actual number of valid instances before the window.
  // Typical finite subscriptions are short; unbounded historical series jump.
  const exactSlots = zone === "UTC" && (rule.freq === "DAILY" || rule.freq === "WEEKLY");
  const first = rule.count === undefined || exactSlots ? Math.max(0, estimate - 1) : 0;
  let idx = exactSlots ? offsets && first > 0 ? offsets.filter(offset => offset >= weekOffset).length + (first - 1) * offsets.length : first : 0;
  for (let step = first, guard = 0; guard++ < 100_000; step++) {
    const n = step * rule.interval;
    const candidates: Date[] = [];
    if (offsets) {
      for (const offset of offsets) { const date = new Date(week); date.setUTCDate(week.getUTCDate() + n * 7 + offset); candidates.push(date); }
    } else {
      const date = new Date(start);
      if (rule.freq === "DAILY" || rule.freq === "WEEKLY") date.setUTCDate(day + n * (rule.freq === "WEEKLY" ? 7 : 1));
      else if (rule.freq === "MONTHLY") {
        date.setUTCDate(1); date.setUTCMonth(month + n); const target = date.getUTCMonth(); date.setUTCDate(day);
        if (date.getUTCMonth() !== target) continue;
      } else {
        date.setUTCFullYear(start.getUTCFullYear() + n);
        if (date.getUTCMonth() !== month || date.getUTCDate() !== day) continue;
      }
      candidates.push(date);
    }
    for (const date of candidates) {
      if (!Number.isFinite(date.getTime())) return;
      const ms = wallInstant(date, zone, true);
      if (ms === null || ms < startMs) continue;
      if (rule.count !== undefined && idx >= rule.count) return;
      yield { ms, idx: idx++ };
    }
  }
}

function parseRRule(value: string): RRule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  const freq = kv.FREQ?.toUpperCase() as Freq | undefined;
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) {
    return null;
  }

  const rule: RRule = {
    freq,
    interval: kv.INTERVAL ? Math.max(1, parseInt(kv.INTERVAL, 10) || 1) : 1,
  };
  if (kv.COUNT) {
    const c = parseInt(kv.COUNT, 10);
    if (Number.isFinite(c) && c > 0) rule.count = c;
  }
  if (kv.UNTIL) {
    const d = parseIcsDate(kv.UNTIL, {});
    if (d) rule.until = d.ms;
  }
  if (kv.BYDAY) {
    const map: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const days = kv.BYDAY.split(",")
      .map((tok) => map[tok.trim().slice(-2).toUpperCase()])
      .filter((n): n is number => n !== undefined);
    if (days.length) rule.byday = [...new Set(days)];
  }
  const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  rule.weekStart = kv.WKST ? weekdays.indexOf(kv.WKST.toUpperCase()) : 1;
  if (rule.weekStart < 0) rule.weekStart = 1;
  return rule;
}

// ─── Низкоуровневый парсинг ──────────────────────────────────────────────────

/** Разворачивает переносы строк RFC 5545: строка, начинающаяся с пробела или
 *  таба, это продолжение предыдущей физической строки. */
function unfold(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/);
  const out: string[] = [];
  for (const line of raw) {
    if (out.length > 0 && (line.startsWith(" ") || line.startsWith("\t"))) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Разбивает `NAME;PARAM=v;PARAM2="v2":VALUE` на части. Значение начинается с
 *  первого двоеточия, которое не внутри параметра в кавычках. */
function parseContentLine(
  line: string,
): { name: string; params: Record<string, string>; value: string } | null {
  let colon = -1;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon).split(";");
  const value = line.slice(colon + 1);
  const params: Record<string, string> = {};
  for (let i = 1; i < head.length; i++) {
    const eq = head[i].indexOf("=");
    if (eq === -1) continue;
    let v = head[i].slice(eq + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[head[i].slice(0, eq).toUpperCase()] = v;
  }
  return { name: head[0].toUpperCase(), params, value };
}

/** Парсит дату или дату-время iCalendar в ms epoch плюс флаг all-day. */
const parseIcsDate = parseIcsTime;

/** Разэкранирует TEXT-значения iCalendar: `\n`/`\N` это перевод строки, `\,` `\;` `\\` берём как есть. */
function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c) =>
    c === "n" || c === "N" ? "\n" : c,
  );
}

function toCal(ev: ParsedEvent, start: number, dur: number): CalEvent {
  let end = start + dur;
  if (ev.allDay) { const date = new Date(start); date.setDate(date.getDate() + (ev.durationDays ?? Math.max(1, Math.round(dur / DAY_MS)))); end = date.getTime(); }
  return {
    uid: ev.uid,
    summary: ev.summary,
    location: ev.location,
    start,
    end,
    allDay: ev.allDay,
  };
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `evt-${Math.random().toString(36).slice(2)}`;
}
