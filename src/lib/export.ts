/**
 * Экспорт одной заметки в переносимый файл, место для него выбирает юзер.
 * (Бэкап всего воркспейса лежит в lib/backup.ts.)
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { readNote } from "./storage";

/** Меняет символы, запрещённые в файловой системе, чтобы заголовок заметки годился в имя файла. */
function sanitizeFilename(name: string): string {
  const cleaned = (name.trim() || "note").replace(/[\\/:*?"<>|]+/g, "_");
  return cleaned.slice(0, 80) || "note";
}

/**
 * Экспортирует тело заметки в выбранный юзером `.md`-файл, заголовок добавляем
 * сверху как H1, чтобы файл был самодостаточным. Возвращает сохранённый путь
 * или `null`, если диалог сохранения отменили.
 */
export async function exportNoteMarkdown(
  note: { id: string; title: string },
): Promise<string | null> {
  const full = await readNote(note.id);
  const body = full?.content ?? "";
  const title = note.title.trim() || "Без названия";
  const markdown = `# ${title}\n\n${body}`;

  const path = await save({
    defaultPath: `${sanitizeFilename(note.title)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return null;

  await writeTextFile(path, markdown);
  return path;
}
