/** Calendar arithmetic in an event's zone, using the runtime's IANA database. */
export const ICAL_DAY_MS = 86_400_000;
const formats = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let format = formats.get(zone);
  if (!format) {
    // Reject an unknown/custom zone instead of silently showing the wrong hour.
    try { format = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
    catch { throw new Error(`Неподдерживаемый часовой пояс iCal: ${zone}`); }
    if (formats.size >= 32) formats.delete(formats.keys().next().value!);
    formats.set(zone, format);
  }
  return format;
}

/** A UTC Date whose components describe the wall clock, not an absolute instant. */
export function wallDate(ms: number, zone?: string): Date {
  if (zone === "UTC") return new Date(ms);
  if (!zone) {
    const date = new Date(ms), wall = new Date(0);
    wall.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    wall.setUTCHours(date.getHours(), date.getMinutes(), date.getSeconds(), 0);
    return wall;
  }
  const values: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(ms)) if (part.type !== "literal") values[part.type] = Number(part.value);
  const wall = new Date(0);
  wall.setUTCFullYear(values.year, values.month - 1, values.day);
  wall.setUTCHours(values.hour, values.minute, values.second, 0);
  return wall;
}

/** Ambiguous times use the first occurrence. Recurrences skip nonexistent times. */
export function wallInstant(wall: Date, zone?: string, skipGap = false): number | null {
  const naive = wall.getTime();
  if (zone === "UTC") return naive;
  if (!zone) {
    const local = new Date(0);
    local.setFullYear(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
    local.setHours(wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), 0);
    const ms = local.getTime();
    return skipGap && wallDate(ms).getTime() !== naive ? null : ms;
  }
  const offsets = new Set<number>();
  for (const shift of [-ICAL_DAY_MS, 0, ICAL_DAY_MS]) {
    const sample = naive + shift;
    offsets.add(wallDate(sample, zone).getTime() - sample);
  }
  const candidates = [...offsets].map(offset => naive - offset).sort((a, b) => a - b);
  for (const ms of candidates) if (wallDate(ms, zone).getTime() === naive) return ms;
  // DTSTART in a gap uses the preceding UTC offset (RFC 5545 3.3.5).
  return skipGap ? null : candidates[candidates.length - 1];
}

export function parseIcsTime(value: string, params: Record<string, string>): { ms: number; allDay: boolean; zone?: string } | null {
  const text = value.trim(), match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(text);
  if (!match) return null;
  const allDay = !match[4];
  if (params.VALUE?.toUpperCase() === "DATE" && !allDay) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(value => Number(value ?? 0));
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 60) return null;
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, Math.min(second, 59), 0);
  if (wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) return null;
  const zone = allDay ? undefined : match[7] ? "UTC" : params.TZID || undefined;
  const ms = wallInstant(wall, zone);
  return ms === null ? null : { ms, allDay, zone };
}
