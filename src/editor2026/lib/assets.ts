// src/editor2026/lib/assets.ts
//
// Хелперы ассетов для медиа-блоков 2026 (gallery, fileCard). Локальный
// пайплайн: каждый импортируемый файл проходит через SHA-дедуплицированный
// пайплайн ассетов (importAssetBytes) и попадает в notes/.assets. Импорт
// идет из объектов `File` (обычный `<input type="file">`), а не через
// диалог выбора пути ОС, поэтому copyFile-стейджинг и storage.ts не
// нужны (сырой путь ОС вне fs:scope, см. storage.ts importCoverFile).

import { join } from "@tauri-apps/api/path";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getWorkspaceDir, importAssetBytes } from "../../lib/storage";

const ASSETS_SUBDIR = ".assets";
const FALLBACK_EXT = "bin";

export type ImportedAsset = {
  /** Имя файла на диске в notes/.assets (например `<sha>.png`). */
  assetName: string;
  /** URL-протокол Tauri для встраивания (например <img src>). */
  url: string;
  /** Оригинальное имя файла для отображения. */
  name: string;
  /** Расширение в нижнем регистре без точки. */
  ext: string;
  /** Размер файла в байтах. */
  size: number;
};

function extOf(fileName: string, mime: string): string {
  const m = fileName.match(/\.([a-zA-Z0-9]+)$/);
  if (m) return m[1].toLowerCase();
  const fromMime = mime.split("/")[1];
  return (fromMime || FALLBACK_EXT).toLowerCase();
}

/** Импорт выбранного/перетащенного File в хранилище ассетов воркспейса. */
export async function importFile(file: File): Promise<ImportedAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extOf(file.name, file.type);
  const { name: assetName, url } = await importAssetBytes(bytes, ext);
  return { assetName, url, name: file.name || assetName, ext, size: file.size };
}

/** Абсолютный путь к ассету на диске (в пределах opener fs scope). */
export async function assetAbsPath(assetName: string): Promise<string> {
  const dir = await getWorkspaceDir();
  return join(dir, ASSETS_SUBDIR, assetName);
}

/** Открыть ассет в приложении ОС по умолчанию. */
export async function openAssetInOS(assetName: string): Promise<void> {
  if (!assetName) return;
  await openPath(await assetAbsPath(assetName));
}

/** Показать ассет в файловом менеджере ОС. */
export async function revealAssetInOS(assetName: string): Promise<void> {
  if (!assetName) return;
  await revealItemInDir(await assetAbsPath(assetName));
}

/** Размер файла в человекочитаемом виде, например "1.4 MB". Пустая строка для 0/неизвестного. */
export function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i > 0 && n < 10 ? 1 : 0)} ${units[i]}`;
}
