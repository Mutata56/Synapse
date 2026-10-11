import { readNativeImageInventory, type InventoryFile } from "./nativeImageInventory";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  BaseDirectory,
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { COVER_PREFIX } from "./covers";
import { coerceIconizeState, emptyIconizeState, rebaseIconAssignments, type IconizeState } from "./iconize";
import {
  coerceSettings,
  DEFAULT_SETTINGS,
  type AppSettings,
} from "./settings";
import { coerceTasks, type Task } from "./tasks";
import {
  assertMarkdownSourceUnchanged,
  boundedVaultPath,
  mapMarkdownText,
  markdownSourceToWrite,
  splitMarkdownSource,
  wikiTarget,
} from "./obsidianImport";
import { createImageFilesIndex, extractImageReferences, imageFormat, resolveImageReferences, type ImageLibrary, type ImageReferences, type LibraryImage } from "./imageLibrary";

const ROOT = "notes";
const TRASH = "notes/.trash";
const ASSETS = "notes/.assets";
const VERSIONS = "notes/.versions";

const APP_DATA = { baseDir: BaseDirectory.AppData } as const;
/** `rename` из plugin-fs берёт baseDir для каждого пути отдельно. Оба наших
 *  смотрят в AppData, так что rename никогда не вылезает за границу песочницы. */
const RENAME_OPTS = {
  oldPathBaseDir: BaseDirectory.AppData,
  newPathBaseDir: BaseDirectory.AppData,
} as const;

const NOTE_EXT = ".md";
const TMP_SUFFIX = ".tmp";
const TMP_PREFIX = "__tmp-";

const NEW_ID_RANDOM_LEN = 4;
const COLLISION_SUFFIX_LEN = 4;
/** Предел попыток подобрать неконфликтующее имя. Пространство суффикса base-36
 *  это 36^4, около 1.7М значений. Если за 8 попыток всё ещё коллизия, творится
 *  что-то ненормальное, так что падаем громко. */
const MAX_COLLISION_RETRIES = 8;

const MAX_FOLDER_NAME = 80;
const PREVIEW_DEFAULT_MAX = 240;
/** Подрезаем тело перед прогоном регэкспов превью. Превью нужен только первый
 *  кусок, гонять 13 регэкспов по 100 КБ текста это пустая трата. */
const PREVIEW_BODY_SLICE_FACTOR = 10;

const FOLDER_NAME_FORBIDDEN = /[\\/:*?"<>|]+/g;
const FILE_EXT_REGEX = /\.([a-zA-Z0-9]+)$/;

const DEFAULT_TITLE = "Без названия";
const DEFAULT_ASSET_EXT = "bin";
const DEFAULT_IMG_EXT = "png";

export type NoteMeta = {
  id: string;
  title: string;
  folder: string;
  createdAt: number;
  updatedAt: number;
  icon: string | null;
  iconColor?: string | null;
  /** Small scalar frontmatter values allow configurable Iconize field names. */
  frontmatterIcons?: Record<string, string>;
  cover: string | null;
  preview: string;
  favorite: boolean;
  tags: string[];
  /** Цели `[[wiki-link]]` из тела, в нижнем регистре. Граф делает из них рёбра
   *  между заметками. */
  links: string[];
  /** Опциональная оценка настроения 1..5 (для заметок дня). Лежит прямо в
   *  NoteMeta: число крошечное, так что Календарь читает его из кэша дерева. */
  mood?: number | null;
  /** Опциональные альтернативные названия (совместимо с Obsidian). Если заданы,
   *  попап `[[` находит заметку по любому из них, но вставляет всё равно
   *  канонический `title` (чтобы wiki-link стабильно ходил туда-обратно). В YAML
   *  храним либо инлайн-массивом `aliases: ["x", "y"]`, либо многострочным YAML-
   *  списком, читаем обе формы. Пусто, если юзер ничего не задал. */
  aliases?: string[];
  /** Copied Obsidian Markdown is edited as source, never through BlockNote. */
  markdownSource?: boolean;
};

export type Note = NoteMeta & {
  content: string;
  /** Full copied Markdown including BOM, YAML, comments and original newlines. */
  sourceText?: string;
  /** Source read from disk; checked before every source edit to detect conflicts. */
  sourceRevision?: string;
  /** JSON документа BlockNote без потерь, главный источник правды для редактора
   *  при перезагрузке: тогда тогглы, вложенность и блоки кода переживают
   *  (markdown-зеркало `content` лоссёвое). Нет у заметок, созданных или
   *  правленных вне приложения, для них откатываемся к парсингу `content`. */
  blocknote?: string | null;
  /** Хэш markdown-`content`, из которого собран `blocknote`. При загрузке
   *  доверяем `blocknote`, только если он всё ещё совпадает с телом файла. Не
   *  совпал, значит markdown правили снаружи, и мы парсим его заново. */
  bnHash?: number | null;
};

export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "note"; note: NoteMeta };

export type AssetInfo = {
  name: string;
  url: string;
  sizeBytes: number;
  usedBy: { id: string; title: string; folder: string }[];
};

export type RestoreResult = {
  kind: "file" | "folder" | "missing";
  path: string;
};

// При записи строки заключаем в JSON-кавычки, чтобы переносы и запятые выжили.
// Массивы пишем компактным JSON (`["a", "b"]`), чтобы влезли в одну строку
// фронтматтера. Многострочные YAML-списки читаем, но НИКОГДА не пишем (меньше
// неоднозначности, проще round-trip). Нужно для `aliases`, на будущее для
// других полей-списков. todo другие frontmatter-поля-списки
type FrontmatterValue = string | number | boolean | null | string[];
type FrontmatterRecord = Record<string, FrontmatterValue>;

let cachedAppDataDir: string | null = null;
let appDataDirPromise: Promise<string> | null = null;

async function getAppDataDir(): Promise<string> {
  if (cachedAppDataDir !== null) return cachedAppDataDir;
  if (!appDataDirPromise) {
    // Конкурентные вызовы ждут один и тот же IPC, не дублируют его.
    appDataDirPromise = appDataDir().then((dir) => {
      cachedAppDataDir = dir;
      return dir;
    });
  }
  return appDataDirPromise;
}

/** Абсолютный путь к корню воркспейса (`<AppData>/notes`). Показываем в
 *  настройках и отдаём файловому менеджеру ОС, чтобы открыть папку. `join` сам
 *  разбирается с разделителем пути под платформу. */
export async function getWorkspaceDir(): Promise<string> {
  return join(await getAppDataDir(), ROOT);
}

let workspaceReady = false;
let workspacePromise: Promise<void> | null = null;

export async function ensureWorkspace(): Promise<void> {
  if (workspaceReady) return;
  if (!workspacePromise) {
    workspacePromise = (async () => {
      await Promise.all([ensureDir(ROOT), ensureDir(TRASH), ensureDir(ASSETS)]);
      // По возможности подчищаем осиротевшие staging-файлы от упавших импортов.
      await cleanupOrphanedTmpAssets();
      workspaceReady = true;
    })().catch((e) => {
      // Даём следующему вызову повторить, а не падать навсегда.
      workspacePromise = null;
      throw e;
    });
  }
  return workspacePromise;
}

/**
 * Сбрасывает все кэши хранилища в памяти И защёлку готовности воркспейса. Зови
 * после разрушительной операции уровня воркспейса (восстановление из бэкапа,
 * правки дерева файлов снаружи, которые хотим переоткрыть), чтобы следующее
 * чтение пошло на диск свежим, а не вернуло устаревшее из прошлого состояния ФС.
 *
 * Что чистит:
 *   - workspaceReady / workspacePromise: ensureWorkspace на следующем вызове
 *     заново прогонит ensureDir и cleanup по новому дереву
 *   - metaCache (плюс флаги loaded / dirty): listTree заново парсит фронтматтер
 *   - refsCache (плюс флаг loaded): listAssets заново сканирует тела .md на
 *     ссылки на ассеты
 *
 * Что намеренно НЕ чистит:
 *   - cachedAppDataDir: путь стабилен в рамках процесса (Tauri AppData у
 *     запущенного приложения не меняется), сброс дал бы лишний IPC впустую.
 *
 * Слой стора (notes.ts refreshAll) надо звать ПОСЛЕ этого, чтобы заново набить
 * дерево и ассеты, которые читают ImagesView / Sidebar.
 */
export function resetStorageCaches(): void {
  workspaceReady = false;
  workspacePromise = null;
  metaCache.clear();
  metaCacheLoaded = false;
  metaCacheLoadPromise = null;
  metaCacheDirty = false;
  refsCache.clear();
  refsCacheLoaded = false;
  refsCacheLoadPromise = null;
  refsCacheDirty = false;
  obsidianState = null;
  obsidianLoadPromise = null;
  iconizeData = undefined;
  iconizeLoad = undefined;
}

async function cleanupOrphanedTmpAssets(): Promise<void> {
  try {
    if (!(await pathExists(ASSETS))) return;
    const entries = await readDir(ASSETS, APP_DATA);
    await Promise.all(
      entries
        .filter((e) => e.isFile && e.name?.startsWith(TMP_PREFIX))
        .map((e) => safeRemove(`${ASSETS}/${e.name}`)),
    );
  } catch (e) {
    console.error("cleanupOrphanedTmpAssets failed:", e);
  }
}

const parentOf = (idOrPath: string): string => {
  const i = idOrPath.lastIndexOf("/");
  return i === -1 ? "" : idOrPath.slice(0, i);
};

const basenameOf = (idOrPath: string): string => {
  const i = idOrPath.lastIndexOf("/");
  return i === -1 ? idOrPath : idOrPath.slice(i + 1);
};

const idToFilePath = (id: string): string => `${ROOT}/${id}${NOTE_EXT}`;
const trashFilePath = (id: string): string => `${TRASH}/${id}${NOTE_EXT}`;

/** true, если ключ meta-кэша указывает внутрь корзины. Позволяет основному
 *  дереву и дереву корзины делить один кэш, не вычищая записи друг друга:
 *  каждый листинг чистит только ключи со своей стороны воркспейса. */
const isTrashPath = (path: string): boolean => path.startsWith(`${TRASH}/`);

/** "notes/X/foo.md" даёт "X/foo": срезает префикс воркспейса и расширение. */
const noteRelFromAbs = (abs: string, root: string): string =>
  abs.slice(root.length + 1).slice(0, -NOTE_EXT.length);

/** "notes/X" даёт "X": срезает префикс воркспейса. */
const folderRelFromAbs = (abs: string, root: string): string =>
  abs.slice(root.length + 1);

/** Случайный суффикс base-36. Именно случайный (не таймстамп), чтобы цикл
 *  ретраев давал разные кандидаты в пределах одной миллисекунды. */
const randomSuffix = (len: number): string =>
  Math.random()
    .toString(36)
    .slice(2, 2 + len)
    .padStart(len, "0");

const collisionSuffix = (): string => `-${randomSuffix(COLLISION_SUFFIX_LEN)}`;
const restoredSuffix = (): string => `-restored${collisionSuffix()}`;

/** Путь со слешами портабелен между Windows / macOS / Linux, когда идёт в
 *  `convertFileSrc` Tauri и asset-протокол. */
function joinAbsolute(dir: string, ...parts: string[]): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].filter(Boolean).join("/");
}

/** Достаёт расширение в нижнем регистре (без точки) из имени или пути, иначе
 *  отдаёт fallback. */
function extOf(nameOrPath: string, fallback: string): string {
  const ext = nameOrPath.match(FILE_EXT_REGEX)?.[1];
  return (ext ?? fallback).toLowerCase();
}

/** Приводит введённое юзером имя папки к тому, что реально ляжет на диск:
 *  тримит, заменяет запрещённые в ФС символы и обрезает длину. Экспортим, чтобы
 *  стор проверял дубли по настоящему имени. */
export function sanitizeFolderName(name: string): string {
  return name.trim().replace(FOLDER_NAME_FORBIDDEN, "_").slice(0, MAX_FOLDER_NAME);
}

// ─── Фронтматтер ───────────────────────────────────────────────────────────

const FRONTMATTER_START = "---";

function serializeFrontmatter(extra: Record<string, FrontmatterValue>): string {
  const lines: string[] = [FRONTMATTER_START];
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      // Пустые массивы выкидываем: фронтматтер остаётся компактным в типичном
      // случае, когда поле (aliases) не задано. Нестроковые элементы тоже
      // на всякий пропускаем (с типом FrontmatterValue их быть не должно).
      const items = value.filter((x): x is string => typeof x === "string");
      if (items.length === 0) continue;
      // Инлайн JSON-массив в одну строку. Obsidian тоже читает эту форму, она
      // детерминированная и переживает round-trip через parseFrontmatter ниже.
      lines.push(`${key}: ${JSON.stringify(items)}`);
    } else if (typeof value === "string") {
      // JSON.stringify и в кавычки берёт, и экранирует управляющие символы
      // (\n, \"), так фронтматтер остаётся построчным и репарсится.
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push(FRONTMATTER_START, "");
  return lines.join("\n");
}

function parseFrontmatter(raw: string): {
  meta: FrontmatterRecord;
  body: string;
} {
  const { frontmatter, body } = splitMarkdownSource(raw);
  if (!frontmatter) return { meta: {}, body };
  const block = frontmatter.replace(/^(?:\uFEFF)?---[^\n]*\n/, "")
    .replace(/(?:---|\.\.\.)[ \t]*(?:\r?\n)?$/, "").trim();

  const meta: FrontmatterRecord = {};
  const blockLines = block.split("\n");
  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i];
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    // Nested/custom YAML remains intact in the source, but is not app metadata.
    if (/^\s/.test(line)) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    const rest = line.slice(idx + 1).trim();
    // YAML-СПИСОК: `aliases:`, а под ним строки с отступом `- item`. Так
    // Obsidian по умолчанию пишет aliases. Собираем подряд идущие строки "- "
    // в массив и сдвигаем индекс цикла за них. JSON-массив на той же строке
    // (rest начинается с "[") сюда не попадает, его ловим ниже как инлайн
    // JSON-массив.
    if (rest === "") {
      // Заглядываем, нет ли YAML-списка. Строки-буллеты с отступом после ключа
      // с пустым значением это его элементы, первая не-буллет строка его закрывает.
      const items: string[] = [];
      let j = i + 1;
      while (j < blockLines.length) {
        const ln = blockLines[j];
        // Строка-элемент "- value" (с отступом или без).
        const m = /^\s*-\s+(.+?)\s*$/.exec(ln);
        if (!m) break;
        // Снимаем обрамляющие кавычки (Obsidian пишет и так, и так).
        let v = m[1];
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        items.push(v);
        j++;
      }
      if (items.length > 0) {
        meta[key] = items;
        i = j - 1; // пропускаем уже съеденные строки-элементы
        continue;
      }
      meta[key] = "";
      continue;
    }
    // ИНЛАЙН JSON-МАССИВ: `aliases: ["x", "y"]`, гоняем через JSON.parse.
    if (rest.startsWith("[") && rest.endsWith("]")) {
      try {
        const parsed = JSON.parse(rest);
        if (
          Array.isArray(parsed) &&
          parsed.every((x) => typeof x === "string")
        ) {
          meta[key] = parsed as string[];
          continue;
        }
      } catch {
        /* битый JSON, проваливаемся в скалярный разбор */
      }
    }
    meta[key] = parseFrontmatterValue(rest);
  }
  return { meta, body };
}

function parseFrontmatterValue(value: string): FrontmatterValue {
  if (!value) return "";
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  // Похожее на целое число (сюда же таймстампы и наш `favorite: 1`).
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  // JSON разбирает "true"/"false" и строки в кавычках, всё прочее проваливается
  // и считается голым простым текстом.
  try {
    const parsed = JSON.parse(value);
    if (
      typeof parsed === "string" ||
      typeof parsed === "number" ||
      typeof parsed === "boolean" ||
      parsed === null
    ) {
      return parsed;
    }
  } catch {
    /* не валидный JSON, ниже считаем простой строкой */
  }
  return value;
}

/**
 * Достаёт уникальные токены `#tag` из тела markdown. Тег должен начинаться с
 * буквы (латиница или кириллица), чтобы не цеплять `#1`, `#999` и т.п. Теги
 * внутри блоков кода и инлайн-кода игнорим.
 */
function extractTags(body: string): string[] {
  // Сначала вырезаем огороженные блоки кода и инлайн-код.
  const noCode = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ");
  const re = /(?:^|[^A-Za-z0-9_/])#([\p{L}][\p{L}\p{N}_/-]{0,40})/gmu;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(noCode)) !== null) {
    out.add(match[1].toLowerCase());
  }
  return [...out].sort();
}

/**
 * Достаёт уникальные цели `[[wiki-link]]` из тела (в нижнем регистре, чтобы
 * сопоставлять title без учёта регистра). Блоки кода и инлайн-код игнорим, как
 * и в тегах.
 */
function extractLinks(body: string): string[] {
  const out = new Set<string>();
  mapMarkdownText(body, (text) => {
    const re = /\[\[([^[\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const path = wikiTarget(match[1]).path;
      if (path) out.add(basenameOf(path).replace(/\.md$/i, "").toLowerCase());
    }
    return text;
  });
  return [...out];
}

const PREVIEW_TRANSFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/```[\s\S]*?```/g, " [код] "],
  [/!\[([^\]]*)\]\([^)]+\)/g, ""], // картинки: выкидываем
  [/\[([^\]]+)\]\([^)]+\)/g, "$1"], // ссылки: оставляем подпись
  [/^#+\s+/gm, ""], // маркеры заголовков
  [/\*\*([^*]+)\*\*/g, "$1"], // жирный
  [/\*([^*]+)\*/g, "$1"], // курсив
  [/_([^_]+)_/g, "$1"], // курсив через подчёркивание
  [/`([^`]+)`/g, "$1"], // инлайн-код
  [/^[-*+]\s+/gm, ""], // маркеры списков
  [/^\d+\.\s+/gm, ""], // маркеры нумерованных списков
  [/^>\s+/gm, ""], // маркеры цитат
  [/\n+/g, " "], // схлопываем переносы
  [/\s+/g, " "], // схлопываем пробелы
];

function extractPreview(body: string, max = PREVIEW_DEFAULT_MAX): string {
  // Ограничиваем работу регэкспов: превью всё равно показывает первые ~240
  // символов, так что 13 проходов по 100 КБ тела это впустую сожжённый CPU на
  // каждом рефреше дерева. PREVIEW_BODY_SLICE_FACTOR (10x) оставляет запас под
  // markdown-маркеры, которые трансформы потом выкинут.
  let out = body.length > max * PREVIEW_BODY_SLICE_FACTOR
    ? body.slice(0, max * PREVIEW_BODY_SLICE_FACTOR)
    : body;
  for (const [re, replacement] of PREVIEW_TRANSFORMS) {
    out = out.replace(re, replacement);
  }
  return out.trim().slice(0, max);
}

function asNumber(v: FrontmatterValue | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}
function asBool(v: FrontmatterValue | undefined): boolean {
  return v === true || v === 1;
}

function metaFromRaw(
  raw: FrontmatterRecord,
  pathId: string,
  folder: string,
  body: string,
  times?: { createdAt: number; updatedAt: number },
  sidecarId = pathId,
): NoteMeta {
  const now = Date.now();
  const meta: NoteMeta = {
    // Путь на диске это единственный источник правды для id заметки. `id` во
    // фронтматтере только информационный: он протухает, когда родительскую
    // папку переименовали или подвинули (мы не переписываем каждую вложенную
    // заметку), и доверять ему значит вести чтения и клики на несуществующий путь.
    id: pathId,
    title: typeof raw.title === "string" ? raw.title : basenameOf(pathId) || DEFAULT_TITLE,
    folder,
    createdAt: asNumber(raw.createdAt, times?.createdAt || now),
    updatedAt: asNumber(raw.updatedAt, times?.updatedAt || now),
    icon: typeof raw.icon === "string" ? raw.icon : null,
    iconColor: typeof raw.iconColor === "string" ? raw.iconColor : null,
    frontmatterIcons: Object.fromEntries(Object.entries(raw).filter(([key, value]) => key !== "blocknote" && typeof value === "string" && value.length <= 256)) as Record<string, string>,
    cover: typeof raw.cover === "string" ? raw.cover : null,
    preview: extractPreview(body),
    favorite: asBool(raw.favorite),
    tags: [...new Set([...extractTags(body), ...(Array.isArray(raw.tags) ? raw.tags : [])])],
    links: extractLinks(body),
    mood: typeof raw.mood === "number" ? raw.mood : null,
    // Aliases приходят в любой из форм (JSON-массив `["x","y"]` или YAML-список).
    // parseFrontmatter сводит обе к string[]. Тримим каждый элемент и выкидываем
    // пустые, чтобы странности фронтматтера ("aliases: ['']") не протекли в
    // попап [[ пустым совпадением.
    aliases: Array.isArray(raw.aliases)
      ? (raw.aliases as string[]).map((s) => s.trim()).filter((s) => s.length > 0)
      : undefined,
  };
  return applyObsidianMetadata(meta, sidecarId);
}

// ─── Хелперы файловой системы ────────────────────────────────────────────────────

async function ensureDir(path: string): Promise<void> {
  // mkdir с recursive:true это no-op, если папка уже есть, так что пред-проверка
  // не нужна (экономим один заход по IPC).
  await mkdir(path, { ...APP_DATA, recursive: true });
}

async function pathExists(relPath: string): Promise<boolean> {
  return exists(relPath, APP_DATA);
}

/** The SDK's readTextFile decoder strips UTF-8 BOM; copied source must retain it. */
async function readMarkdownSource(path: string): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(await readFile(path, APP_DATA));
}

/**
 * true для ошибок ФС вида "пути/файла нет". Обход дерева делает `readDir` по
 * папке, а потом читает каждый файл, но параллельный trash / restore / delete
 * может убрать файл в этом окне, и тогда чтение падает с ENOENT (POSIX) или
 * ERROR_FILE|PATH_NOT_FOUND (Windows: "os error 2" / "os error 3"). Это
 * ожидаемая гонка, а не настоящий сбой: молча пропускаем запись, а не логируем
 * каждый исчезнувший файл. Иначе trash на пару тысяч файлов завалит консоль
 * ошибками, и само это логирование дёргает UI (особенно с открытым DevTools).
 */
function isMissingPathError(e: unknown): boolean {
  const msg = String(
    (e as { message?: unknown } | null | undefined)?.message ?? e ?? "",
  ).toLowerCase();
  return (
    msg.includes("os error 2") || // Windows ERROR_FILE_NOT_FOUND, POSIX ENOENT
    msg.includes("os error 3") || // Windows ERROR_PATH_NOT_FOUND
    msg.includes("no such file") ||
    msg.includes("cannot find")
  );
}

/**
 * Ограничивает, сколько файлов заметок одновременно stat'ятся и читаются при
 * обходе дерева. `buildTree` разлетается по всем записям через `Promise.all`,
 * и на воркспейсе (или корзине) с тысячами заметок это тысячи одновременных
 * IPC-вызовов Tauri разом, что забивает мост и морозит UI. Глобальный семафор
 * держит число чтений в полёте под контролем, и обход остаётся отзывчивым при
 * любом размере дерева. Глобальный (а не на уровень рекурсии), чтобы глубокая
 * вложенность не множила лимит.
 */
const FILE_READ_CONCURRENCY = 48;

function createSemaphore(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (active < max) {
      active++;
      return;
    }
    // Слот занят, паркуемся, пока release() не передаст слот. Во время передачи
    // счётчик остаётся "полным" (release не уменьшает его, когда будит
    // ожидающего), так что лимит никогда не превышается.
    await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active--;
  };
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

const fileReadSemaphore = createSemaphore(FILE_READ_CONCURRENCY);

// todo rename retry нужен только на Windows, можно обернуть в флаг
/** Часть rename'ов на Windows ловит ВРЕМЕННЫЙ сбой: MoveFileEx возвращает
 *  sharing-violation или access-denied, пока антивирус или индексатор поиска
 *  ненадолго держит хэндл только что записанного файла. Очень частое дело сразу
 *  после сидинга или при массовом trash'е папок со свежими файлами. Папка тогда
 *  "не переезжает" и всплывает обратно на следующем рефреше. Ретрай с коротким
 *  бэкоффом даёт замку рассосаться (так делает Explorer под капотом), а реально
 *  сломанный rename всё равно бросит исключение после попыток, так что
 *  настоящие ошибки не маскируем. */
const RENAME_RETRY_ATTEMPTS = 5;
const RENAME_RETRY_BASE_MS = 40;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function renameInAppData(from: string, to: string): Promise<void> {
  for (let attempt = 1; attempt <= RENAME_RETRY_ATTEMPTS; attempt++) {
    try {
      await rename(from, to, RENAME_OPTS);
      return;
    } catch (e) {
      // На Windows `rename` иногда репортит ошибку (os error 2, "file not
      // found"), хотя файл реально переехал, это ложноотрицательный результат.
      // Сверяемся с настоящей ФС: если назначение теперь есть, а источника нет,
      // переезд состоялся, считаем это успехом. (Ловили вживую: rename .tmp
      // meta-кэша "упал", а целевой файл записался.)
      if ((await pathExists(to)) && !(await pathExists(from))) return;
      if (attempt === RENAME_RETRY_ATTEMPTS) throw e;
      await delay(RENAME_RETRY_BASE_MS * attempt); // 40, 80, 120, 160 мс
    }
  }
}

/**
 * Атомарная запись текста: сначала пишем в соседний `.tmp`, потом rename'им
 * поверх цели. rename атомарен на всех поддерживаемых платформах (POSIX
 * rename(2), Windows MoveFileEx с REPLACE_EXISTING), так что файл никогда не
 * виден недописанным, даже если процесс убили посреди записи.
 */
async function atomicWriteTextFile(
  path: string,
  contents: string,
): Promise<void> {
  const tmp = `${path}${TMP_SUFFIX}`;
  try {
    await writeTextFile(tmp, contents, APP_DATA);
    await renameInAppData(tmp, path);
  } catch (e) {
    await safeRemove(tmp);
    throw e;
  }
}

// Imported Markdown stays byte-for-byte intact for metadata-only operations.
// The manifest records provenance; movable markers and UI overrides live separately.
const OBSIDIAN_MANIFEST = `${ROOT}/.synapse/obsidian-import.json`;
const OBSIDIAN_METADATA = `${ROOT}/.synapse/obsidian-metadata.json`;
const ICONIZE_FILE = `${ROOT}/.synapse/iconize.json`;
let iconizeData: IconizeState | undefined;
let iconizeLoad: Promise<IconizeState> | undefined;
let iconizeWrite: Promise<unknown> = Promise.resolve();
const iconizeListeners = new Set<(data: IconizeState) => void>();
export function subscribeIconizeData(listener: (data: IconizeState) => void): () => void {
  iconizeListeners.add(listener); return () => { iconizeListeners.delete(listener); };
}
export async function readIconizeData(): Promise<IconizeState> {
  if (iconizeData) return iconizeData;
  if (!iconizeLoad) iconizeLoad = (async () => {
    if (!(await pathExists(ICONIZE_FILE))) return iconizeData = emptyIconizeState();
    const raw = JSON.parse(await readTextFile(ICONIZE_FILE, APP_DATA));
    if (raw?.version !== 1) throw new Error("Неподдерживаемая версия настроек Iconize");
    return iconizeData = coerceIconizeState(raw);
  })();
  try { return await iconizeLoad; } finally { iconizeLoad = undefined; }
}
/** Serialize metadata edits and publish only after an atomic successful write. */
export function updateIconizeData(update: (data: IconizeState) => IconizeState): Promise<IconizeState> {
  const next = iconizeWrite.then(async () => {
    const before = await readIconizeData(), data = update(before);
    if (data === before) return before;
    await ensureDir(`${ROOT}/.synapse`);
    await atomicWriteTextFile(ICONIZE_FILE, JSON.stringify(data, null, 2));
    iconizeData = data; for (const listener of iconizeListeners) listener(data);
    return data;
  });
  iconizeWrite = next.catch(() => undefined); return next;
}
type ObsidianOverrides = Partial<Pick<NoteMeta,
  "title" | "createdAt" | "updatedAt" | "icon" | "iconColor" | "cover" | "favorite" | "mood" | "aliases"
>> & { markdownSource: boolean };
type ObsidianState = { version: 1; notes: Record<string, ObsidianOverrides> };
let obsidianState: ObsidianState | null = null;
let obsidianLoadPromise: Promise<void> | null = null;
let obsidianWriteChain: Promise<void> = Promise.resolve();
const sourceWriteChains = new Map<string, Promise<void>>();

async function loadObsidianState(): Promise<void> {
  if (obsidianState) return;
  if (obsidianLoadPromise) return obsidianLoadPromise;
  obsidianLoadPromise = (async () => {
    const notes: Record<string, ObsidianOverrides> = Object.create(null);
    if (await pathExists(OBSIDIAN_MANIFEST)) {
      const manifest = JSON.parse(await readTextFile(OBSIDIAN_MANIFEST, APP_DATA));
      if (manifest?.version !== 1 || manifest?.kind !== "obsidian" || !Array.isArray(manifest.notePaths)) {
        throw new Error("Невозможно прочитать список импортированных заметок Obsidian");
      }
      for (const path of manifest.notePaths) {
        if (typeof path !== "string" || !path.endsWith(NOTE_EXT) || boundedVaultPath(path) !== path) {
          throw new Error("Некорректный путь в списке импортированных заметок Obsidian");
        }
        notes[path.slice(0, -NOTE_EXT.length)] = { markdownSource: true };
      }
    }
    if (await pathExists(OBSIDIAN_METADATA)) {
      const sidecar = JSON.parse(await readTextFile(OBSIDIAN_METADATA, APP_DATA));
      if (sidecar?.version !== 1 || !sidecar.notes || typeof sidecar.notes !== "object" || Array.isArray(sidecar.notes)) {
        throw new Error("Невозможно прочитать метаданные импортированных заметок Obsidian");
      }
      for (const [id, value] of Object.entries(sidecar.notes)) {
        if (boundedVaultPath(id) !== id || !value || typeof value !== "object" || Array.isArray(value)) continue;
        const data = value as Record<string, unknown>;
        if (typeof data.markdownSource !== "boolean") continue;
        const entry: ObsidianOverrides = { markdownSource: data.markdownSource };
        if (typeof data.title === "string") entry.title = data.title;
        for (const key of ["createdAt", "updatedAt"] as const) {
          if (typeof data[key] === "number" && Number.isFinite(data[key])) entry[key] = data[key];
        }
        for (const key of ["icon", "iconColor", "cover"] as const) {
          if (data[key] === null || typeof data[key] === "string") entry[key] = data[key];
        }
        if (typeof data.favorite === "boolean") entry.favorite = data.favorite;
        if (data.mood === null || (typeof data.mood === "number" && data.mood >= 1 && data.mood <= 5)) entry.mood = data.mood;
        if (Array.isArray(data.aliases) && data.aliases.every((s) => typeof s === "string")) entry.aliases = data.aliases;
        notes[id] = entry;
      }
    }
    obsidianState = { version: 1, notes };
  })();
  try { await obsidianLoadPromise; } finally { obsidianLoadPromise = null; }
}

function applyObsidianMetadata(meta: NoteMeta, id = meta.id): NoteMeta {
  const entry = obsidianState?.notes[id];
  return entry?.markdownSource ? { ...meta, ...entry } : meta;
}

/** Serialize sidecar transactions; commit in memory only after a successful disk write. */
function updateObsidianState(update: (notes: ObsidianState["notes"]) => string[]): Promise<void> {
  const next = obsidianWriteChain.then(async () => {
    await loadObsidianState();
    const notes = Object.assign(Object.create(null), obsidianState!.notes);
    const changed = update(notes);
    if (!changed.length) return;
    await ensureDir(`${ROOT}/.synapse`);
    await atomicWriteTextFile(OBSIDIAN_METADATA, JSON.stringify({ version: 1, notes }, null, 2));
    obsidianState = { version: 1, notes };
    // Only the changed overlays can invalidate cached metadata. Load persisted
    // entries too when an edit precedes the first listTree in this window.
    await loadMetaCache();
    for (const id of changed) {
      if (metaCache.delete(idToFilePath(id))) metaCacheDirty = true;
    }
  });
  obsidianWriteChain = next.catch(() => undefined);
  return next;
}

function sourceRecordsFor(notes: ObsidianState["notes"], from: string, folder: boolean): [string, ObsidianOverrides][] {
  if (!folder) return notes[from]?.markdownSource ? [[from, notes[from]]] : [];
  return Object.entries(notes).filter(([id, data]) => data.markdownSource && id.startsWith(`${from}/`));
}

/** Called after an on-disk move, including folder moves and collisions in trash. */
async function rebaseObsidianMetadata(from: string, to: string, folder = false): Promise<void> {
  await updateObsidianState((notes) => {
    const moved = sourceRecordsFor(notes, from, folder);
    for (const [id, data] of moved) {
      notes[id] = { markdownSource: false }; // shadows the immutable import manifest
      notes[to + id.slice(from.length)] = data;
    }
    return moved.flatMap(([id]) => [id, to + id.slice(from.length)]);
  });
}

async function relocateWithObsidianMetadata(
  from: string,
  to: string,
  folder: boolean,
  move: () => Promise<void>,
): Promise<void> {
  await loadMetaCache();
  const sourcePath = folder ? `${ROOT}/${from}` : idToFilePath(from);
  const single = metaCache.get(sourcePath);
  const cached: [string, MetaCacheEntry][] = folder
    ? [...metaCache].filter(([path]) => path.startsWith(`${sourcePath}/`))
    : single ? [[sourcePath, single]] : [];
  // Stage both markers before the filesystem move. If the app stops between
  // these steps, either possible on-disk location still opens as source.
  const destinations = new Map<string, ObsidianOverrides | undefined>();
  await updateObsidianState((notes) => {
    const moved = sourceRecordsFor(notes, from, folder);
    for (const [id, data] of moved) {
      const destination = to + id.slice(from.length);
      destinations.set(destination, notes[destination]);
      notes[destination] = data;
    }
    return moved.map(([id]) => to + id.slice(from.length));
  });
  // Keep both possible locations staged until the filesystem move commits.
  const previousIcons = await readIconizeData();
  const movedIcons = rebaseIconAssignments(previousIcons, from, to, folder);
  const iconDestinations = new Map<string, IconizeState["assignments"][string] | undefined>();
  let iconsStaged = false;
  try {
    if (movedIcons !== previousIcons) {
      await updateIconizeData(data => {
        const rebased = rebaseIconAssignments(data, from, to, folder);
        const assignments = { ...data.assignments };
        for (const [key, value] of Object.entries(rebased.assignments)) {
          if (data.assignments[key] === value) continue;
          iconDestinations.set(key, data.assignments[key]); assignments[key] = value;
        }
        return { ...data, assignments };
      });
      iconsStaged = true;
    }
    await move();
  } catch (e) {
    if (iconsStaged) await updateIconizeData(data => {
      const assignments = { ...data.assignments };
      for (const [key, value] of iconDestinations) { if (value) assignments[key] = value; else delete assignments[key]; }
      return { ...data, assignments };
    });
    await updateObsidianState((notes) => {
      for (const [id, previous] of destinations) {
        if (previous) notes[id] = previous;
        else delete notes[id];
      }
      return [...destinations.keys()];
    });
    throw e;
  }
  await rebaseObsidianMetadata(from, to, folder);
  if (movedIcons !== previousIcons) await updateIconizeData(data => rebaseIconAssignments(data, from, to, folder));
  // Directory renames keep their files unchanged. Source-note moves preserve
  // bytes too. Native individual moves rewrite frontmatter afterward, and a
  // collision can change a filename-derived title: keep both on cache misses.
  for (const [path, entry] of cached) {
    const target = folder ? `${ROOT}/${to}${path.slice(sourcePath.length)}` : idToFilePath(to);
    const sidecarId = target.slice(ROOT.length + 1, -NOTE_EXT.length);
    if (!folder && (!obsidianState?.notes[sidecarId]?.markdownSource || basenameOf(from) !== basenameOf(to))) continue;
    const id = sidecarId.startsWith(".trash/") ? sidecarId.slice(".trash/".length) : sidecarId;
    metaCache.delete(path);
    metaCache.set(target, { ...entry, meta: { ...entry.meta, id, folder: parentOf(id) } });
    metaCacheDirty = true;
  }
}

async function forgetObsidianMetadata(path: string, folder = false): Promise<void> {
  await updateObsidianState((notes) => {
    const changed: string[] = [];
    for (const id of Object.keys(notes)) {
      if (folder ? id.startsWith(`${path}/`) : id === path) {
        notes[id] = { markdownSource: false };
        changed.push(id);
      }
    }
    return changed;
  });
  await updateIconizeData(data => {
    const assignments = { ...data.assignments }; let changed = false;
    for (const key of Object.keys(assignments)) {
      const iconPath = key.slice(key.indexOf(":") + 1);
      if (folder ? iconPath === path || iconPath.startsWith(path + "/") : key === "file:" + path + ".md") { delete assignments[key]; changed = true; }
    }
    return changed ? { ...data, assignments } : data;
  });
}

async function writeObsidianNote(note: Note): Promise<void> {
  if (note.sourceRevision === undefined) throw new Error("Перечитайте исходный Markdown перед сохранением");
  const revision = note.sourceRevision;
  const nextSource = markdownSourceToWrite(revision, note.sourceText, note.content);
  const path = idToFilePath(note.id);
  const fileInfo = await stat(path, APP_DATA);
  if (nextSource !== revision) {
    const latest = await readMarkdownSource(path);
    if (latest !== nextSource) {
      assertMarkdownSourceUnchanged(revision, latest);
      // Keep a full source snapshot, even when only frontmatter changed.
      await snapshotNoteNow(note.id);
      const temp = `${path}.synapse-${randomSuffix(8)}${TMP_SUFFIX}`;
      try {
        await writeTextFile(temp, nextSource, APP_DATA);
        assertMarkdownSourceUnchanged(revision, await readMarkdownSource(path));
        await renameInAppData(temp, path);
      } catch (e) {
        await safeRemove(temp);
        throw e;
      }
    }
  }
  const previousParts = parseFrontmatter(revision);
  const before = metaFromRaw(previousParts.meta, note.id, note.folder, previousParts.body, {
    createdAt: fileInfo.birthtime?.getTime() ?? fileInfo.mtime?.getTime() ?? note.createdAt,
    updatedAt: fileInfo.mtime?.getTime() ?? note.updatedAt,
  });
  await updateObsidianState((notes) => {
    const entry = { ...(notes[note.id] ?? { markdownSource: true }) };
    let changed = false;
    if (nextSource !== revision && !previousParts.meta.createdAt && entry.createdAt === undefined) {
      entry.createdAt = note.createdAt;
      changed = true;
    }
    for (const key of ["title", "createdAt", "updatedAt", "icon", "iconColor", "cover", "favorite", "mood", "aliases"] as const) {
      if (JSON.stringify(note[key]) === JSON.stringify(before[key])) continue;
      Object.assign(entry, { [key]: note[key] ?? (key === "aliases" ? [] : null) });
      changed = true;
    }
    if (changed) notes[note.id] = entry;
    return changed ? [note.id] : [];
  });
  metaCache.delete(path);
  metaCacheDirty = true;
}

/** Inventory excludes symlinks and internal metadata; assets may keep original names. */
export async function listVaultFiles(): Promise<string[]> {
  await ensureWorkspace();
  const files: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await readDir(folder ? `${ROOT}/${folder}` : ROOT, APP_DATA);
    for (const entry of entries) {
      if (!entry.name || entry.isSymlink || (entry.name.startsWith(".") && entry.name !== ".assets")) continue;
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory) await walk(path);
      else if (entry.isFile) files.push(path);
    }
  };
  await walk("");
  return files;
}

/**
 * Подбирает ещё не занятый путь назначения. Если первый вариант свободен,
 * возвращает его как есть. Иначе дописывает `-<random>` (или `-<random>.md`) и
 * повторяет до MAX_COLLISION_RETRIES раз, каждый ретрай даёт свежий случайный
 * суффикс.
 *
 * При исчерпании попыток бросает исключение, а не молча перезаписывает
 * существующий файл: `rename(2)` ПЕРЕЗАПИСЫВАЕТ назначение на всех наших
 * платформах, так что слепой rename на конфликтующий путь это путь к потере
 * данных.
 *
 * Про TOCTOU: между последней проверкой `pathExists` и самим `rename`
 * параллельный переезд теоретически может занять слот. В Tauri-приложении с
 * одним окном это окно гонки микроскопическое и безвредное. Станет реальной
 * проблемой, если заведём рабочие окна, лезущие в тот же воркспейс.
 */
async function uniqueDestination(initial: string): Promise<string> {
  if (!(await pathExists(initial))) return initial;
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const candidate = initial.replace(
      /(\.md)?$/,
      (m) => `${collisionSuffix()}${m}`,
    );
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(
    `uniqueDestination: could not find a free name for ${initial} ` +
      `after ${MAX_COLLISION_RETRIES} attempts`,
  );
}

async function uniqueRestoreDestination(
  initial: string,
  ext: "" | typeof NOTE_EXT,
): Promise<string> {
  if (!(await pathExists(initial))) return initial;
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const candidate = ext
      ? initial.replace(/\.md$/, `${restoredSuffix()}${ext}`)
      : `${initial}${restoredSuffix()}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(
    `uniqueRestoreDestination: could not find a free name for ${initial} ` +
      `after ${MAX_COLLISION_RETRIES} attempts`,
  );
}

export function newNoteId(folder = ""): string {
  const slug = `note-${Date.now()}-${randomSuffix(NEW_ID_RANDOM_LEN)}`;
  return folder ? `${folder}/${slug}` : slug;
}

// ─── Кэш меты заметок (по ключу mtime) ──────────────────────────────────────
// Сборка дерева парсит фронтматтер каждой заметки, и на большом воркспейсе это
// главная статья расходов. Кэшируем разобранную мету по пути файла, помечая её
// mtime и size. На следующем чтении делаем `stat` файла и, если не менялся,
// вообще пропускаем чтение и парсинг фронтматтера. Источник правды это файлы,
// а кэш одноразовый ускоритель: неверная или пропавшая запись стоит максимум
// одного переразбора, а битый или с несовпавшей версией файл кэша игнорим
// (собираем заново). Кладём его в воркспейс, чтобы и холодный старт был быстрым.
// Это дотфайл, так что обход дерева (skipDotted) его никогда не показывает.

const META_CACHE = `${ROOT}/.meta-cache.json`;
const META_CACHE_VERSION = 3;

type MetaCacheEntry = { mtime: number; size: number; meta: NoteMeta };

const metaCache = new Map<string, MetaCacheEntry>();
let metaCacheLoaded = false;
let metaCacheLoadPromise: Promise<void> | null = null;
let metaCacheDirty = false;

/** Наполняет кэш в памяти с диска один раз за сессию. Синглтон через promise
 *  в полёте (как loadRefsCache / getAppDataDir): раньше флаг переключался ДО
 *  await, и два конкурентных вызова (refreshAll запускает listTree и
 *  listTrashTree параллельно) видели "loaded=true", пока map был ещё пуст,
 *  второй обход проходил мимо кэша и переразбирал фронтматтер каждой заметки.
 *  Теперь оба ждут один promise, флаг переключается только после наполнения. */
function loadMetaCache(): Promise<void> {
  if (metaCacheLoaded) return Promise.resolve();
  if (metaCacheLoadPromise) return metaCacheLoadPromise;
  metaCacheLoadPromise = (async () => {
    try {
      if (!(await pathExists(META_CACHE))) return;
      const parsed: unknown = JSON.parse(
        await readTextFile(META_CACHE, APP_DATA),
      );
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { v?: unknown }).v !== META_CACHE_VERSION
      ) {
        return; // нет / не та форма / старая версия, собираем заново
      }
      const entries = (parsed as { entries?: unknown }).entries;
      if (!entries || typeof entries !== "object") return;
      for (const [path, entry] of Object.entries(entries)) {
        const e = entry as Partial<MetaCacheEntry>;
        if (
          e &&
          typeof e.mtime === "number" &&
          typeof e.size === "number" &&
          e.meta &&
          typeof e.meta === "object"
        ) {
          metaCache.set(path, e as MetaCacheEntry);
        }
      }
    } catch (err) {
      console.error("loadMetaCache failed (ignoring cache):", err);
      metaCache.clear();
    } finally {
      // Переключаем "loaded" только ПОСЛЕ наполнения, чтобы конкурентные вызовы
      // видели полностью набитый map (или пустой, если файла не было).
      metaCacheLoaded = true;
      metaCacheLoadPromise = null;
    }
  })();
  return metaCacheLoadPromise;
}

/** Сериализует флаши, чтобы два конкурентных листинга (refreshAll гоняет
 *  listTree и listTrashTree параллельно) не писали `.tmp` общего файла кэша
 *  одновременно, не портили его и не дрались за rename. */
let metaCacheFlushChain: Promise<void> = Promise.resolve();

/** Сохраняет кэш, если он менялся с прошлого флаша. По возможности. Сцеплено,
 *  чтобы вызовы шли строго по одному, а схлопнутый вызов, нашедший кэш уже
 *  чистым, возвращается сразу. */
function flushMetaCache(): Promise<void> {
  const next = metaCacheFlushChain.then(async () => {
    if (!metaCacheDirty) return;
    metaCacheDirty = false;
    try {
      const entries: Record<string, MetaCacheEntry> = {};
      for (const [path, entry] of metaCache) entries[path] = entry;
      await atomicWriteTextFile(
        META_CACHE,
        JSON.stringify({ v: META_CACHE_VERSION, entries }),
      );
    } catch (err) {
      console.error("flushMetaCache failed:", err);
      // Запись упала, оставляем кэш грязным, чтобы следующий флаш повторил, а не
      // молча потерял несохранённые записи. (Промах, записанный во время await,
      // тоже снова взводит флаг, так что и он не теряется.)
      metaCacheDirty = true;
    }
  });
  // Держим цепочку живой, даже если это звено отвалилось, чтобы следующий флаш всё равно прошёл.
  metaCacheFlushChain = next.catch(() => undefined);
  return next;
}

type TreeOptions = {
  /** Пропускать имена с точкой (например `.trash`, `.assets`)? */
  skipDotted: boolean;
  /** Использовать mtime-кэш меты при чтении заметок. Включено и для основного
   *  дерева, и для корзины: файлы в корзине неизменны, так что попадают в кэш
   *  идеально. */
  useCache: boolean;
  /** Если передан, записываем путь каждого посещённого файла, чтобы вызывающий
   *  мог почистить записи кэша для удалённых или перемещённых с тех пор файлов. */
  seen?: Set<string>;
};

/**
 * Строит массив TreeNode для директории по пути `basePath` (относительно
 * AppData). `relPrefix` это путь *содержащей* директории в том виде, в каком он
 * должен встречаться в id заметок. Каждую запись читаем параллельно:
 * последовательные await'ы были главной причиной тормозных рефрешей.
 */
async function buildTree(
  basePath: string,
  relPrefix: string,
  opts: TreeOptions,
): Promise<TreeNode[]> {
  if (!(await pathExists(basePath))) return [];
  const entries = await readDir(basePath, APP_DATA);

  const tasks: Promise<TreeNode | null>[] = entries.map(
    async (entry): Promise<TreeNode | null> => {
      if (!entry.name || entry.isSymlink) return null;
      if (opts.skipDotted && entry.name.startsWith(".")) return null;

      if (entry.isDirectory) {
        const subRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        const children = await buildTree(
          `${basePath}/${entry.name}`,
          subRel,
          opts,
        );
        return { kind: "folder", name: entry.name, path: subRel, children };
      }

      if (entry.isFile && entry.name.endsWith(NOTE_EXT)) {
        const filePath = `${basePath}/${entry.name}`;
        opts.seen?.add(filePath);
        const basename = entry.name.slice(0, -NOTE_EXT.length);
        const id = relPrefix ? `${relPrefix}/${basename}` : basename;
        // Ограничиваем число одновременных чтений: иначе воркспейс на пару тысяч
        // заметок выстрелит все чтения разом и заморозит UI.
        const meta = await fileReadSemaphore.run(() =>
          readNoteMeta(filePath, id, relPrefix, opts.useCache),
        );
        return meta ? { kind: "note", note: meta } : null;
      }
      return null;
    },
  );

  const nodes = (await Promise.all(tasks)).filter(
    (n): n is TreeNode => n !== null,
  );
  nodes.sort(compareTreeNodes);
  return nodes;
}

export function compareTreeNodes(a: TreeNode, b: TreeNode): number {
  // Сначала папки, потом заметки, каждая группа по отображаемому имени.
  // `numeric` даёт натуральный порядок, чтобы "2) ..." шло ПОСЛЕ "1) ..." (а не
  // лексикографически перед ним), а `sensitivity: "base"` делает без учёта регистра.
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  const an = a.kind === "folder" ? a.name : a.note.title;
  const bn = b.kind === "folder" ? b.name : b.note.title;
  return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
}

async function readNoteMeta(
  filePath: string,
  fallbackId: string,
  folder: string,
  useCache = false,
): Promise<NoteMeta | null> {
  const sidecarId = isTrashPath(filePath) ? `.trash/${fallbackId}` : fallbackId;
  // Быстрый путь: если файл не менялся с момента кэширования (тот же mtime и
  // size), отдаём кэшированную мету и вообще пропускаем чтение и парсинг.
  if (useCache) {
    let st: Awaited<ReturnType<typeof stat>> | null = null;
    try {
      st = await stat(filePath, APP_DATA);
    } catch (e) {
      // Файл исчез между readDir, который его перечислил, и сейчас (параллельный
      // trash / restore / delete посреди обхода), безобидная гонка. Молча
      // пропускаем, а не проваливаемся в чтение, которое снова упадёт и залогирует.
      if (isMissingPathError(e)) return null;
      st = null; // stat реально недоступен, проваливаемся в обычное чтение
    }
    if (st) {
      const mtime = st.mtime ? new Date(st.mtime).getTime() : 0;
      const size = Number(st.size ?? 0);
      const cached = metaCache.get(filePath);
      if (cached && mtime !== 0 && cached.mtime === mtime && cached.size === size) {
        return applyObsidianMetadata(cached.meta, sidecarId);
      }
      try {
        const raw = await readMarkdownSource(filePath);
        const { meta, body } = parseFrontmatter(raw);
        const result = metaFromRaw(meta, fallbackId, folder, body, {
          createdAt: st.birthtime ? new Date(st.birthtime).getTime() : mtime,
          updatedAt: mtime,
        }, sidecarId);
        metaCache.set(filePath, { mtime, size, meta: result });
        metaCacheDirty = true;
        return result;
      } catch (e) {
        // Нет файла = исчез посреди обхода (безобидная гонка), выселяем, он и
        // правда пропал. Всё прочее (замок антивируса, sharing-violation, OOM,
        // временный сбой I/O) оставляем в кэше, чтобы следующий скан попал, а
        // null вернул только текущий вызов. Раньше выселяли безусловно, и
        // единственная разовая флака приводила к полному переразбору заметки
        // на следующем листинге.
        if (isMissingPathError(e)) {
          metaCache.delete(filePath);
          metaCacheDirty = true;
        } else {
          console.error("readNoteMeta failed:", filePath, e);
        }
        return null;
      }
    }
  }
  // Путь без кэша (stat выше был недоступен).
  try {
    const raw = await readMarkdownSource(filePath);
    const { meta, body } = parseFrontmatter(raw);
    return metaFromRaw(meta, fallbackId, folder, body, undefined, sidecarId);
  } catch (e) {
    // Нет файла = исчез посреди обхода (безобидная гонка), логируем только настоящие сбои.
    if (!isMissingPathError(e)) {
      console.error("readNoteMeta failed:", filePath, e);
    }
    return null;
  }
}

/**
 * Локальный плоский обход списка TreeNode. Держим в синхроне с таким же
 * хелпером в `./treeUtils`. Две копии нужны, чтобы избежать циклической
 * зависимости модулей (treeUtils импортит типы из этого файла).
 */
function flattenNotes(tree: TreeNode[]): NoteMeta[] {
  const out: NoteMeta[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "folder") walk(node.children);
      else out.push(node.note);
    }
  };
  walk(tree);
  return out;
}

// ─── Публичное: листинги дерева ─────────────────────────────────────────────────

export async function listTree(): Promise<TreeNode[]> {
  await ensureWorkspace();
  await Promise.all([loadMetaCache(), loadObsidianState()]);
  const seen = new Set<string>();
  const tree = await buildTree(ROOT, "", {
    skipDotted: true,
    useCache: true,
    seen,
  });
  // Выкидываем записи кэша для файлов основного дерева, которых больше нет
  // (удалили или подвинули). Ключи корзины не трогаем (их чистит listTrashTree),
  // чтобы два листинга делили один кэш и не выселяли записи друг друга.
  for (const key of metaCache.keys()) {
    if (!isTrashPath(key) && !seen.has(key)) {
      metaCache.delete(key);
      metaCacheDirty = true;
    }
  }
  void flushMetaCache();
  return tree;
}

/**
 * Возвращает дерево того, что сейчас лежит в .trash/, повторяя структуру.
 *
 * Использует mtime-кэш меты, как и основное дерево: файлы в корзине на месте не
 * меняются, так что после первого листинга каждая запись это попадание в кэш на
 * одном лишь stat, без перечитывания и переразбора фронтматтера. Это и спасает
 * большую корзину от тормозов на каждом рефреше (вход в экран плюс refreshAll
 * после каждой операции с корзиной).
 */
export async function listTrashTree(): Promise<TreeNode[]> {
  await ensureWorkspace();
  await Promise.all([loadMetaCache(), loadObsidianState()]);
  const seen = new Set<string>();
  const tree = await buildTree(TRASH, "", {
    skipDotted: false,
    useCache: true,
    seen,
  });
  // Чистим записи кэша для файлов корзины, которых уже нет (восстановили или
  // вычистили). Трогаем только ключи корзины, ключи основного дерева чистит listTree.
  for (const key of metaCache.keys()) {
    if (isTrashPath(key) && !seen.has(key)) {
      metaCache.delete(key);
      metaCacheDirty = true;
    }
  }
  void flushMetaCache();
  return tree;
}

// ─── Публичное: чтение / запись заметки ─────────────────────────────────────────────

export async function readNote(id: string): Promise<Note | null> {
  await ensureWorkspace();
  await loadObsidianState();
  const path = idToFilePath(id);
  if (!(await pathExists(path))) return null;
  try {
    const [raw, fileInfo] = await Promise.all([readMarkdownSource(path), stat(path, APP_DATA)]);
    const { meta, body } = parseFrontmatter(raw);
    return {
      ...metaFromRaw(meta, id, parentOf(id), body, {
        createdAt: fileInfo.birthtime?.getTime() ?? fileInfo.mtime?.getTime() ?? Date.now(),
        updatedAt: fileInfo.mtime?.getTime() ?? Date.now(),
      }),
      content: body,
      ...(obsidianState?.notes[id]?.markdownSource ? { sourceText: raw, sourceRevision: raw } : {}),
      // Не держим это в NoteMeta (в дереве), чтобы кэш дерева оставался лёгким:
      // (потенциально большой) JSON редактора тащит только полное чтение заметки здесь.
      blocknote: typeof meta.blocknote === "string" ? meta.blocknote : null,
      bnHash: typeof meta.bnHash === "number" ? meta.bnHash : null,
    };
  } catch (e) {
    console.error("readNote failed:", id, e);
    return null;
  }
}

/** Читает только тело заметки из корзины (для превью только на чтение). */
export async function readTrashedNoteBody(trashId: string): Promise<string> {
  const path = trashFilePath(trashId);
  if (!(await pathExists(path))) return "";
  try {
    const raw = await readMarkdownSource(path);
    return parseFrontmatter(raw).body;
  } catch (e) {
    console.error("readTrashedNoteBody failed:", trashId, e);
    return "";
  }
}

/**
 * Следующий свободный заголовок "<prefix> N" для заметки прямо в `folder`:
 * сканирует `.md` этой папки, находит наибольший существующий N и возвращает
 * N+1 (или 1, если ничего нет). Нужно быстрому захвату, чтобы автоназывать
 * заметки ("Заметка 1", "Заметка 2", ...), а не выводить заголовок из тела.
 */
export async function nextNumberedTitle(
  folder: string,
  prefix: string,
): Promise<string> {
  await ensureWorkspace();
  const dir = folder ? `${ROOT}/${folder}` : ROOT;
  let maxN = 0;
  if (await pathExists(dir)) {
    const safe = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${safe} (\\d+)$`);
    const entries = await readDir(dir, APP_DATA);
    await Promise.all(
      entries
        .filter((e) => e.isFile && e.name?.endsWith(NOTE_EXT))
        .map(async (e) => {
          try {
            const raw = await readTextFile(`${dir}/${e.name}`, APP_DATA);
            const title = parseFrontmatter(raw).meta.title;
            if (typeof title === "string") {
              const m = re.exec(title.trim());
              if (m) maxN = Math.max(maxN, Number(m[1]));
            }
          } catch {
            /* не читается или исчез посреди скана, пропускаем */
          }
        }),
    );
  }
  return `${prefix} ${maxN + 1}`;
}

// ─── История версий заметки (снимки по заметке) ──────────────────────────────
// Перед каждой перезаписью, меняющей контент, ПРЕДЫДУЩЕЕ содержимое с диска
// копируется в `notes/.versions/<id>/<timestamp>.md`. С троттлингом, чтобы
// очередь автосейвов давала максимум один снимок за окно, и с лимитом на N
// последних. Это дотдир, так что обход дерева (skipDotted) его не показывает.
// Источник правды это файлы, а тут одноразовая страховка от случайной потери.

const VERSION_THROTTLE_MS = 10 * 60 * 1000; // не чаще одного снимка в 10 мин на заметку
const MAX_VERSIONS_PER_NOTE = 50;

export type NoteVersion = { timestamp: number };

const versionsDirOf = (id: string): string => `${VERSIONS}/${id}`;

/** Таймстамп самого свежего снимка в `dir`, или 0, если их нет. */
async function newestVersionTs(dir: string): Promise<number> {
  if (!(await pathExists(dir))) return 0;
  let newest = 0;
  for (const e of await readDir(dir, APP_DATA)) {
    if (!e.isFile || !e.name?.endsWith(NOTE_EXT)) continue;
    const ts = Number(e.name.slice(0, -NOTE_EXT.length));
    if (Number.isFinite(ts) && ts > newest) newest = ts;
  }
  return newest;
}

/** Обрезает папку снимков заметки до последних MAX_VERSIONS_PER_NOTE. */
async function pruneVersions(dir: string): Promise<void> {
  const files = (await readDir(dir, APP_DATA))
    .filter((e) => e.isFile && e.name?.endsWith(NOTE_EXT))
    .map((e) => e.name as string)
    .sort(); // таймстампы в мс фиксированной ширины: лексикографически = хронологически
  if (files.length <= MAX_VERSIONS_PER_NOTE) return;
  const excess = files.slice(0, files.length - MAX_VERSIONS_PER_NOTE);
  await Promise.all(excess.map((n) => safeRemove(`${dir}/${n}`)));
}

/**
 * Снимает текущее содержимое заметки с диска перед перезаписью, когда: файл
 * есть, его ТЕЛО реально отличается от приходящего (чтобы сейвы только меты или
 * таймстампа не плодили версии), тело не пустое и последний снимок старше окна
 * троттлинга. По возможности: вызывающие глотают ошибки, так что сбой бэкапа
 * никогда не блокирует сам сейв.
 */
async function snapshotPreviousVersion(
  id: string,
  newBody: string,
): Promise<void> {
  const path = idToFilePath(id);
  if (!(await pathExists(path))) return; // совсем новая заметка, прошлого нет
  const prev = await readMarkdownSource(path);
  const prevBody = parseFrontmatter(prev).body;
  if (prevBody === newBody) return; // контент не менялся
  if (!prevBody.trim()) return; // пустую заметку не версионируем
  const dir = versionsDirOf(id);
  const newest = await newestVersionTs(dir);
  if (newest && Date.now() - newest < VERSION_THROTTLE_MS) return; // слишком рано
  await ensureDir(dir);
  await writeTextFile(`${dir}/${Date.now()}${NOTE_EXT}`, prev, APP_DATA);
  await pruneVersions(dir);
}

/**
 * Принудительно снимает текущее содержимое заметки с диска прямо сейчас, минуя
 * троттлинг. Нужно перед разрушительным изменением на месте (например, откатом к
 * старой версии), чтобы текущее состояние всегда можно было вернуть. По возможности.
 */
export async function snapshotNoteNow(id: string): Promise<void> {
  const path = idToFilePath(id);
  if (!(await pathExists(path))) return;
  const prev = await readMarkdownSource(path);
  if (!prev.trim()) return;
  const dir = versionsDirOf(id);
  await ensureDir(dir);
  await writeTextFile(`${dir}/${Date.now()}${NOTE_EXT}`, prev, APP_DATA);
  await pruneVersions(dir);
}

/** Снимки заметки, новые сверху. */
export async function listNoteVersions(id: string): Promise<NoteVersion[]> {
  const dir = versionsDirOf(id);
  if (!(await pathExists(dir))) return [];
  try {
    const out: NoteVersion[] = [];
    for (const e of await readDir(dir, APP_DATA)) {
      if (!e.isFile || !e.name?.endsWith(NOTE_EXT)) continue;
      const ts = Number(e.name.slice(0, -NOTE_EXT.length));
      if (Number.isFinite(ts)) out.push({ timestamp: ts });
    }
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out;
  } catch (e) {
    console.error("listNoteVersions failed:", id, e);
    return [];
  }
}

/** Читает тело одного снимка плюс lossless-нагрузку редактора (для превью или восстановления). */
export async function readNoteVersion(
  id: string,
  timestamp: number,
): Promise<{
  body: string;
  blocknote: string | null;
  bnHash: number | null;
  sourceText: string;
} | null> {
  const file = `${versionsDirOf(id)}/${timestamp}${NOTE_EXT}`;
  if (!(await pathExists(file))) return null;
  try {
    const raw = await readMarkdownSource(file);
    const { meta, body } = parseFrontmatter(raw);
    return {
      body,
      sourceText: raw,
      blocknote: typeof meta.blocknote === "string" ? meta.blocknote : null,
      bnHash: typeof meta.bnHash === "number" ? meta.bnHash : null,
    };
  } catch (e) {
    console.error("readNoteVersion failed:", id, timestamp, e);
    return null;
  }
}

/**
 * Сохраняет заметку на диск *атомарно*: сначала пишет в `<path>.tmp`, потом
 * rename'ит поверх цели. Читатель никогда не увидит недописанный файл.
 */
export async function writeNote(note: Note): Promise<void> {
  await ensureWorkspace();
  await loadObsidianState();
  if (note.markdownSource || obsidianState?.notes[note.id]?.markdownSource) {
    const previous = sourceWriteChains.get(note.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => writeObsidianNote(note));
    sourceWriteChains.set(note.id, next);
    try { await next; } finally {
      if (sourceWriteChains.get(note.id) === next) sourceWriteChains.delete(note.id);
    }
    return;
  }
  const path = idToFilePath(note.id);
  await ensureDir(parentOf(path));
  // Снимаем предыдущую версию с диска перед перезаписью (с троттлингом, по
  // возможности: сбой бэкапа не должен блокировать сам сейв).
  await snapshotPreviousVersion(note.id, note.content).catch((e) =>
    console.error("snapshotPreviousVersion failed:", note.id, e),
  );
  const frontmatter = serializeFrontmatter({
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    icon: note.icon,
    iconColor: note.iconColor ?? null,
    cover: note.cover,
    favorite: note.favorite ? 1 : null,
    mood: note.mood ?? null,
    // Aliases. serializeFrontmatter пропускает null/undefined И выкидывает
    // пустые массивы, так что заметка без aliases сюда ничего не пишет.
    aliases: note.aliases ?? null,
    // Структура редактора без потерь плюс хэш, связывающий её с телом ниже.
    // Пишем последней (строка JSON может быть длинной), serializeFrontmatter
    // её JSON-кодирует, так что остаётся одной строкой фронтматтера.
    blocknote: note.blocknote ?? null,
    bnHash: note.bnHash ?? null,
  });
  await atomicWriteTextFile(path, frontmatter + note.content);
}

// ─── Публичное: перемещение ──────────────────────────────────────────────────────────

/**
 * Перемещает заметку в другую папку. Возвращает новый id заметки.
 * No-op, если она уже там или если источника нет.
 */
export async function moveNote(
  id: string,
  newFolder: string,
  destinationName?: string,
): Promise<string> {
  await ensureWorkspace();
  const oldPath = idToFilePath(id);
  if (!(await pathExists(oldPath))) return id;

  if (parentOf(id) === newFolder) return id;
  if (newFolder) await ensureDir(`${ROOT}/${newFolder}`);

  const basename = destinationName ?? basenameOf(id);
  const proposedId = newFolder ? `${newFolder}/${basename}` : basename;
  const finalPath = await uniqueDestination(idToFilePath(proposedId));
  const finalId = noteRelFromAbs(finalPath, ROOT);

  await relocateWithObsidianMetadata(id, finalId, false, async () => {
    try {
      await renameInAppData(oldPath, finalPath);
    } catch {
      await copyFile(oldPath, finalPath, {
        fromPathBaseDir: BaseDirectory.AppData,
        toPathBaseDir: BaseDirectory.AppData,
      });
      await remove(oldPath, APP_DATA);
    }
  });

  // Обновляем поле `id` во фронтматтере, чтобы будущие чтения совпадали с новым
  // местом. По возможности: если перезапись упадёт, файл всё равно перемещён и
  // опознаётся по своему пути на диске (metaFromRaw откатывается к id из пути).
  await rewriteNoteId(finalPath, finalId).catch((e) =>
    console.error("moveNote: id rewrite failed:", e),
  );
  return finalId;
}

/** Читает, правит ключи `id`/`updatedAt` и пишет файл обратно. */
async function rewriteNoteId(filePath: string, newId: string): Promise<void> {
  await loadObsidianState();
  if (obsidianState?.notes[newId]?.markdownSource) return;
  const raw = await readMarkdownSource(filePath);
  const { meta, body } = parseFrontmatter(raw);
  const patched: FrontmatterRecord = {
    ...meta,
    id: newId,
    updatedAt: Date.now(),
  };
  await atomicWriteTextFile(filePath, serializeFrontmatter(patched) + body);
}

/**
 * Перемещает папку под новую родительскую. Возвращает новый путь папки.
 * Отказывается двигать папку в саму себя или в кого-то из её потомков.
 */
export async function moveFolder(
  folderPath: string,
  newParent: string,
  destinationName?: string,
): Promise<string> {
  if (!folderPath) return folderPath;
  if (newParent === folderPath) return folderPath;
  if (newParent.startsWith(`${folderPath}/`)) return folderPath;
  if (parentOf(folderPath) === newParent) return folderPath;

  const src = `${ROOT}/${folderPath}`;
  if (!(await pathExists(src))) return folderPath;

  if (newParent) await ensureDir(`${ROOT}/${newParent}`);

  const basename = destinationName ?? basenameOf(folderPath);
  const proposed = newParent ? `${newParent}/${basename}` : basename;
  const proposedAbs = `${ROOT}/${proposed}`;
  const finalAbs = await uniqueDestination(proposedAbs);

  const finalFolder = folderRelFromAbs(finalAbs, ROOT);
  await relocateWithObsidianMetadata(folderPath, finalFolder, true, () => renameInAppData(src, finalAbs));
  return finalFolder;
}

/**
 * Переименовывает папку на месте (родитель тот же, меняется последний сегмент).
 * Возвращает новый путь папки. No-op, если имя не изменилось или источника нет.
 */
export async function renameFolder(
  folderPath: string,
  newName: string,
): Promise<string> {
  if (!folderPath) return folderPath;
  const safe = sanitizeFolderName(newName);
  if (!safe) throw new Error("Folder name is empty");

  const parent = parentOf(folderPath);
  const proposed = parent ? `${parent}/${safe}` : safe;
  if (proposed === folderPath) return folderPath; // не изменилось

  const src = `${ROOT}/${folderPath}`;
  if (!(await pathExists(src))) return folderPath;

  const proposedAbs = `${ROOT}/${proposed}`;
  // Переименование только регистра на регистронезависимой ФС (Windows/macOS):
  // цель "существует", потому что это И ЕСТЬ исходная папка. Пропускаем суффикс
  // коллизии и rename'им напрямую, иначе "Work" даёт "work" в виде "work-1a2b".
  const caseOnly = proposedAbs.toLowerCase() === src.toLowerCase();
  const finalAbs = caseOnly ? proposedAbs : await uniqueDestination(proposedAbs);

  const finalFolder = folderRelFromAbs(finalAbs, ROOT);
  await relocateWithObsidianMetadata(folderPath, finalFolder, true, () => renameInAppData(src, finalAbs));
  return finalFolder;
}

// ─── Публичное: корзина ─────────────────────────────────────────────────────────

/**
 * Перемещает заметку в `.trash/`, сохраняя её структуру папок внутри корзины.
 *
 * Возвращает путь перемещённого файла относительно корзины (без расширения
 * `.md` и без ведущего `.trash/`), чтобы вызывающие позже скормили его в
 * `restoreFromTrash()` / `deleteForever()`. Возвращает `""`, если источника не
 * было (по этому вызывающий ловит no-op).
 *
 * Подстраховывается через `uniqueDestination`: в редком случае, когда
 * `.trash/<id>.md` уже есть (ручная правка снаружи или цепочка
 * trash, restore, trash, как-то приведшая к конфликту имён), дописывает
 * случайный суффикс, а не молча перезаписывает прежнюю запись корзины:
 * `rename(2)` на POSIX ПЕРЕЗАПИСЫВАЕТ, Windows MoveFileEx с REPLACE_EXISTING
 * делает то же, и это была бы тихая потеря данных.
 */
export async function trashNote(id: string): Promise<string> {
  const src = idToFilePath(id);
  if (!(await pathExists(src))) return "";
  const proposedDst = trashFilePath(id);
  await ensureDir(parentOf(proposedDst));
  const finalDst = await uniqueDestination(proposedDst);
  const trashedId = noteRelFromAbs(finalDst, TRASH);
  await relocateWithObsidianMetadata(id, `.trash/${trashedId}`, false, () => renameInAppData(src, finalDst));
  // ".trash/folder/foo.md" даёт "folder/foo"
  return trashedId;
}

/**
 * Перемещает целую папку (со всем содержимым) в `.trash/`, сохраняя пути.
 *
 * Возвращает путь папки в корзине относительно неё (без ведущего `.trash/`).
 * Возвращает `""`, если источника не было. Та же подстраховка через
 * `uniqueDestination`, что и в `trashNote`.
 */
export async function trashFolder(folderPath: string): Promise<string> {
  if (!folderPath) return "";
  const src = `${ROOT}/${folderPath}`;
  if (!(await pathExists(src))) return "";

  await ensureDir(TRASH);
  const dst = `${TRASH}/${folderPath}`;
  const dstParent = parentOf(dst);
  if (dstParent && dstParent !== TRASH) await ensureDir(dstParent);

  const finalDst = await uniqueDestination(dst);
  const trashedFolder = folderRelFromAbs(finalDst, TRASH);
  await relocateWithObsidianMetadata(folderPath, `.trash/${trashedFolder}`, true, () => renameInAppData(src, finalDst));
  return trashedFolder;
}

/**
 * Восстанавливает файл или папку из корзины. Возвращает тип того, что
 * восстановили, и реальный путь, куда оно легло внутри `notes/` (может
 * отличаться от исходного, если из-за коллизии имён пришлось добавить суффикс).
 *
 * `trashPath` должен совпадать с тем, что вернули `trashNote` / `trashFolder`,
 * то есть включать всю иерархию папок (например "work/foo"), а не просто имя.
 */
export async function restoreFromTrash(
  trashPath: string,
  kind?: "note" | "folder",
): Promise<RestoreResult> {
  const fileSrc = `${TRASH}/${trashPath}${NOTE_EXT}`;
  const dirSrc = `${TRASH}/${trashPath}`;

  if (kind !== "folder" && await pathExists(fileSrc)) {
    const proposed = `${ROOT}/${trashPath}${NOTE_EXT}`;
    await ensureDir(parentOf(proposed));
    const finalDst = await uniqueRestoreDestination(proposed, NOTE_EXT);
    const restoredId = noteRelFromAbs(finalDst, ROOT);
    await relocateWithObsidianMetadata(`.trash/${trashPath}`, restoredId, false, () => renameInAppData(fileSrc, finalDst));
    return { kind: "file", path: restoredId };
  }

  if (kind !== "note" && await pathExists(dirSrc)) {
    const proposed = `${ROOT}/${trashPath}`;
    await ensureDir(parentOf(proposed) || ROOT);
    const finalDst = await uniqueRestoreDestination(proposed, "");
    const restoredFolder = folderRelFromAbs(finalDst, ROOT);
    await relocateWithObsidianMetadata(`.trash/${trashPath}`, restoredFolder, true, () => renameInAppData(dirSrc, finalDst));
    return { kind: "folder", path: restoredFolder };
  }

  return { kind: "missing", path: trashPath };
}

export async function deleteForever(trashPath: string, kind?: "note" | "folder"): Promise<void> {
  const filePath = `${TRASH}/${trashPath}${NOTE_EXT}`;
  if (kind !== "folder" && await pathExists(filePath)) {
    await remove(filePath, APP_DATA);
    await forgetObsidianMetadata(`.trash/${trashPath}`);
    return;
  }
  const dirPath = `${TRASH}/${trashPath}`;
  if (kind !== "note" && await pathExists(dirPath)) {
    await remove(dirPath, { ...APP_DATA, recursive: true });
    await forgetObsidianMetadata(`.trash/${trashPath}`, true);
  }
}

export async function emptyTrash(): Promise<void> {
  if (!(await pathExists(TRASH))) return;
  await remove(TRASH, { ...APP_DATA, recursive: true });
  await ensureDir(TRASH);
  await forgetObsidianMetadata(".trash", true);
}

// ─── Папки ───────────────────────────────────────────────────────────────

export async function createFolder(
  parentFolder: string,
  name: string,
): Promise<string> {
  const safe = sanitizeFolderName(name);
  if (!safe) throw new Error("Folder name is empty");
  const relPath = parentFolder ? `${parentFolder}/${safe}` : safe;
  await mkdir(`${ROOT}/${relPath}`, { ...APP_DATA, recursive: true });
  return relPath;
}

/**
 * Отправляет целую папку в корзину, сохраняя её дерево, чтобы можно было
 * восстановить целиком. Сейчас это тонкий алиас над `trashFolder`: пробрасывает
 * его возврат, чтобы вызывающие поймали реальный путь в корзине (при коллизии
 * может отличаться от `folder`).
 */
export async function deleteFolder(folder: string): Promise<string> {
  if (!folder) return "";
  return trashFolder(folder);
}

/**
 * Насовсем удаляет папку и всё в ней, минуя корзину. Только для отладочных
 * инструментов с тестовыми данными, обычные удаления идут через `deleteFolder`/корзину.
 */
export async function purgeFolder(folder: string): Promise<void> {
  if (!folder) return;
  await ensureWorkspace();
  const dir = `${ROOT}/${folder}`;
  if (await pathExists(dir)) {
    await remove(dir, { ...APP_DATA, recursive: true });
  }
}

const FOLDER_META = `${ROOT}/.folder-meta.json`;

/**
 * UI-мета по папкам (сейчас только цвет), по ключу пути папки. Держим в ОДНОМ
 * JSON внутри воркспейса, чтобы было портабельно (едет вместе с папкой notes) и
 * читалось/писалось одним дешёвым заходом. Это дотфайл, так что обход дерева
 * (skipDotted) никогда не показывает его как папку.
 */
export async function readFolderColors(): Promise<Record<string, string>> {
  await ensureWorkspace();
  if (!(await pathExists(FOLDER_META))) return {};
  try {
    const parsed: unknown = JSON.parse(
      await readTextFile(FOLDER_META, APP_DATA),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [path, color] of Object.entries(parsed)) {
      if (typeof color === "string") out[path] = color;
    }
    return out;
  } catch (e) {
    console.error("readFolderColors failed:", e);
    return {};
  }
}

export async function writeFolderColors(
  map: Record<string, string>,
): Promise<void> {
  await ensureWorkspace();
  await atomicWriteTextFile(FOLDER_META, JSON.stringify(map, null, 2));
}

const SETTINGS_FILE = `${ROOT}/.settings.json`;

/**
 * Глобальные настройки приложения (акцентный цвет, горячая клавиша захвата,
 * поведение при старте), хранятся одним JSON-дотфайлом внутри воркспейса:
 * портабельно вместе с папкой notes и невидимо для обхода дерева (skipDotted).
 * Битые или отсутствующие поля откатываются к дефолтам через `coerceSettings`,
 * так что правленый руками или старый файл не роняет приложение.
 */
export async function readSettings(): Promise<AppSettings> {
  await ensureWorkspace();
  if (!(await pathExists(SETTINGS_FILE))) return { ...DEFAULT_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(
      await readTextFile(SETTINGS_FILE, APP_DATA),
    );
    return coerceSettings(parsed);
  } catch (e) {
    console.error("readSettings failed:", e);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await ensureWorkspace();
  await atomicWriteTextFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ─── Задачи календаря ──────────────────────────────────────────────────────────

const TASKS_FILE = `${ROOT}/.tasks.json`;

/**
 * Созданные юзером задачи календаря, хранятся одним JSON-дотфайлом внутри
 * воркспейса: портабельно вместе с папкой notes и невидимо для обхода дерева
 * (skipDotted). Битые строки выкидывает `coerceTasks`, так что правленый руками
 * или старый файл не роняет приложение.
 */
export async function readTasks(): Promise<Task[]> {
  await ensureWorkspace();
  if (!(await pathExists(TASKS_FILE))) return [];
  try {
    return coerceTasks(JSON.parse(await readTextFile(TASKS_FILE, APP_DATA)));
  } catch (e) {
    console.error("readTasks failed:", e);
    return [];
  }
}

export async function writeTasks(tasks: Task[]): Promise<void> {
  await ensureWorkspace();
  await atomicWriteTextFile(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// ─── Ассеты (обложки / картинки) ──────────────────────────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function assetUrl(name: string): Promise<string> {
  const dir = await getAppDataDir();
  return convertFileSrc(joinAbsolute(dir, ASSETS, name));
}

/**
 * Импортирует сырые байты картинки (например, из drag-and-drop или вставки в
 * редактор) в `notes/.assets/`, дедуплицируя по SHA-256. Возвращает имя ассета
 * и готовый для `convertFileSrc` URL, который редактор может встроить.
 *
 * Идемпотентно: два конкурентных импорта одной картинки дают одно имя файла и
 * либо пишут, либо пропускают с идентичным содержимым.
 */
export async function importAssetBytes(
  bytes: Uint8Array,
  ext: string,
): Promise<{ name: string; url: string }> {
  await ensureWorkspace();
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || DEFAULT_ASSET_EXT;
  const hash = await sha256Hex(bytes);
  const name = `${hash}.${safeExt}`;
  const rel = `${ASSETS}/${name}`;
  if (!(await pathExists(rel))) {
    await writeFile(rel, bytes, APP_DATA);
  }
  return { name, url: await assetUrl(name) };
}

/**
 * Импортирует внешнюю картинку в `notes/.assets/`, дедуплицируя по SHA-256.
 * Возвращает токен обложки `file:<assetName>` для хранения во фронтматтере.
 *
 * Замечание по реализации: выбранный в диалоге путь-источник лежит вне нашего
 * fs:scope, так что напрямую `readFile` его нельзя. Сначала складываем через
 * `copyFile` в .assets/ (Tauri разрешает копировать из пути ОС в путь в скоупе),
 * потом хэшируем и либо rename'им, либо удаляем temp-файл. При любой ошибке
 * temp-файл сносим, чтобы не намусорить в `.assets/`.
 */
export async function importCoverFile(
  absoluteSourcePath: string,
): Promise<string> {
  await ensureWorkspace();
  const ext = extOf(absoluteSourcePath, DEFAULT_IMG_EXT);

  const tmpName = `${TMP_PREFIX}${Date.now()}-${randomSuffix(COLLISION_SUFFIX_LEN)}.${ext}`;
  const tmpRel = `${ASSETS}/${tmpName}`;

  try {
    await copyFile(absoluteSourcePath, tmpRel, {
      toPathBaseDir: BaseDirectory.AppData,
    });
    const bytes = await readFile(tmpRel, APP_DATA);
    const hash = await sha256Hex(bytes);
    const finalName = `${hash}.${ext}`;
    const finalRel = `${ASSETS}/${finalName}`;

    if (await pathExists(finalRel)) {
      // Уже в хранилище, сносим temp.
      await safeRemove(tmpRel);
    } else {
      await renameInAppData(tmpRel, finalRel);
    }
    return `${COVER_PREFIX.file}${finalName}`;
  } catch (e) {
    // Следим, чтобы при ошибках не остался лежать staging temp-файл.
    await safeRemove(tmpRel);
    throw e;
  }
}

async function safeRemove(path: string): Promise<void> {
  try {
    if (await pathExists(path)) await remove(path, APP_DATA);
  } catch (e) {
    console.error("safeRemove failed:", path, e);
  }
}

// ─── Ассеты: учёт использования ────────────────────────────────────────────────
//
// Ассет считается "используемым", если выполнено ЛЮБОЕ из:
//   1. Это обложка заметки (фронтматтер `cover: file:<assetName>`).
//   2. Его имя встречается в теле живой заметки (markdown-картинка `![](...)`,
//      JSON блока-картинки BlockNote, галерея `items[].url`, fileCard
//      `assetUrl`/`assetName` и т.п.: любой путь ссылки содержит буквальное имя
//      файла ассета как подстроку).
//   3. Его имя встречается в заметке в КОРЗИНЕ (чтобы восстановление не ломалось).
//   4. Его имя встречается в снимке ВЕРСИИ (чтобы откат не ломался).
//
// Детект не зависит от редактора: имена ассетов это SHA-256 hex плюс расширение
// (их делает `importAssetBytes`), высокая энтропия, так что скан сырого текста
// .md по известному набору ассетов на диске даёт ноль ложных срабатываний и
// работает независимо от того, какой редактор и какую форму JSON использовал.
// До этого скана `listAssets` проверял ТОЛЬКО поле cover, и каждая картинка,
// встроенная в тело заметки, показывалась как "Не используется", а UI удаления
// предлагал её снести, прямой путь к потере данных. (По репорту юзера: все
// картинки, прикреплённые в блоках редактора, выглядели неиспользуемыми.)

type NoteRef = {
  id: string;
  title: string;
  folder: string;
  cover: string | null;
};

/** SHA-256 плюс расширение, например `e4ff434687abc...3a1.png`. Совпадает с
 *  именем файла, которое делает `importAssetBytes` (хэширует контент и чистит
 *  расширение). Достаёт кандидатов-токены из сырого текста заметки за O(L) на файл. */
const ASSET_NAME_RE = /[0-9a-f]{64}\.[a-z0-9]+/gi;

/** true для любого имени ассета по паттерну SHA-256 (заякоренный неглобальный
 *  близнец регэкспа выше). Нужен, чтобы знать, какие имена уже покрыты быстрым
 *  путём через регэксп, и не сканировать их повторно через `includes()`. */
const ASSET_NAME_ANCHORED_RE = /^[0-9a-f]{64}\.[a-z0-9]+$/i;

/** Достаёт все токены SHA-формы из `text`. НЕ фильтрует по известному набору
 *  ассетов: фильтрацию делает вызывающий на каждый вызов `listAssets`, так что
 *  результат этой функции можно кэшировать по файлу (по ключу mtime+size)
 *  независимо от того, какие ассеты есть прямо сейчас. */
function extractRawAssetTokens(text: string): string[] {
  if (!text) return [];
  const m = text.match(ASSET_NAME_RE);
  if (!m) return [];
  // В нижний регистр и дедуп, чтобы кэшируемый массив оставался маленьким
  // (заметка, встроившая одну картинку 10 раз, хранит один токен, а не 10).
  return Array.from(new Set(m.map((s) => s.toLowerCase())));
}

// ─── Кэш ссылок на ассеты (mtime+size, на диске) ────────────────────────────
//
// Сканировать каждый .md под `notes/` при каждом открытии экрана картинок
// нормально на маленьком воркспейсе, но превращается в долгий ступор, когда
// набивается `.versions/` (каждая заметка держит до 50 неизменных снимков,
// легко 1000+ файлов и десятки МБ перечитывать). Кэшируем SHA-токены, добытые
// из каждого файла, по ключу (mtime, size). Кэш и в процессе, и на диске, так
// что и ПЕРВОЕ открытие после запуска тоже быстрое.
//
// Два важных быстрых пути:
//   - файлы `.versions/` неизменны: раз закэшировали, для них пропускаем даже
//     IPC на `stat()`.
//   - файлы с совпавшими (mtime, size) пропускают чтение и регэксп.
//
// Корректность:
//   - запись кэша, чей файл удалён, вычищается в конце каждого скана.
//   - кэшированные токены это СЫРЫЕ совпадения SHA, без фильтрации. Текущий
//     набор `knownNames` фильтрует их на каждый вызов, так что
//     переименование/добавление/удаление ассетов не инвалидирует кэш.

type RefsCacheEntry = { mtime: number; size: number; refs: string[] };
const refsCache = new Map<string, RefsCacheEntry>();
let refsCacheLoaded = false;
let refsCacheLoadPromise: Promise<void> | null = null;
let refsCacheDirty = false;

const CACHE_DIR = `${ROOT}/.cache`;
const REFS_CACHE_FILE = `${CACHE_DIR}/asset-refs.json`;
const REFS_CACHE_VERSION = 1;

/** Синглтон через promise в полёте (как `getAppDataDir`). Раньше флаг
 *  `refsCacheLoaded` ставился ДО await, и второй конкурентный вызов видел
 *  "loaded", пока map был ещё пуст, и обходил всё вхолодную: удвоенный IO и
 *  гонка с наполнением первого вызова. Теперь оба ждут один promise, флаг
 *  переключается только после наполнения. */
function loadRefsCache(): Promise<void> {
  if (refsCacheLoaded) return Promise.resolve();
  if (refsCacheLoadPromise) return refsCacheLoadPromise;
  refsCacheLoadPromise = (async () => {
    try {
      if (!(await pathExists(REFS_CACHE_FILE))) return;
      const raw = await readTextFile(REFS_CACHE_FILE, APP_DATA);
      const data = JSON.parse(raw) as {
        v?: number;
        entries?: Record<string, RefsCacheEntry>;
      };
      if (data.v !== REFS_CACHE_VERSION || !data.entries) return;
      for (const [path, entry] of Object.entries(data.entries)) {
        if (
          entry &&
          typeof entry.mtime === "number" &&
          typeof entry.size === "number" &&
          Array.isArray(entry.refs)
        ) {
          refsCache.set(path, entry);
        }
      }
    } catch (e) {
      console.error("loadRefsCache failed:", e);
    } finally {
      // Переключаем "loaded" только после наполнения (успех ИЛИ ошибка). Битый
      // или отсутствующий файл оставляет кэш пустым, но помечает загрузку
      // сделанной, чтобы не повторять чтение на каждый вызов.
      refsCacheLoaded = true;
      refsCacheLoadPromise = null;
    }
  })();
  return refsCacheLoadPromise;
}

/** Проверка двух массивов ссылок на равенство как множеств (оба уже
 *  дедуплицированы и в нижнем регистре после `extractRawAssetTokens`, так что
 *  хватает длины плюс includes). Нужна, чтобы не метить кэш грязным, когда
 *  токены на диске на самом деле не менялись. */
function sameRefs(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!b.includes(a[i])) return false;
  }
  return true;
}

/** Сериализует флаши, чтобы два конкурентных вызова `listAssets()` (например,
 *  монтирование ImagesView внахлёст с рефрешем от удаления) не писали `.tmp`
 *  общего asset-refs.json одновременно и не дрались за rename. Тот же приём,
 *  что и `metaCacheFlushChain` для кэша меты заметок. */
let refsCacheFlushChain: Promise<void> = Promise.resolve();

function flushRefsCache(): Promise<void> {
  const next = refsCacheFlushChain.then(async () => {
    if (!refsCacheDirty) return;
    refsCacheDirty = false;
    try {
      await ensureDir(CACHE_DIR);
      const entries: Record<string, RefsCacheEntry> = {};
      for (const [k, v] of refsCache) entries[k] = v;
      await atomicWriteTextFile(
        REFS_CACHE_FILE,
        JSON.stringify({ v: REFS_CACHE_VERSION, entries }),
      );
    } catch (e) {
      console.error("flushRefsCache failed:", e);
      refsCacheDirty = true; // повторим на следующем скане
    }
  });
  // Держим цепочку живой, даже если это звено отвалилось, чтобы следующие флаши
  // всё равно прошли.
  refsCacheFlushChain = next.catch(() => undefined);
  return next;
}

/**
 * Возвращает по одной записи на живую заметку, только то, что нужно экрану
 * ассетов. Сделано переиспользованием `listTree`, чтобы не держать два
 * параллельных обходчика над одной ФС.
 */
async function collectAllNoteRefs(): Promise<NoteRef[]> {
  const flat = flattenNotes(await listTree());
  return flat.map(({ id, title, folder, cover }) => ({
    id,
    title,
    folder,
    cover,
  }));
}

/** Рекурсивно собирает каждый `.md` под `basePath` (пропуская `.assets/`, там
 *  лежат сами бинарники). Возвращаемые пути относительны корня AppData, готовы
 *  к скармливанию в `readTextFile`. Возвращает `true`, если все директории под
 *  `basePath` успешно перечислены, и `false`, если какой-то readDir / pathExists
 *  бросил (временные замки антивируса, гонка ENOENT, флака прав). listAssets по
 *  этому решает, безопасен ли шаг чистки кэша: чистка после частичного обхода
 *  молча стёрла бы валидные записи refsCache для неперечисленных файлов и
 *  заставила бы их полностью перечитать в следующий раз. */
async function collectMarkdownPaths(
  basePath: string,
  out: string[],
): Promise<boolean> {
  if (!(await pathExists(basePath))) return true;
  let entries;
  try {
    entries = await readDir(basePath, APP_DATA);
  } catch (e) {
    console.error("collectMarkdownPaths failed:", basePath, e);
    return false; // частично, вызывающий обязан пропустить чистку
  }
  let complete = true;
  for (const entry of entries) {
    if (!entry.name) continue;
    // В `.assets/` не заходим никогда: там бинарники (картинки), а не markdown
    // для скана. `.templates/` тоже пропускаем: ссылки на картинки внутри
    // шаблона НЕ должны считаться "используются" реальной заметкой (иначе
    // удаление шаблона тихо осиротит чипы использования его ассетов, а сами
    // ассеты останутся живыми, засоряя набор "используемых" на экране картинок).
    // Прочие дотдиры (.trash, .versions) обходим.
    if (entry.name === ".assets" || entry.name === ".templates") continue;
    const child = `${basePath}/${entry.name}`;
    if (entry.isDirectory) {
      const childComplete = await collectMarkdownPaths(child, out);
      if (!childComplete) complete = false;
    } else if (entry.isFile && entry.name.endsWith(NOTE_EXT)) {
      out.push(child);
    }
  }
  return complete;
}

/** Путь заметки даёт её происхождение (id живой заметки / корзина / версия), а
 *  для живых заметок ещё и поиск в мете, собранной `collectAllNoteRefs`. */
function classifyNotePath(
  path: string,
  liveById: Map<string, NoteRef>,
): NoteRef | "trash" | "version" | null {
  // notes/.trash/<...>.md
  if (path.startsWith(`${TRASH}/`)) return "trash";
  // notes/.versions/<noteId>/<ts>.md
  if (path.startsWith(`${VERSIONS}/`)) return "version";
  // notes/<...>.md: срезаем префикс и .md, восстанавливая id
  if (path.startsWith(`${ROOT}/`) && path.endsWith(NOTE_EXT)) {
    const id = path.slice(ROOT.length + 1, -NOTE_EXT.length);
    const live = liveById.get(id);
    if (live) return live;
  }
  return null;
}

/** Синглтон в полёте: mount-эффект ImagesView и рефреш от удаления могут
 *  гоняться, каждый запускает полный обход и flushRefsCache. Общий promise в
 *  полёте схлопывает их в один скан и одну запись на диск. */
let listAssetsInFlight: Promise<AssetInfo[]> | null = null;

export function listAssets(): Promise<AssetInfo[]> {
  if (listAssetsInFlight) return listAssetsInFlight;
  listAssetsInFlight = (async () => {
    try {
      return await listAssetsImpl();
    } finally {
      listAssetsInFlight = null;
    }
  })();
  return listAssetsInFlight;
}

async function listAssetsImpl(): Promise<AssetInfo[]> {
  await ensureWorkspace();
  if (!(await pathExists(ASSETS))) return [];

  const entries = await readDir(ASSETS, APP_DATA);

  // Набор реальных имён ассетов на диске: каждая "найденная" ссылка должна
  // совпасть с именем отсюда, иначе отфильтровывается (отсекаем случайные
  // SHA-подобные токены в тексте и протухшие ссылки на уже удалённые ассеты).
  const candidates = entries.filter(
    (e) => e.isFile && e.name && !e.name.startsWith(TMP_PREFIX),
  );
  // With no assets there is nothing to protect; avoid traversing every note
  // and version snapshot just to return an empty cover-picker collection.
  if (!candidates.length) return [];
  const [refs, dir] = await Promise.all([collectAllNoteRefs(), getAppDataDir()]);
  const knownNames = new Set(candidates.map((e) => e.name!));

  const usageByAsset = new Map<string, NoteRef[]>();
  const pushUsage = (assetName: string, ref: NoteRef): void => {
    const list = usageByAsset.get(assetName);
    if (list) {
      // Дедуп по id, чтобы несколько ссылок на один ассет внутри одной заметки
      // (например, два слота галереи) схлопнулись в один чип использования.
      if (list.some((r) => r.id === ref.id)) return;
      list.push(ref);
    } else {
      usageByAsset.set(assetName, [ref]);
    }
  };

  // 1) Ссылки-обложки, сохранено из прежнего поведения.
  for (const ref of refs) {
    if (!ref.cover?.startsWith(COVER_PREFIX.file)) continue;
    const name = ref.cover.slice(COVER_PREFIX.file.length);
    if (knownNames.has(name)) pushUsage(name, ref);
  }

  // 2) Ссылки в теле по всем .md под воркспейсом (живые заметки, корзина и
  //    снимки версий: все три должны держать свои ассеты живыми).
  const liveById = new Map<string, NoteRef>(refs.map((r) => [r.id, r]));
  // Синтетические "защищённые" записи: корзина и версии получают по ОДНОМУ чипу
  // на ассет (а не по одному на файл снимка), чтобы список чипов оставался
  // читаемым. Id фиктивные, клик по ним это no-op, смысл в том, чтобы кнопка
  // удаления не предлагала снести файл, на который есть ссылка.
  const TRASH_REF: NoteRef = {
    id: "__trash__",
    title: "В корзине",
    folder: "",
    cover: null,
  };
  const VERSION_REF: NoteRef = {
    id: "__versions__",
    title: "История версий",
    folder: "",
    cover: null,
  };

  const allMdPaths: string[] = [];
  const walkComplete = await collectMarkdownPaths(ROOT, allMdPaths);

  // Загружаем сохранённый кэш ссылок один раз за процесс. Дальнейшие сканы берут
  // копию в памяти, файл на диске переписываем, только если что-то изменилось.
  await loadRefsCache();

  // Старые ассеты (положенные руками файлы с не-SHA-именами) не покрыты кэшем на
  // регэкспе, для них всё ещё приходится заглядывать в сырой текст. В нормальном
  // воркспейсе таких файлов ноль, так что горячий путь это только регэксп плюс кэш.
  const legacyKnown: string[] = [];
  for (const name of knownNames) {
    if (!ASSET_NAME_ANCHORED_RE.test(name)) legacyKnown.push(name);
  }
  const hasLegacy = legacyKnown.length > 0;

  await Promise.all(
    allMdPaths.map((path) =>
      fileReadSemaphore.run(async () => {
        // Снимки `.versions/` после создания не меняются, так что
        // кэшированная запись авторитетна навсегда, IPC на stat() пропускаем целиком.
        const isImmutable = path.startsWith(`${VERSIONS}/`);
        const cached = refsCache.get(path);

        let tokens: string[] | null = null;
        let raw: string | null = null;

        if (isImmutable && cached && !hasLegacy) {
          tokens = cached.refs;
        } else {
          // Проверяем кэш дешёвым stat, на промахе откатываемся к чтению.
          let mtime = 0;
          let size = 0;
          let cacheHit = false;
          try {
            const st = await stat(path, APP_DATA);
            mtime = st.mtime ? new Date(st.mtime).getTime() : 0;
            size = Number(st.size ?? 0);
            cacheHit =
              !!cached &&
              mtime !== 0 &&
              cached.mtime === mtime &&
              cached.size === size;
          } catch (e) {
            if (isMissingPathError(e)) return; // исчез посреди скана
            console.error("listAssets: stat failed:", path, e);
          }

          if (cacheHit && !hasLegacy) {
            tokens = cached!.refs;
          } else {
            try {
              raw = await readTextFile(path, APP_DATA);
            } catch (e) {
              if (!isMissingPathError(e)) {
                console.error("listAssets: read failed:", path, e);
              }
              return;
            }
            tokens = extractRawAssetTokens(raw);
            // Обновляем кэш на промахе (или при первой встрече). Пишем только
            // когда реально есть валидный mtime: записи без него всё равно
            // никогда не попадут в кэш, только раздуют файл.
            if (mtime !== 0) {
              const prev = cached;
              if (
                !prev ||
                prev.mtime !== mtime ||
                prev.size !== size ||
                !sameRefs(prev.refs, tokens)
              ) {
                refsCache.set(path, { mtime, size, refs: tokens });
                refsCacheDirty = true;
              }
            }
          }
        }

        // Сводим к ассетам, реально лежащим на диске прямо сейчас.
        const fileRefs = new Set<string>();
        for (const t of tokens) {
          if (knownNames.has(t)) fileRefs.add(t);
        }
        // Откат для старых имён, только когда они есть И сырой текст у нас на
        // руках (то есть мы только что прочитали его по одной из причин выше).
        // Если не читали, попадание в кэш покрыло SHA-часть, а старые имена
        // пролетают мимо. Это приемлемо: старые файлы редки и переcканируются
        // на следующей не-версионной правке.
        if (hasLegacy && raw) {
          for (const legacy of legacyKnown) {
            if (raw.includes(legacy)) fileRefs.add(legacy);
          }
        }
        if (fileRefs.size === 0) return;

        const origin = classifyNotePath(path, liveById);
        if (!origin) return;
        const ref =
          origin === "trash"
            ? TRASH_REF
            : origin === "version"
              ? VERSION_REF
              : origin;
        for (const assetName of fileRefs) pushUsage(assetName, ref);
      }),
    ),
  );

  // Чистим записи кэша для файлов, которых больше нет (в корзине,
  // восстановлены, снимок версии подрезан и т.п.). Держит файл кэша
  // ограниченным. ПРОПУСКАЕМ на частичных обходах: иначе временный сбой readDir
  // на одном подкаталоге стёр бы его валидные записи refsCache и заставил
  // полностью перечитать те файлы на следующем скане, ровно наоборот тому, ради
  // чего кэш существует.
  if (walkComplete) {
    const allPathsSet = new Set(allMdPaths);
    for (const key of refsCache.keys()) {
      if (!allPathsSet.has(key)) {
        refsCache.delete(key);
        refsCacheDirty = true;
      }
    }
  }
  // Пишем по принципу fire-and-forget, чтобы не заставлять юзера ждать. Если
  // следующий скан придёт до завершения, ничего страшного, это всего лишь оптимизация.
  void flushRefsCache();

  // Параллельный stat по каждому ассету: последовательные await'ы заметно
  // тормозили на библиотеках с 50+ картинками.
  const assets = await Promise.all(
    candidates.map(async (entry): Promise<AssetInfo> => {
      const name = entry.name!;
      let sizeBytes = 0;
      try {
        const s = await stat(`${ASSETS}/${name}`, APP_DATA);
        sizeBytes = Number(s.size ?? 0);
      } catch (e) {
        console.error("listAssets: stat failed:", name, e);
      }
      return {
        name,
        url: convertFileSrc(joinAbsolute(dir, ASSETS, name)),
        sizeBytes,
        usedBy: usageByAsset.get(name) ?? [],
      };
    }),
  );

  assets.sort((a, b) => {
    if (a.usedBy.length !== b.usedBy.length)
      return b.usedBy.length - a.usedBy.length;
    return a.name.localeCompare(b.name);
  });
  return assets;
}

export async function deleteAsset(name: string): Promise<void> {
  await safeRemove(`${ASSETS}/${name}`);
}

// Image library is separate from listAssets: editor/cover pickers still see
// only managed assets, while the library also sees lossless vault attachments.
type ImageRefCacheEntry = { mtime: number; size: number; references: ImageReferences };
const IMAGE_REFS_CACHE = `${CACHE_DIR}/image-references-v1.json`;
let imageRefsCache: Map<string, ImageRefCacheEntry> | null = null;
let imageScanInFlight: Promise<ImageLibrary> | null = null;
let imageRefsFlush: Promise<void> = Promise.resolve();
const imageDirectorySlots = createSemaphore(4);

export function listImageLibrary(): Promise<ImageLibrary> {
  if (imageScanInFlight) return imageScanInFlight;
  imageScanInFlight = scanImageLibrary().finally(() => { imageScanInFlight = null; });
  return imageScanInFlight;
}

async function scanImageLibrary(): Promise<ImageLibrary> {
  await ensureWorkspace();
  let complete = true;
  const imagePaths: string[] = []; const markdownPaths: string[] = [];
  const walk = async (path: string, protectedArea = false): Promise<void> => {
    let entries;
    try { entries = await imageDirectorySlots.run(() => readDir(path, APP_DATA)); }
    catch (error) { complete = false; console.error("image library directory:", path, error); return; }
    await Promise.all(entries.map(async (entry) => {
      if (!entry.name || entry.isSymlink || entry.name.startsWith(TMP_PREFIX)) return;
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name.startsWith(".") && ![".assets", ".trash", ".versions"].includes(entry.name)) return;
        await walk(child, protectedArea || entry.name === ".trash" || entry.name === ".versions");
      } else if (entry.isFile) {
        if (entry.name.endsWith(NOTE_EXT)) markdownPaths.push(child);
        else if (!protectedArea && imageFormat(entry.name)) imagePaths.push(child.slice(ROOT.length + 1));
      }
    }));
  };
  const [dir, inventory] = await Promise.all([getAppDataDir(), readNativeImageInventory()]);
  const metadata = new Map<string, InventoryFile>();
  let liveNotes: NoteMeta[];
  if (inventory) {
    complete = inventory.complete;
    for (const file of inventory.images) { imagePaths.push(file.path); metadata.set(`${ROOT}/${file.path}`, file); }
    for (const file of inventory.notes) { markdownPaths.push(`${ROOT}/${file.path}`); metadata.set(`${ROOT}/${file.path}`, file); }
    if (!imagePaths.length) return { images: [], complete };
    await Promise.all([loadMetaCache(), loadObsidianState()]);
    const liveFiles = inventory.notes.filter((file) => !file.path.split("/").some((part) => part.startsWith(".")));
    const seen = new Set(liveFiles.map((file) => `${ROOT}/${file.path}`));
    const metas = await Promise.all(liveFiles.map((file) => fileReadSemaphore.run(async () => {
      const filePath = `${ROOT}/${file.path}`;
      const id = file.path.slice(0, -NOTE_EXT.length);
      const cached = metaCache.get(filePath);
      if (cached && file.mtime && cached.mtime === file.mtime && cached.size === file.size) return applyObsidianMetadata(cached.meta, id);
      const folder = id.slice(0, Math.max(0, id.lastIndexOf("/")));
      return readNoteMeta(filePath, id, folder, true);
    })));
    liveNotes = metas.filter((note): note is NoteMeta => note !== null);
    if (complete) for (const key of metaCache.keys()) if (!isTrashPath(key) && !seen.has(key)) { metaCache.delete(key); metaCacheDirty = true; }
    void flushMetaCache();
  } else {
    const [tree] = await Promise.all([listTree(), walk(ROOT)]);
    liveNotes = flattenNotes(tree);
  }
  if (!imagePaths.length) return { images: [], complete };
  const notes = new Map(liveNotes.map((note) => [note.id, note]));
  const files = createImageFilesIndex(imagePaths);
  const usage = new Map<string, Map<string, { id: string; title: string; folder: string }>>();
  const addUsage = (path: string, ref: { id: string; title: string; folder: string }) => {
    const existing = usage.get(path) ?? new Map(); existing.set(ref.id, ref); usage.set(path, existing);
  };
  if (!imageRefsCache) {
    imageRefsCache = new Map();
    try {
      if (await pathExists(IMAGE_REFS_CACHE)) {
        const data = JSON.parse(await readTextFile(IMAGE_REFS_CACHE, APP_DATA));
        if (data.v === 1 && data.entries) for (const [path, entry] of Object.entries(data.entries)) {
          const value = entry as ImageRefCacheEntry;
          if (Number.isFinite(value?.mtime) && Number.isFinite(value.size) && Array.isArray(value.references?.managed) && value.references.managed.every((ref) => typeof ref === "string") && Array.isArray(value.references.links) && value.references.links.every((ref) => typeof ref.value === "string" && typeof ref.relative === "boolean")) imageRefsCache.set(path, value);
        }
      }
    } catch (error) { console.error("image library reference cache:", error); }
  }
  let dirty = false;
  for (const note of notes.values()) {
    if (note.cover?.startsWith(COVER_PREFIX.file)) {
      const path = `.assets/${note.cover.slice(COVER_PREFIX.file.length)}`;
      const target = files.paths.get(path.normalize("NFC").toLowerCase());
      if (target) addUsage(target, note);
    }
  }
  await Promise.all(markdownPaths.map((path) => fileReadSemaphore.run(async () => {
    const cached = imageRefsCache!.get(path);
    let references: ImageReferences;
    try {
      if (path.startsWith(`${VERSIONS}/`) && cached) references = cached.references;
      else {
        const info = metadata.get(path) ?? await stat(path, APP_DATA);
        const mtime = info.mtime ? new Date(info.mtime).getTime() : 0;
        const size = Number(info.size ?? 0);
        if (mtime && cached?.mtime === mtime && cached.size === size) references = cached.references;
        else {
          references = extractImageReferences(await readTextFile(path, APP_DATA));
          if (mtime) { imageRefsCache!.set(path, { mtime, size, references }); dirty = true; }
        }
      }
    } catch (error) {
      if (!isMissingPathError(error)) { complete = false; console.error("image library note references:", path, error); }
      return;
    }
    const origin = classifyNotePath(path, notes);
    const relative = path.slice(ROOT.length + 1, -NOTE_EXT.length);
    const noteId = origin === "version" ? path.slice(VERSIONS.length + 1, path.lastIndexOf("/")) : relative;
    const ref = origin === "trash" ? { id: "__trash__", title: "В корзине", folder: "" }
      : origin === "version" ? { id: "__versions__", title: "История версий", folder: "" }
      : origin ?? { id: `__unindexed__:${relative}`, title: relative.slice(relative.lastIndexOf("/") + 1), folder: relative.slice(0, Math.max(0, relative.lastIndexOf("/"))) };
    for (const target of resolveImageReferences(references, noteId, files)) addUsage(target, ref);
  })));
  if (complete) {
    const active = new Set(markdownPaths);
    for (const path of imageRefsCache.keys()) if (!active.has(path)) { imageRefsCache.delete(path); dirty = true; }
  }
  if (dirty) {
    const entries = Object.fromEntries(imageRefsCache);
    imageRefsFlush = imageRefsFlush.catch(() => undefined).then(async () => {
      await ensureDir(CACHE_DIR);
      await atomicWriteTextFile(IMAGE_REFS_CACHE, JSON.stringify({ v: 1, entries }));
    }).catch((error) => console.error("image library cache write:", error));
  }
  const results = await Promise.all(imagePaths.map((id) => fileReadSemaphore.run(async (): Promise<LibraryImage | null> => {
    try {
      const info = metadata.get(`${ROOT}/${id}`) ?? await stat(`${ROOT}/${id}`, APP_DATA);
      const mtime = info.mtime ? new Date(info.mtime).getTime() : 0;
      const modifiedAt = Number.isFinite(mtime) ? mtime : 0;
      const sizeBytes = Number(info.size ?? 0);
      const usedBy = [...(usage.get(id)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id));
      return { id, name: id.slice(id.lastIndexOf("/") + 1), folder: id.slice(0, Math.max(0, id.lastIndexOf("/"))), url: convertFileSrc(joinAbsolute(dir, ROOT, id)) + `?v=${modifiedAt}-${sizeBytes}`, sizeBytes, modifiedAt, managed: id.startsWith(".assets/"), usedBy };
    } catch (error) {
      if (!isMissingPathError(error)) { complete = false; console.error("image library file metadata:", id, error); }
      return null;
    }
  })));
  return { images: results.filter((item): item is LibraryImage => item !== null).sort((a, b) => a.id.localeCompare(b.id)), complete };
}

export async function imageFilePath(id: string): Promise<string> {
  if (boundedVaultPath(id) !== id || !imageFormat(id)) throw new Error("Invalid image path");
  return joinAbsolute(await getAppDataDir(), ROOT, id);
}

/** Original vault attachments remain read-only. Revalidate managed references
 * immediately before deleting, including references in trash and versions. */
export async function deleteUnusedLibraryImages(ids: readonly string[]): Promise<void> {
  const [library, managed] = await Promise.all([listImageLibrary(), listAssets()]);
  if (!library.complete) throw new Error("Не удалось проверить все ссылки на изображения");
  const images = new Map(library.images.map((image) => [image.id, image]));
  const legacy = new Map(managed.map((asset) => [asset.name, asset]));
  for (const id of new Set(ids)) {
    const image = images.get(id);
    if (!image) continue;
    if (!image.managed || image.usedBy.length || legacy.get(image.name)?.usedBy.length || id !== `.assets/${image.name}`) throw new Error("Изображение используется или относится к исходному хранилищу");
    await remove(`${ROOT}/${id}`, APP_DATA);
  }
}

/**
 * Превращает токен `cover` (например `file:abc.png`) в готовый к рендеру URL
 * через asset-протокол Tauri. Возвращает null для токенов градиента, url и пустых.
 */
export async function resolveCoverImageUrl(
  cover: string | null,
): Promise<string | null> {
  if (!cover?.startsWith(COVER_PREFIX.file)) return null;
  return assetUrl(cover.slice(COVER_PREFIX.file.length));
}
