/**
 * Пуш локальных задач в CalDAV (Яндекс.Календарь и любой совместимый сервер)
 * как событий VEVENT. Односторонний и идемпотентный: UID события = id задачи,
 * так что повторный PUT просто перезаписывает.
 *
 * Сама сборка ICS и URL живут тут (чистый модуль), а HTTP с basic-auth делает
 * Rust (команды `caldav_*`), иначе CORS вебвью не даст ходить на сервер.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Recurrence, Task } from "./tasks";

export type CalCollection = { href: string; name: string };

export type CaldavConfig = {
  login: string;
  password: string;
  /** URL коллекции, куда класть события. */
  url: string;
};

export type PushResult = {
  ok: number;
  failed: { title: string; error: string }[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Локальные wall-clock части Date в UTC-метку `YYYYMMDDTHHMMSSZ`. Берём именно
 * UTC-части (getUTC*), иначе локальное время уехало бы как UTC и сдвинулось на
 * таймзонный оффсет.
 */
function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Локальная дата как `YYYYMMDD` для событий на весь день (VALUE=DATE). */
function dateStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** Экранирование текстового значения по RFC 5545. */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function rrule(rep: Recurrence): string {
  const freq =
    rep.freq === "daily"
      ? "DAILY"
      : rep.freq === "weekly"
        ? "WEEKLY"
        : "MONTHLY";
  let r = `FREQ=${freq};INTERVAL=${Math.max(1, Math.floor(rep.every))}`;
  if (rep.until) {
    const [y, m, d] = rep.until.split("-").map(Number);
    r += `;UNTIL=${y}${pad(m)}${pad(d)}`;
  }
  return r;
}

/**
 * Собирает VCALENDAR с одним VEVENT для задачи. Строки разделяет CRLF (строгие
 * серверы отвергают голый \n). Done-состояние не кладём: у doneDates/done нет
 * чистого CalDAV-аналога, пушим только определение события.
 */
export function buildVevent(task: Task): string {
  const [y, m, d] = task.day.split("-").map(Number);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Synapse//Calendar//RU",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${task.id}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `SUMMARY:${esc(task.title)}`,
  ];
  if (task.time) {
    const [hh, mm] = task.time.split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 час по умолчанию
    lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
  } else {
    // Весь день: DTEND эксклюзивный, поэтому следующий день.
    lines.push(
      `DTSTART;VALUE=DATE:${dateStamp(new Date(y, m - 1, d))}`,
      `DTEND;VALUE=DATE:${dateStamp(new Date(y, m - 1, d + 1))}`,
    );
  }
  if (task.repeat) lines.push(`RRULE:${rrule(task.repeat)}`);
  if (task.tags && task.tags.length > 0) {
    lines.push(`CATEGORIES:${task.tags.map(esc).join(",")}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Календарь-хоум Яндекса для логина: точка discovery (PROPFIND). Логин-почту
 *  кладём литералом: `@` в сегменте пути допустим, а `%40` Яндекс не принимает. */
export function yandexHome(login: string): string {
  return `https://caldav.yandex.ru/calendars/${login.trim()}/`;
}

/** PROPFIND по хоуму: проверяет креды и возвращает доступные календари. */
export function discover(
  homeUrl: string,
  login: string,
  password: string,
): Promise<CalCollection[]> {
  return invoke<CalCollection[]>("caldav_discover", {
    url: homeUrl,
    login,
    password,
  });
}

/** URL ресурса события внутри коллекции (коллекцию доводим до завершающего /). */
function eventUrl(collectionUrl: string, uid: string): string {
  const base = collectionUrl.endsWith("/") ? collectionUrl : `${collectionUrl}/`;
  return `${base}${encodeURIComponent(uid)}.ics`;
}

/** Кладёт одну задачу как событие (создаёт или обновляет). */
export function pushTask(cfg: CaldavConfig, task: Task): Promise<void> {
  return invoke<void>("caldav_put", {
    url: eventUrl(cfg.url, task.id),
    login: cfg.login,
    password: cfg.password,
    ics: buildVevent(task),
  });
}

/** Удаляет событие задачи с сервера. */
export function deleteTask(cfg: CaldavConfig, taskId: string): Promise<void> {
  return invoke<void>("caldav_delete", {
    url: eventUrl(cfg.url, taskId),
    login: cfg.login,
    password: cfg.password,
  });
}

/**
 * Пушит все задачи по очереди (последовательно, чтобы не долбить сервер и собрать
 * понятный отчёт). Падение одной не роняет остальные.
 */
export async function pushAll(
  cfg: CaldavConfig,
  tasks: Task[],
): Promise<PushResult> {
  let ok = 0;
  const failed: { title: string; error: string }[] = [];
  for (const task of tasks) {
    try {
      await pushTask(cfg, task);
      ok++;
    } catch (e) {
      failed.push({ title: task.title, error: String(e) });
    }
  }
  return { ok, failed };
}
