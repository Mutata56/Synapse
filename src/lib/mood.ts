/**
 * Шкала настроения, общая для пикера (в шапке заметки дня) и тренда в Календаре.
 * Хранится по дням во фронтматтере заметки дня как `mood: 1..5`.
 */

export type MoodLevel = 1 | 2 | 3 | 4 | 5;

export const MOODS: {
  v: MoodLevel;
  face: string;
  label: string;
  color: string;
}[] = [
  { v: 1, face: "😞", label: "Плохо", color: "#ef4444" },
  { v: 2, face: "😕", label: "Так себе", color: "#f59e0b" },
  { v: 3, face: "😐", label: "Нормально", color: "#a3a3a3" },
  { v: 4, face: "🙂", label: "Хорошо", color: "#84cc16" },
  { v: 5, face: "😄", label: "Отлично", color: "#22c55e" },
];

/** Эмодзи-лицо для значения настроения, null если не задано или вне диапазона. */
export function moodFace(m: number | null | undefined): string | null {
  return MOODS.find((x) => x.v === m)?.face ?? null;
}

/** Акцентный цвет для значения настроения (серый по умолчанию). */
export function moodColor(m: number | null | undefined): string {
  return MOODS.find((x) => x.v === m)?.color ?? "#666666";
}
