// src/editor2026/lib/assets.ts
//
// Хелперы ассетов для медиа-блоков 2026 (gallery, fileCard). Локальный
// пайплайн: каждый импортируемый файл проходит через SHA-дедуплицированный
// пайплайн ассетов (importAssetBytes) и попадает в notes/.assets. Импорт
// идет из объектов `File` (обычный `<input type="file">`), а не через
// диалог выбора пути ОС, поэтому copyFile-стейджинг и storage.ts не
// нужны (сырой путь ОС вне fs:scope, см. storage.ts importCoverFile).

import { convertFileSrc } from "@tauri-apps/api/core";
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

// ─── Портабельные ссылки на ассеты (бэкап между ОС) ─────────────────────────
//
// Картинки/файлы хранятся в notes/.assets под именем `<sha256>.<ext>`, а блоки
// редактора ссылаются на них через Tauri asset-протокол. Беда в том, что
// convertFileSrc выдаёт АБСОЛЮТНЫЙ URL с полным путём до AppData
// (`http://asset.localhost/%2Fhome%2F...%2F.assets%2F<sha>.png` на Linux,
// `C:%5CUsers%5C...` на Windows). Если такой URL утечёт в тело заметки, то
// перенос воркспейса на другую ОС/машину (а бэкап ровно про это) ломает все
// картинки: путь не совпадает.
//
// Поэтому на диск пишем ПОРТАБЕЛЬНУЮ форму `.assets/<имя>` (путь относительно
// корня воркспейса, одинаковый на всех ОС), а в рабочий URL разворачиваем уже
// под текущую машину при загрузке/отрисовке. Имя ассета это sha256 плюс расширение,
// высокая энтропия, так что мы надёжно вычленяем его и из старой абсолютной
// ссылки тоже: значит уже сохранённые заметки тоже починятся без миграции.

/** Имя ассета: sha256 (64 hex) + расширение. Тот же паттерн, что выдаёт
 *  importAssetBytes и ASSET_NAME_RE в storage.ts. */
const ASSET_NAME_RE = /[0-9a-f]{64}\.[a-z0-9]+/i;
/** Префикс портабельной ссылки: путь до ассета относительно корня воркспейса. */
const PORTABLE_ASSET_PREFIX = `${ASSETS_SUBDIR}/`;

/** Абсолютный путь к папке ассетов на этой машине. Кэшируем, чтобы
 *  resolveAssetUrl был синхронным и годился прямо в render кастомных блоков. */
let assetsDirAbs: string | null = null;

/**
 * Прогревает кэш пути к .assets, чтобы resolveAssetUrl работал синхронно ещё до
 * того, как откроют первую заметку. Зовём один раз при старте приложения. Тихо
 * проглатывает ошибку (путь останется null, ссылки тогда отдаём как есть, без
 * падения).
 */
export async function warmAssetResolver(): Promise<void> {
  if (assetsDirAbs) return;
  try {
    const dir = await getWorkspaceDir();
    // Слешами, не join: путь уходит в convertFileSrc, который сам нормализует
    // разделитель под платформу (см. joinAbsolute в storage.ts).
    assetsDirAbs = `${dir.replace(/[\\/]+$/, "")}/${ASSETS_SUBDIR}`;
  } catch (e) {
    console.error("warmAssetResolver failed:", e);
  }
}

/** Вычленяет имя ассета (sha.ext) из любой ссылки: и из портабельной
 *  `.assets/<имя>`, и из старого абсолютного asset-URL. null, если это чужая
 *  ссылка (внешняя картинка, data:), такую не трогаем. */
function assetNameOf(ref: string): string | null {
  const m = ref.match(ASSET_NAME_RE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Разворачивает сохранённую ссылку на ассет (портабельную ИЛИ старую
 * абсолютную) в рабочий URL для ЭТОЙ машины. Чужие ссылки (http(s) на внешние
 * картинки, data:) возвращает как есть. До прогрева кэша (assetsDirAbs ещё null)
 * тоже отдаёт исходную строку: уж лучше ничего, чем уронить рендер.
 */
export function resolveAssetUrl(ref: string): string {
  if (!ref) return ref;
  const name = assetNameOf(ref);
  if (!name || !assetsDirAbs) return ref;
  return convertFileSrc(`${assetsDirAbs}/${name}`);
}

/** Сворачивает ссылку на наш ассет к портабельной `.assets/<имя>`, чтобы на диск
 *  (и в бэкап) не утёк абсолютный путь конкретной ОС. Чужие ссылки не трогаем. */
export function toPortableAssetRef(url: string): string {
  if (!url) return url;
  const name = assetNameOf(url);
  return name ? `${PORTABLE_ASSET_PREFIX}${name}` : url;
}

// ─── Портабилизация дерева блоков перед сохранением ──────────────────────────
//
// Перед записью на диск прогоняем документ редактора через это: любую ссылку на
// наш ассет в пропах блока сворачиваем к `.assets/<имя>`. Так markdown-зеркало и
// blocknote-JSON уезжают в бэкап без абсолютных путей, а bnHash (он считается по
// markdown) совпадёт на другой машине. Заодно чинит старые заметки, где
// абсолютный URL уже записан: на следующем сохранении он станет портабельным.

/** Сворачивает к портабельной форме ссылки в одной gallery. Проп `items` это
 *  JSON-строка `[{url,name,caption}]`. Возвращает ту же строку, если
 *  ничего не поменялось. */
function portablizeGalleryItems(itemsJson: string): string {
  try {
    const arr: unknown = JSON.parse(itemsJson);
    if (!Array.isArray(arr)) return itemsJson;
    let changed = false;
    const out = arr.map((it) => {
      if (it && typeof it === "object" && typeof (it as { url?: unknown }).url === "string") {
        const url = (it as { url: string }).url;
        const portable = toPortableAssetRef(url);
        if (portable !== url) {
          changed = true;
          return { ...(it as object), url: portable };
        }
      }
      return it;
    });
    return changed ? JSON.stringify(out) : itemsJson;
  } catch {
    return itemsJson;
  }
}

/** Сворачивает ссылки на ассеты в пропах одного блока. Возвращает тот же объект
 *  пропов, если менять нечего (чтобы выше сохранить identity и не клонировать
 *  лишнего). Покрывает встроенные image/file/video/audio (`url`), нашу
 *  fileCard (`assetUrl`) и gallery (`items`). */
function portablizeBlockProps(
  type: unknown,
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props || typeof props !== "object") return props;
  let out = props;
  const mutable = (): Record<string, unknown> => {
    if (out === props) out = { ...props };
    return out;
  };
  if (typeof props.url === "string") {
    const portable = toPortableAssetRef(props.url);
    if (portable !== props.url) mutable().url = portable;
  }
  if (typeof props.assetUrl === "string") {
    const portable = toPortableAssetRef(props.assetUrl);
    if (portable !== props.assetUrl) mutable().assetUrl = portable;
  }
  if (type === "gallery" && typeof props.items === "string") {
    const portable = portablizeGalleryItems(props.items);
    if (portable !== props.items) mutable().items = portable;
  }
  return out;
}

type LooseBlock = {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: unknown;
};

/** Рекурсивно сворачивает ссылки на ассеты в одном блоке и его детях. Живой
 *  документ редактора НЕ мутируем (иначе попортим открытую заметку): где
 *  поменяли, отдаём поверхностный клон, где нет, оставляем исходный. */
function portablizeBlock(block: unknown): unknown {
  if (!block || typeof block !== "object") return block;
  const b = block as LooseBlock;
  const props = portablizeBlockProps(b.type, b.props);
  let children = b.children;
  if (Array.isArray(b.children)) {
    const mapped = b.children.map(portablizeBlock);
    if (mapped.some((c, i) => c !== (b.children as unknown[])[i])) children = mapped;
  }
  if (props === b.props && children === b.children) return block;
  return { ...b, props, children };
}

/**
 * Готовит блоки документа к сохранению: все ссылки на наши ассеты сворачивает к
 * портабельной форме `.assets/<имя>`. Из этих же блоков потом делаем и
 * markdown-зеркало, и blocknote-JSON, так что на диск ничего абсолютного не
 * утекает. Вход не мутирует.
 */
export function portablizeBlocks(blocks: readonly unknown[]): unknown[] {
  return blocks.map(portablizeBlock);
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
