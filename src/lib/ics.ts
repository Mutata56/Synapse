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
 * Про таймзоны важно: базы IANA tz у нас нет, поэтому локальное время `TZID=…`
 * трактуем в зоне *самой машины*. Время в UTC (`Z`) точное. Для дневника одного
 * юзера, чей календарь в его же таймзоне, это верно; разъезжается, только если
 * смотришь событие из чужой таймзоны в поездке.
 */

const DAY_MS = 86_400_000;
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
        events.push({
          uid: cur.uid || randomId(),
          summary: cur.summary || "(без названия)",
          location: cur.location,
          start: cur.start,
          end:
            typeof cur.end === "number"
              ? cur.end
              : cur.start + (cur.allDay ? DAY_MS : 0),
          allDay: cur.allDay ?? false,
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

  for (const ev of events) {
    const dur = Math.max(ev.allDay ? DAY_MS : 0, ev.end - ev.start);

    if (!ev.rrule) {
      if (ev.start < rangeEnd && ev.start + dur > rangeStart) {
        out.push(toCal(ev, ev.start, dur));
      }
      continue;
    }

    const rule = ev.rrule;
    const excluded = new Set(ev.exDates ?? []);
    let guard = 0;

    // `idx` это настоящая 0-based позиция повтора в серии, так что COUNT остаётся
    // верным, даже когда генератор перематывает вперёд к `rangeStart`.
    for (const { ms: s, idx } of occurrences(rule, ev.start, rangeStart)) {
      if (++guard > MAX_OCCURRENCES) break;
      if (rule.until != null && s > rule.until) break;
      if (rule.count != null && idx >= rule.count) break;
      // Повторы монотонны, всё за окном уже не покажется.
      if (s >= rangeEnd) break;
      // EXDATE убирает повтор, но в COUNT выше он всё равно засчитался.
      if (excluded.has(s)) continue;
      if (s + dur > rangeStart) out.push(toCal(ev, s, dur));
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

// ─── Повторы ─────────────────────────────────────────────────────────────────

/**
 * Лениво отдаёт повторы по возрастанию как `{ ms, idx }`, где `idx` это
 * настоящая 0-based позиция повтора в серии (чтобы проверка COUNT у потребителя
 * осталась верной). Для безграничных правил бесконечен, останавливает его
 * вызывающий.
 *
 * Чтобы не жечь бюджет повторов вызывающего, генератор перематывает близко к
 * `seekMs` (началу окна), а не шагает от DTSTART: прикидывает, сколько
 * interval-шагов влезает до `seekMs`, откатывается на один шаг назад на случай
 * дрейфа календаря/DST и стартует оттуда с подогнанным `idx`. Серия, начавшаяся
 * десятилетия назад, так доходит до видимого окна за пару итераций.
 */
function* occurrences(
  rule: RRule,
  startMs: number,
  seekMs: number,
): Generator<{ ms: number; idx: number }> {
  const start = new Date(startMs);
  const hh = start.getHours();
  const mm = start.getMinutes();
  const ss = start.getSeconds();

  if (rule.freq === "WEEKLY" && rule.byday && rule.byday.length > 0) {
    const days = [...rule.byday].sort((a, b) => a - b);
    const perWeek = days.length;
    const dayStart = start.getDay();
    // Воскресенье недели старта, используем как якорь для шагов.
    const weekStart = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() - dayStart,
    );
    // Неделя 0 частичная: считаются только дни в день недели DTSTART и позже.
    const firstWeekCount = days.filter((d) => d >= dayStart).length;

    // Перематываем целые interval-шаги (каждый = `interval` недель) к seek.
    const est = Math.floor((seekMs - startMs) / (DAY_MS * 7 * rule.interval));
    const j0 = Math.max(0, est - 1); // откат на шаг назад для надёжности
    let idx = j0 === 0 ? 0 : firstWeekCount + (j0 - 1) * perWeek;

    for (let j = j0; ; j++) {
      const w = j * rule.interval;
      for (const d of days) {
        const occ = new Date(
          weekStart.getFullYear(),
          weekStart.getMonth(),
          weekStart.getDate() + w * 7 + d,
          hh,
          mm,
          ss,
        );
        const ms = occ.getTime();
        if (ms < startMs) continue; // до DTSTART (бывает только на неделе 0)
        yield { ms, idx: idx++ };
      }
    }
  }

  // Линейные частоты: ровно один повтор на interval-шаг, поэтому `idx === i`.
  let est = 0;
  switch (rule.freq) {
    case "DAILY":
      est = Math.floor((seekMs - startMs) / (DAY_MS * rule.interval));
      break;
    case "WEEKLY":
      est = Math.floor((seekMs - startMs) / (DAY_MS * 7 * rule.interval));
      break;
    case "MONTHLY": {
      const seek = new Date(seekMs);
      const months =
        (seek.getFullYear() - start.getFullYear()) * 12 +
        (seek.getMonth() - start.getMonth());
      est = Math.floor(months / rule.interval);
      break;
    }
    case "YEARLY":
      est = Math.floor(
        (new Date(seekMs).getFullYear() - start.getFullYear()) / rule.interval,
      );
      break;
  }
  const i0 = Math.max(0, est - 1); // откат на шаг назад для надёжности

  for (let i = i0; ; i++) {
    const n = i * rule.interval;
    let occ: Date;
    switch (rule.freq) {
      case "DAILY":
        occ = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n, hh, mm, ss);
        break;
      case "WEEKLY":
        occ = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n * 7, hh, mm, ss);
        break;
      case "MONTHLY":
        occ = new Date(start.getFullYear(), start.getMonth() + n, start.getDate(), hh, mm, ss);
        break;
      case "YEARLY":
        occ = new Date(start.getFullYear() + n, start.getMonth(), start.getDate(), hh, mm, ss);
        break;
    }
    const ms = occ.getTime();
    if (ms >= startMs) yield { ms, idx: i }; // страховка от дрейфа до DTSTART
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
    if (days.length) rule.byday = days;
  }
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
function parseIcsDate(
  value: string,
  params: Record<string, string>,
): { ms: number; allDay: boolean } | null {
  const v = value.trim();

  // Весь день: VALUE=DATE или голый YYYYMMDD.
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    return { ms: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S, z] = m;
  const ms =
    z === "Z"
      ? Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S)
      : new Date(+Y, +Mo - 1, +D, +H, +Mi, +S).getTime(); // floating/TZID, берём local
  return { ms, allDay: false };
}

/** Разэкранирует TEXT-значения iCalendar: `\n`/`\N` это перевод строки, `\,` `\;` `\\` берём как есть. */
function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c) =>
    c === "n" || c === "N" ? "\n" : c,
  );
}

function toCal(ev: ParsedEvent, start: number, dur: number): CalEvent {
  return {
    uid: ev.uid,
    summary: ev.summary,
    location: ev.location,
    start,
    end: start + dur,
    allDay: ev.allDay,
  };
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `evt-${Math.random().toString(36).slice(2)}`;
}
