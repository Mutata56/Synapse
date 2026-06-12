/**
 * Бэкап воркспейса в один клик: запаковываем всё дерево `notes/` (вместе с
 * `.assets`, `.versions`, `.trash`) и пишем туда, куда укажет юзер (облачная
 * папка, флешка, рабочий стол). Архив собираем сами в `lib/zip.ts`, без
 * сторонних zip-библиотек.
 */

import { save } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { createZip, unzipStored, type ZipEntry } from "./zip";
import { resetStorageCaches } from "./storage";

const APP_DATA = { baseDir: BaseDirectory.AppData } as const;

/** Рекурсивно собирает все файлы под `relDir` (относительно AppData) в `out`,
 *  путь внутри архива строим от `zipPrefix`. */
async function collect(
  relDir: string,
  zipPrefix: string,
  out: ZipEntry[],
): Promise<void> {
  const entries = await readDir(relDir, APP_DATA);
  for (const entry of entries) {
    if (!entry.name) continue;
    const rel = `${relDir}/${entry.name}`;
    const zipName = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory) {
      await collect(rel, zipName, out);
    } else if (entry.isFile) {
      try {
        out.push({ name: zipName, data: await readFile(rel, APP_DATA) });
      } catch (e) {
        // Файл, который не прочитался (скажем, на миг залочен), пропускаем,
        // а не валим из-за него весь бэкап. Логируем, чтобы не молча.
        console.error("backupWorkspace: skipped unreadable file:", rel, e);
      }
    }
  }
}

/**
 * Пакует воркспейс и пишет по пути, который выбрал юзер. Возвращает сохранённый
 * путь или `null`, если диалог сохранения отменили. Кидает ошибку, если бэкапить
 * нечего или запись не удалась.
 */
export async function backupWorkspace(): Promise<string | null> {
  const entries: ZipEntry[] = [];
  await collect("notes", "notes", entries);
  if (entries.length === 0) {
    throw new Error("Нет файлов для бэкапа");
  }

  // Таймстамп, безопасный для имени файла: 2026-06-04_17-30-45
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "-")
    .replace("T", "_");

  const path = await save({
    defaultPath: `notes-backup-${stamp}.zip`,
    filters: [{ name: "Архив", extensions: ["zip"] }],
  });
  if (!path) return null; // диалог сохранения отменили

  // Абсолютный путь из диалога, его пропускает fs-скоуп $HOME.
  await writeFile(path, createZip(entries));
  return path;
}

// ─── Восстановление ──────────────────────────────────────────────────────────
//
// Зеркало backupWorkspace. Сначала затаскиваем выбранный zip ВНУТРЬ воркспейса
// через `copyFile` (в эту сторону он умеет пересекать sandbox fs:scope, тот же
// трюк, что у импортёра аватарок/обложек). Дальше распаковка в temp-папку рядом
// с `notes/`, атомарный своп и откат при любой ошибке.
//
// Что это даёт:
//   Полуготовый воркспейс юзер не увидит: либо чистый своп, либо текущее
//   состояние не трогаем и показываем ошибку тостом.
//   Старый воркспейс не удаляем, а переименовываем в `notes.bak-<ts>`, можно
//   откатиться руками, если восстановление вышло кривым.
//   In-memory кэши сбрасываем через `resetStorageCaches`, иначе следующее
//   чтение попадёт в старое состояние.

const STAGED_ZIP = "notes/.restore-staging.zip";
/** Лимит на размер восстановления, 1 GB. Что-то большее почти наверняка не наш
 *  бэкап, плюс может сожрать память при распаковке в процессе. */
const MAX_RESTORE_BYTES = 1024 * 1024 * 1024;

/** ISO-таймстамп, безопасный для имени файла, вида `2026-06-06_17-30-45`. */
function tsStamp(): string {
  return new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "-")
    .replace("T", "_");
}

/** true, если `relPath` есть под AppData (по возможности: при ошибках доступа тоже false). */
async function safeExists(relPath: string): Promise<boolean> {
  try {
    return await exists(relPath, APP_DATA);
  } catch {
    return false;
  }
}

async function safeRemove(relPath: string): Promise<void> {
  try {
    if (await safeExists(relPath)) {
      await remove(relPath, { ...APP_DATA, recursive: true });
    }
  } catch (e) {
    console.error("restoreWorkspace: safeRemove failed:", relPath, e);
  }
}

export type RestoreResult = {
  /** Куда заархивировали прежний воркспейс (относительно AppData). Юзер может
   *  откатиться руками, если восстановление вышло кривым. */
  backupDir: string;
  /** Сколько файлов записали (для проверки и тоста). */
  filesRestored: number;
};

/**
 * Восстанавливает воркспейс из zip, созданного `backupWorkspace`. srcZipAbsPath
 * это путь из системного диалога открытия, может быть где угодно на диске. При
 * успехе возвращает `RestoreResult`. Кидает ошибку при провале валидации или
 * IO, вызывающий пусть ловит и показывает тостом.
 */
export async function restoreWorkspace(
  srcZipAbsPath: string,
): Promise<RestoreResult> {
  const stamp = tsStamp();
  const stagingDir = `notes.restore-${stamp}`;
  const backupDir = `notes.bak-${stamp}`;

  // 1) Затаскиваем zip ВНУТРЬ AppData. copyFile тут умеет пересекать fs:scope,
  //    тем же путём ходит importCoverFile для картинок из диалога. Стейджинговый
  //    файл в любом случае подчищаем в `finally`.
  await safeRemove(STAGED_ZIP);
  try {
    await copyFile(srcZipAbsPath, STAGED_ZIP, {
      toPathBaseDir: BaseDirectory.AppData,
    });

    // 2) Читаем и парсим. unzipStored громко падает на чужом архиве (не та
    //    сигнатура, не тот метод сжатия, пути с выходом за пределы).
    const zipBytes = await readFile(STAGED_ZIP, APP_DATA);
    if (zipBytes.length > MAX_RESTORE_BYTES) {
      throw new Error(
        `Архив слишком большой (${(zipBytes.length / 1024 / 1024).toFixed(0)} MB), лимит 1 GB`,
      );
    }
    const entries = unzipStored(zipBytes);
    if (entries.length === 0) {
      throw new Error("Архив пустой");
    }
    // Проверка: наши бэкапы всегда кладут всё под `notes/`. Архив с левыми
    // записями на верхнем уровне отвергаем, он скорее всего не наш.
    for (const e of entries) {
      if (!e.name.startsWith("notes/")) {
        throw new Error(
          `Этот ZIP не похож на бэкап заметок (найден файл "${e.name}" вне notes/)`,
        );
      }
    }

    // 3) Раскладываем в стейджинговую папку. Начинаем с чистого листа (кэшей
    //    нет), промежуточные папки создаём по мере надобности. Уже созданные
    //    держим в Set, чтобы не дёргать `mkdir` на каждый файл.
    await safeRemove(stagingDir);
    await mkdir(stagingDir, { ...APP_DATA, recursive: true });
    const knownDirs = new Set<string>([stagingDir]);
    for (const e of entries) {
      // Срезаем префикс `notes/` и перекладываем в stagingDir.
      const rel = e.name.slice("notes/".length);
      if (!rel) continue; // голая запись `notes/`, файла нет
      const targetRel = `${stagingDir}/${rel}`;
      const slash = targetRel.lastIndexOf("/");
      if (slash > 0) {
        const dir = targetRel.slice(0, slash);
        if (!knownDirs.has(dir)) {
          await mkdir(dir, { ...APP_DATA, recursive: true });
          knownDirs.add(dir);
        }
      }
      await writeFile(targetRel, e.data, APP_DATA);
    }

    // 4) Атомарный своп: старый `notes` переименовываем в `notes.bak-<ts>`,
    //    новым `notes` становится staging. Если второй rename упадёт, ОБЯЗАТЕЛЬНО
    //    откатываемся, иначе юзер останется БЕЗ воркспейса вообще. rename(...) не
    //    принимает toPathBaseDir, поэтому baseDir для путей передаём вторым
    //    аргументом через объект опций.
    const renameOpts = {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    } as const;
    const hadOld = await safeExists("notes");
    if (hadOld) {
      await rename("notes", backupDir, renameOpts);
    }
    try {
      await rename(stagingDir, "notes", renameOpts);
    } catch (swapErr) {
      // Откатываемся: возвращаем исходный notes/ на место.
      if (hadOld) {
        try {
          await rename(backupDir, "notes", renameOpts);
        } catch (rollbackErr) {
          console.error(
            "restoreWorkspace: ROLLBACK ALSO FAILED, workspace may need manual recovery",
            rollbackErr,
          );
        }
      }
      throw swapErr;
    }

    // 5) Сбрасываем все in-memory кэши, чтобы следующее чтение увидело новый диск.
    resetStorageCaches();

    return { backupDir, filesRestored: entries.length };
  } finally {
    // Стейджинговый zip убираем всегда: получилось восстановить или нет, temp-файл
    // больше не нужен. Ошибки тут не фатальны, просто шум.
    await safeRemove(STAGED_ZIP);
  }
}
