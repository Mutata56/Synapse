import { getLanguage } from "./i18n";

export function overviewCount(value: number, noun: "note" | "tag" | "word") {
  const language = getLanguage();
  const number = value.toLocaleString(language === "en" ? "en-GB" : "ru-RU");
  if (language === "en") return `${number} ${noun}${value === 1 ? "" : "s"}`;
  const forms = { note: ["заметка", "заметки", "заметок"], tag: ["тег", "тега", "тегов"], word: ["слово", "слова", "слов"] };
  const last = Math.abs(value) % 10, hundred = Math.abs(value) % 100;
  const index = hundred >= 11 && hundred <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2;
  return `${number} ${forms[noun][index]}`;
}

/** Keep the preview readable without modifying the imported source file. */
export function overviewExcerpt(preview: string) {
  return preview.replace(/^\s*(?:#[\p{L}\p{N}_/-]+(?:\s+|$))+/u, "").trim();
}
