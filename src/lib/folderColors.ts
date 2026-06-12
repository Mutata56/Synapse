/**
 * Палитра цветов папок для пикера. Выбранный цвет папки храним hex-строкой в
 * мета-файле воркспейса (`notes/.folder-meta.json`, ключ это путь папки), нет
 * записи это цвет-акцент по умолчанию. Храним прямо hex, чтобы рендер был
 * простой `style={{ color }}` и старые значения пережили любую правку палитры.
 */
export type FolderColor = { hex: string; label: string };

export const FOLDER_COLORS: readonly FolderColor[] = [
  { hex: "#f87171", label: "Красный" },
  { hex: "#fb923c", label: "Оранжевый" },
  { hex: "#fbbf24", label: "Янтарный" },
  { hex: "#34d399", label: "Зелёный" },
  { hex: "#22d3ee", label: "Бирюзовый" },
  { hex: "#60a5fa", label: "Синий" },
  { hex: "#a78bfa", label: "Фиолетовый" },
  { hex: "#f472b6", label: "Розовый" },
];
