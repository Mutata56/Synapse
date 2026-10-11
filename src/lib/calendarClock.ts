import { toISODate } from "./daily";

export type CalendarClock = { day: string; zone: string };
type ClockEnvironment = {
  window: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "hidden">;
  now: () => Date;
  zone: () => string;
};

/** One midnight timer; foreground recovery also covers wake and clock/zone changes. */
export function watchCalendarClock(update: (clock: CalendarClock) => void, resume: () => void, env: ClockEnvironment = {
  window, document, now: () => new Date(), zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
}): () => void {
  let timer: number | undefined;
  const refresh = () => {
    if (timer !== undefined) env.window.clearTimeout(timer);
    const now = env.now();
    update({ day: toISODate(now), zone: env.zone() });
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 25);
    timer = env.window.setTimeout(refresh, Math.max(25, midnight.getTime() - now.getTime()));
  };
  const foreground = () => { if (!env.document.hidden) { refresh(); resume(); } };
  refresh();
  env.window.addEventListener("focus", foreground);
  env.document.addEventListener("visibilitychange", foreground);
  return () => {
    if (timer !== undefined) env.window.clearTimeout(timer);
    env.window.removeEventListener("focus", foreground);
    env.document.removeEventListener("visibilitychange", foreground);
  };
}
