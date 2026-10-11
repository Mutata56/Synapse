export const CALLOUT_TYPES = ["note", "abstract", "info", "todo", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote"] as const;
export type CalloutType = typeof CALLOUT_TYPES[number];
export const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: "Заметка", abstract: "Кратко", info: "Информация", todo: "К выполнению", tip: "Совет", success: "Успех", question: "Вопрос", warning: "Внимание", failure: "Неудача", danger: "Опасность", bug: "Ошибка", example: "Пример", quote: "Цитата",
};
const aliases: Record<string, CalloutType> = { summary: "abstract", tldr: "abstract", hint: "tip", important: "tip", check: "success", done: "success", help: "question", faq: "question", warn: "warning", caution: "warning", attention: "warning", fail: "failure", missing: "failure", error: "danger", cite: "quote" };
export function calloutType(value: unknown): CalloutType {
  const key = String(value ?? "note").toLowerCase();
  return CALLOUT_TYPES.includes(key as CalloutType) ? key as CalloutType : aliases[key] ?? "note";
}
export const TASK_STATES = [
  { marker: " ", id: "todo", label: "Обычная задача" },
  { marker: "x", id: "done", label: "Сделано" },
  { marker: "/", id: "progress", label: "В процессе" },
  { marker: "-", id: "cancelled", label: "Отменено" },
  { marker: "!", id: "important", label: "Важно" },
  { marker: "?", id: "question", label: "Вопрос / непонятно" },
  { marker: "*", id: "star", label: "Ключевое" },
  { marker: ">", id: "forwarded", label: "Перенесено" },
  { marker: "<", id: "scheduled", label: "Запланировано" },
] as const;
export function taskState(marker: string) {
  return TASK_STATES.find(state => state.marker === (marker === "X" ? "x" : marker)) ?? { marker, id: "custom", label: `Статус ${marker}` };
}
export function taskMarker(props?: Record<string, unknown>): string {
  const marker = props?.taskStatus;
  return typeof marker === "string" && marker.length === 1 ? marker : props?.checked ? "x" : " ";
}
