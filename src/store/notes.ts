import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  DAILY_TEMPLATE_ID,
  DEFAULT_DAILY_TEMPLATE,
  dailyNoteFolder,
  dailyNoteId,
  toISODate,
} from "../lib/daily";
import {
  applyAccent,
  DEFAULT_SETTINGS,
  type AppSettings,
} from "../lib/settings";
import { pluralRu } from "../lib/format";
import { t } from "../lib/i18n";
import { rebaseKeys } from "../lib/treeKeys";
import {
  findFolderByPath,
  findNotesByTitle,
  flattenNotes,
} from "../lib/treeUtils";
import {
  compareTreeNodes,
  createFolder as createFolderFs,
  deleteAsset as deleteAssetFs,
  deleteFolder as deleteFolderFs,
  deleteForever as deleteForeverFs,
  emptyTrash as emptyTrashFs,
  importCoverFile,
  listAssets,
  listTrashTree,
  listTree,
  moveFolder as moveFolderFs,
  moveNote as moveNoteFs,
  newNoteId,
  purgeFolder,
  readFolderColors,
  readNote,
  readNoteVersion,
  readSettings,
  renameFolder as renameFolderFs,
  snapshotNoteNow,
  restoreFromTrash,
  sanitizeFolderName,
  trashFolder as trashFolderFs,
  trashNote as trashNoteFs,
  writeFolderColors,
  writeNote,
  writeSettings,
  type AssetInfo,
  type Note,
  type NoteMeta,
  type TreeNode,
} from "../lib/storage";
import { useToastStore } from "./toasts";

// ─── Модель конкурентности ──────────────────────────────────────────────────
// -  selectNote использует монотонный токен `selectGen`, чтобы сбрасывать
//   устаревшие чтения с диска.
// -  moveEntry сериализует undo/redo через `_undoRedoBusy`, а колбэки ставят
//   `_undoing`, чтобы pushUndo не рекурсировал внутри replay.
// -  createNote / createFolder используют `_busyCreatingNote` /
//   `_busyCreatingFolder` для объединения быстрых двойных кликов
//   (зажатый Enter, Enter + клик снаружи).
// -  reselectIfActive / reselectIfUnderFolder патчат activeNote.id/folder
//   *синхронно*, так что saveNote никогда не пишет в устаревший путь
//   между сменой имени на диске и обновлением дерева.
// -  Деструктивные операции (trashNote, deleteFolder, batchTrashNotes)
//   убирают активную заметку ДО переименования на диске. Тогда любой
//   debounce saveNote, попавший в окно await, увидит `activeNote = null` и
//   выйдет, не реанимируя фантомный файл по уже пустому пути.
// -  createNote / createFolder сбрасывают creatingNoteIn / creatingFolderIn
//   только если папка совпадает, так что повторный клик "+ Заметка"
//   во время медленного первого создания не затирается.

// ─── Публичные типы ─────────────────────────────────────────────────────────

export type View =
  | "notes"
  | "graph"
  | "calendar"
  | "trash"
  | "images"
  | "files"
  | "tags"
  | "inbox"
  | "settings"
  | "overview";

export type SaveNotePatch = {
  title?: string;
  content?: string;
  icon?: string | null;
  cover?: string | null;
  favorite?: boolean;
  /** Оценка настроения 1-5 (для дневников), null сбрасывает. */
  mood?: number | null;
  /** Альтернативные заголовки (в стиле Obsidian). Передача `[]` или
   *  `undefined` очищает поле во фронтматтере. */
  aliases?: string[];
  /** Без потерь: JSON документа BlockNote + хэш markdown-контента, из которого
   *  он был сгенерирован. Записывается вместе с контентом при каждом сохранении. */
  blocknote?: string | null;
  bnHash?: number | null;
};

type UndoEntry = {
  /** Читаемое описание, например для тултипов. */
  label: string;
  redo: () => Promise<void>;
  undo: () => Promise<void>;
};

type StackKey = "_undoStack" | "_redoStack";

type State = {
  view: View;
  tree: TreeNode[];
  trashTree: TreeNode[];
  assets: AssetInfo[];
  /** false до первого завершения refreshAssets() (успех или ошибка).
   *  Позволяет ImagesView отличить "ещё грузится" от "загружено, пусто",
   *  чтобы показать скелетон вместо мелькания EmptyState при сканировании
   *  .md-файлов в холодном кэше. */
  assetsLoaded: boolean;
  /** Состояние индикатора сохранения в NoteHero. Управляется persistNote:
   *  `saving` пока идёт запись, `saved` примерно 2 секунды потом (с
   *  `lastSavedAt` для таймстемпа), `error` при ошибке записи (с
   *  `lastSaveError` для тултипа), `idle` всё остальное время. Состояние
   *  не привязано к конкретной заметке, смена сбрасывает в `idle`. */
  savingState: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
  lastSaveError: string | null;
  expandedFolders: Set<string>;
  activeId: string | null;
  activeNote: Note | null;
  /** Стек обратной навигации (id заметок). Работает стрелка "назад" в
   *  редакторе. Растёт только при переходе от заметки к заметке, сбрасывается
   *  при возврате в галерею. См. `selectNote` / `goBack` / `closeActiveNote`. */
  backStack: string[];
  creatingFolderIn: string | null;
  creatingNoteIn: string | null;
  currentFolder: string;
  currentTrashFolder: string;
  currentTag: string | null;
  /** Цвет папки (hex), ключ это путь. Загружается из метафайла воркспейса,
   *  перебазируется при переименовании/перемещении. Отсутствующий путь
   *  означает цвет по умолчанию. */
  folderColors: Record<string, string>;
  /** Глобальные настройки (акцент, шорткат захвата, поведение при старте).
   *  Загружаются из `notes/.settings.json` при запуске, см. `loadSettings`. */
  settings: AppSettings;
  /** Выбор при неоднозначном `[[wiki-link]]`: ставится когда кликнутая ссылка
   *  матчит больше одной заметки по заголовку. null = закрыто. */
  linkPicker: { title: string; matches: NoteMeta[] } | null;
  /** id заметки, для которой открыт модал истории версий, null = закрыто. */
  versionHistoryFor: string | null;
  /** Инкрементируется чтобы заставить редактор перезагрузить документ,
   *  даже если `activeId` не изменился (например, после восстановления
   *  версии в открытую заметку). */
  editorReloadNonce: number;
  /** Внутреннее: методы внутри undo/redo ставят это, чтобы pushUndo
   *  не рекурсировал при воспроизведении записи. */
  _undoing: boolean;
  /** Внутреннее: сериализует быстрые клики undo/redo, чтобы второй клик
   *  не украл запись пока первый ждёт. */
  _undoRedoBusy: boolean;
  /** Внутреннее: отсекает быстрые повторные клики "Создать заметку". */
  _busyCreatingNote: boolean;
  /** Внутреннее: отсекает быстрые повторные клики "Создать папку". */
  _busyCreatingFolder: boolean;
  _undoStack: UndoEntry[];
  _redoStack: UndoEntry[];
};

type Actions = {
  // ── Вид / навигация
  setView: (v: View) => void;
  setCurrentFolder: (folder: string) => void;
  setCurrentTrashFolder: (folder: string) => void;
  setCurrentTag: (tag: string | null) => void;
  closeActiveNote: () => Promise<void>;
  goBack: () => void;
  /** Резолвит `[[title]]` wiki-ссылку: переходит при одном совпадении, открывает
   *  пикер неоднозначности при нескольких, false при отсутствии/ссылке на себя. */
  openNoteByTitle: (title: string) => boolean;
  /** Создаёт заметку с указанным заголовком в корне (или переходит к
   *  существующей, если такая уже есть где-либо).
   *  Используется в попапе `[[` wiki-ссылки. */
  createNoteByTitle: (title: string) => Promise<void>;
  /** Открывает одну заметку, выбранную из пикера `[[wiki-link]]` (и закрывает
   *  его). `closeLinkPicker` закрывает пикер без навигации. */
  openLinkMatch: (id: string) => void;
  closeLinkPicker: () => void;
  /** Открывает заметку дня для `date` (`Дневник/<year>/<YYYY-MM-DD>`), создаёт
   *  её при первом открытии, переключает на вид заметок. */
  openDailyNote: (date: Date) => Promise<void>;
  /** Открывает редактируемый шаблон заметки дня (создаёт из встроенного
   *  дефолта при первом использовании), чтобы пользователь мог настроить
   *  структуру новых дней. */
  openDailyTemplate: () => Promise<void>;
  /** Модал истории версий + восстановление выбранного снапшота. */
  openVersionHistory: (id: string) => void;
  closeVersionHistory: () => void;
  restoreNoteVersion: (id: string, timestamp: number) => Promise<void>;
  /** Оборачивает первое текстовое упоминание `title` в заметке `noteId`
   *  в `[[ ]]` (используется панелью "Несвязанные упоминания"). */
  linkMention: (noteId: string, title: string) => Promise<void>;

  // ── Дерево / папки
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  startCreateNote: (parent: string) => void;
  cancelCreateNote: () => void;
  startCreateFolder: (parent: string) => void;
  cancelCreateFolder: () => void;

  // ── Загрузка данных
  refreshTree: () => Promise<void>;
  refreshTrash: () => Promise<void>;
  refreshAssets: () => Promise<void>;

  // ── Заметки / папки
  selectNote: (id: string) => Promise<void>;
  createNote: (folder?: string, title?: string) => Promise<string>;
  createFolder: (parent: string, name: string) => Promise<void>;
  saveNote: (patch: SaveNotePatch) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  renameNote: (id: string, title: string) => Promise<void>;
  renameFolder: (folder: string, newName: string) => Promise<void>;
  moveNote: (id: string, newFolder: string) => Promise<void>;
  moveFolder: (folder: string, newParent: string) => Promise<void>;
  /** Цвет папки. `setFolderColor(folder, null)` сбрасывает на дефолт,
   *  `loadFolderColors` загружает карту с диска при запуске. */
  setFolderColor: (folder: string, color: string | null) => Promise<void>;
  loadFolderColors: () => Promise<void>;
  uploadCoverFromDisk: (absolutePath: string) => Promise<void>;

  // ── Настройки
  /** Загружает настройки с диска и применяет побочные эффекты (CSS-переменные
   *  акцента + передаёт шорткат захвата в нативный слой). Вызывается раз
   *  при старте. */
  loadSettings: () => Promise<void>;
  /** Патчит настройки: применяет акцент на лету, переназначает глобальный
   *  шорткат (откат при ошибке нативного слоя), сохраняет. */
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;

  // ── Корзина
  trashNote: (id: string) => Promise<void>;
  deleteFolder: (folder: string) => Promise<void>;
  restoreNote: (trashId: string) => Promise<void>;
  deleteForever: (trashId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  batchTrashNotes: (ids: string[]) => Promise<void>;
  batchTrash: (noteIds: string[], folderPaths: string[]) => Promise<void>;
  batchRestoreTrash: (ids: string[]) => Promise<void>;
  batchDeleteForever: (ids: string[]) => Promise<void>;

  // ── Файлы (assets)
  deleteAsset: (name: string) => Promise<void>;
  batchDeleteAssets: (names: string[]) => Promise<void>;

  // ── Undo / Redo
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // ── Отладочные тестовые данные
  seedTestData: (count?: number) => Promise<void>;
  clearTestData: () => Promise<void>;
};

export type Store = State & Actions;

const UNDO_LIMIT = 50;
const BACK_STACK_LIMIT = 50;
const RESTORE_FILE = "file" as const;
const RESTORE_FOLDER = "folder" as const;
/** Макс. параллельных FS-операций в батч-операции с корзиной (restore / delete-forever /
 *  bulk-trash). Обычный `Promise.all` на тысяче элементов шлёт все rename/remove
 *  сразу, заливает IPC-мост и замораживает UI. Пул ограничивает нагрузку. */
const BATCH_FS_CONCURRENCY = 24;

const parentOf = (idOrPath: string): string => {
  const i = idOrPath.lastIndexOf("/");
  return i === -1 ? "" : idOrPath.slice(0, i);
};

/** True, если `id` находится внутри `folder` (или является самой папкой). */
function isUnderFolder(id: string, folder: string): boolean {
  if (!folder) return false;
  return id === folder || id.startsWith(`${folder}/`);
}

/**
 * Перезаписывает id заметки (или путь папки) при переименовании содержащей
 * папки из `oldFolder` в `newFolder`. Возвращает `id` без изменений, если
 * он не внутри `oldFolder`.
 *
 * Примеры (oldFolder="a/sub", newFolder="x/sub"):
 *   "a/sub/note"     , "x/sub/note"
 *   "a/sub/inner/n"  , "x/sub/inner/n"
 *   "other/note"     , "other/note" (без изменений)
 */
function rebaseId(id: string, oldFolder: string, newFolder: string): string {
  if (!oldFolder) return id;
  if (id === oldFolder) return newFolder;
  if (id.startsWith(`${oldFolder}/`)) {
    return `${newFolder}${id.slice(oldFolder.length)}`;
  }
  return id;
}

/** Иммутабельный append с жёстким лимитом. Возвращает новый массив с `item`
 *  в конце и максимум `limit` элементами. */
function boundedPush<T>(arr: T[], item: T, limit: number): T[] {
  if (arr.length < limit) return [...arr, item];
  return [...arr.slice(arr.length - limit + 1), item];
}

/**
 * Запускает `fn` над `items` с максимум `limit` промисов одновременно.
 * Ограничивает параллельные IPC-вызовы, чтобы операция с тысячами файлов
 * не повесила мост и интерфейс. Порядок не важен, воркерам всё равно.
 * `fn` сам обрабатывает ошибки на уровне элементов.
 */
async function mapPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        await fn(items[cursor++]);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Логирует ошибку IPC/FS и показывает тост пользователю. Тосты с одинаковым
 * текстом склеиваются, так что повторные попытки autosave не спамят.
 * Экспортируется, чтобы все catch-и (drag-drop, диалоги, загрузки) шли
 * через один путь. `userMsg` должен быть коротким (тосты дедупятся по тексту).
 */
export function reportError(
  userMsg: string,
  logLabel: string,
  ...logArgs: unknown[]
): void {
  console.error(logLabel, ...logArgs);
  useToastStore.getState().push(userMsg);
}

// ─── Тестовые данные ────────────────────────────────────────────────────────
// Всё генерируется в одну папку, чистится одним рекурсивным удалением.
// см. `seedTestData` / `clearTestData`.
const SEED_ROOT = "Тестовые данные";
const SEED_NOTE_COUNT = 100; // default when the caller doesn't pass a count
const SEED_MAX_COUNT = 5000; // safety cap on a single seed batch

// Каждая секция это тематический кластер: подпапки, теги, словарь для
// названий заметки. Заметки живут в папках секции и ссылаются в основном
// друг на друга (preferential attachment, несколько хабов), редко между
// секциями. Получается реалистичный кластеризованный граф, а не шум.
type SeedSection = {
  name: string;
  subs: string[];
  tags: string[];
  words: string[];
};

const SEED_SECTIONS: SeedSection[] = [
  {
    name: "Проекты",
    subs: ["Веб", "Мобильное", "Архив"],
    tags: ["проект", "код", "todo"],
    words: ["Рефакторинг", "Релиз", "Баг", "Фича", "Архитектура", "API", "Деплой", "Прототип", "Ревью"],
  },
  {
    name: "Дневник",
    subs: ["2024", "2025"],
    tags: ["дневник", "важно"],
    words: ["Утро", "Прогулка", "Мысли", "Итоги дня", "Планы", "Настроение"],
  },
  {
    name: "Чтение",
    subs: ["Книги", "Статьи"],
    tags: ["чтение", "идея"],
    words: ["Конспект", "Цитата", "Обзор", "На полях", "Список книг", "Выписки"],
  },
  {
    name: "Идеи",
    subs: [],
    tags: ["идея", "важно"],
    words: ["Идея", "Гипотеза", "Эксперимент", "Концепт", "Набросок", "Что если"],
  },
  {
    name: "Работа",
    subs: ["Встречи", "Задачи"],
    tags: ["работа", "todo", "важно"],
    words: ["Спринт", "Ретро", "Один на один", "Задача", "Дедлайн", "Отчёт", "Созвон"],
  },
  {
    name: "Учёба",
    subs: ["Конспекты", "Практика"],
    tags: ["учёба", "код", "чтение"],
    words: ["Лекция", "Конспект", "Упражнение", "Шпаргалка", "Тема", "Семинар"],
  },
];

const SEED_GLOBAL_TAGS = ["важно", "todo", "идея"];

type SeedFolder = { path: string; section: number; weight: number };

function buildSeedFolders(): { paths: string[]; bearers: SeedFolder[] } {
  const paths: string[] = [SEED_ROOT];
  const bearers: SeedFolder[] = [];
  SEED_SECTIONS.forEach((section, si) => {
    const base = `${SEED_ROOT}/${section.name}`;
    paths.push(base);
    bearers.push({ path: base, section: si, weight: 0.4 + Math.random() });
    for (const sub of section.subs) {
      const p = `${base}/${sub}`;
      paths.push(p);
      bearers.push({ path: p, section: si, weight: 0.4 + Math.random() });
    }
  });
  return { paths, bearers };
}

function weightedPick(cumulative: number[], total: number): number {
  const r = Math.random() * total;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function pickSome<T>(arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  const count = Math.min(Math.max(n, 0), pool.length);
  for (let i = 0; i < count; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/**
 * Возвращает дерево без заметки `id`. Если ничего не нашли, отдаёт ссылку
 * на вход (React может пропустить ре-рендер). Используется при drag-drop:
 * карточка уезжает из старого места мгновенно, пока FS rename + refresh.
 */
function removeNoteFromTree(tree: TreeNode[], id: string): TreeNode[] {
  let changed = false;
  const walk = (nodes: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of nodes) {
      if (node.kind === "folder") {
        const children = walk(node.children);
        out.push(children === node.children ? node : { ...node, children });
      } else if (node.note.id === id) {
        changed = true; // drop it
      } else {
        out.push(node);
      }
    }
    return changed ? out : nodes;
  };
  const next = walk(tree);
  return changed ? next : tree;
}

/**
 * Возвращает дерево без папки `path` (и всего поддерева). Если не нашли,
 * отдаёт ссылку на вход. Зеркало removeNoteFromTree для массового удаления.
 */
function removeFolderFromTree(tree: TreeNode[], path: string): TreeNode[] {
  let changed = false;
  const walk = (nodes: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of nodes) {
      if (node.kind === "folder") {
        if (node.path === path) {
          changed = true; // drop the folder and everything beneath it
          continue;
        }
        const children = walk(node.children);
        out.push(children === node.children ? node : { ...node, children });
      } else {
        out.push(node);
      }
    }
    return changed ? out : nodes;
  };
  const next = walk(tree);
  return changed ? next : tree;
}

/**
 * Возвращает дерево с одним патчем заметки. Если ничего не изменилось,
 * отдаёт ссылку на вход (React пропустит ре-рендер).
 */
function patchNoteInTree(
  tree: TreeNode[],
  id: string,
  patch: Partial<NoteMeta>,
): TreeNode[] {
  let changed = false;
  const next = tree.map((node): TreeNode => {
    if (node.kind === "folder") {
      const children = patchNoteInTree(node.children, id, patch);
      if (children !== node.children) {
        changed = true;
        return { ...node, children };
      }
      return node;
    }
    if (node.note.id === id) {
      changed = true;
      return { ...node, note: { ...node.note, ...patch } };
    }
    return node;
  });
  return changed ? next : tree;
}

/**
 * Перебазирует узел дерева (и поддерево) при перемещении папки из
 * `oldFolder` в `newFolder`. Неизменённые узлы отдаются по ссылке.
 */
function rebaseTreeNode(
  node: TreeNode,
  oldFolder: string,
  newFolder: string,
): TreeNode {
  if (node.kind === "folder") {
    const path = rebaseId(node.path, oldFolder, newFolder);
    const children = node.children.map((c) =>
      rebaseTreeNode(c, oldFolder, newFolder),
    );
    const childrenChanged = children.some((c, i) => c !== node.children[i]);
    if (path === node.path && !childrenChanged) return node;
    return {
      ...node,
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      children,
    };
  }
  const id = rebaseId(node.note.id, oldFolder, newFolder);
  if (id === node.note.id) return node;
  return { ...node, note: { ...node.note, id, folder: parentOf(id) } };
}

/** Пересортировывает детей папки `parentPath` (корень ""). Используется
 *  после переименования в памяти, так как новое имя может изменить
 *  порядок сортировки. */
function resortLevel(nodes: TreeNode[], parentPath: string): TreeNode[] {
  if (parentPath === "") return [...nodes].sort(compareTreeNodes);
  return nodes.map((node) => {
    if (node.kind !== "folder") return node;
    if (node.path === parentPath) {
      return { ...node, children: [...node.children].sort(compareTreeNodes) };
    }
    if (parentPath.startsWith(`${node.path}/`)) {
      return { ...node, children: resortLevel(node.children, parentPath) };
    }
    return node;
  });
}

/**
 * Оптимистично переименовывает/перемещает папку в кэше дерева без чтения
 * с диска: перебазирует пути/id поддерева и пересортировывает уровень.
 * Неизменённые ветки сохраняют ссылку (React обновляет строки на месте).
 */
function renameFolderInTree(
  tree: TreeNode[],
  oldFolder: string,
  newFolder: string,
): TreeNode[] {
  const rebased = tree.map((n) => rebaseTreeNode(n, oldFolder, newFolder));
  return resortLevel(rebased, parentOf(newFolder));
}

/**
 * Оптимистично ПЕРЕМЕЩАЕТ поддерево `oldPath` в `newPath` (другой родитель)
 * в кэше дерева без чтения с диска. Выдергивает поддерево из старого родителя,
 * перебазирует пути, вставляет в нового родителя и пересортировывает.
 * Неизменённые ветки сохраняют ссылку. Если исходник не найден, отдаёт
 * вход по ссылке. Дополнение к `renameFolderInTree` (тот только переименовывает
 * на месте, родитель не меняется).
 */
function moveFolderInTree(
  tree: TreeNode[],
  oldPath: string,
  newPath: string,
): TreeNode[] {
  // 1. Выдергиваем поддерево oldPath из текущего родителя.
  let moved: TreeNode | undefined;
  const pluck = (nodes: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of nodes) {
      if (node.kind === "folder") {
        if (node.path === oldPath) {
          moved = node; // вставим ниже на новое место
          continue;
        }
        const children = pluck(node.children);
        out.push(children === node.children ? node : { ...node, children });
      } else {
        out.push(node);
      }
    }
    return out;
  };
  const without = pluck(tree);
  if (!moved) return tree; // исходник не найден, ничего не делаем

  // 2. Перебазируем пути/ид выдернутого поддерева: oldPath , newPath.
  const rebased = rebaseTreeNode(moved, oldPath, newPath);

  // 3. Вставляем в children нового родителя и пересортировываем.
  const newParent = parentOf(newPath);
  if (newParent === "") return [...without, rebased].sort(compareTreeNodes);
  let inserted = false;
  const insert = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((node) => {
      if (node.kind !== "folder") return node;
      if (node.path === newParent) {
        inserted = true;
        return {
          ...node,
          children: [...node.children, rebased].sort(compareTreeNodes),
        };
      }
      if (newParent.startsWith(`${node.path}/`)) {
        return { ...node, children: insert(node.children) };
      }
      return node;
    });
  const result = insert(without);
  // Родитель назначения не найден в кэше , сигнализируем ошибку, отдавая
  // вход по ссылке. Вызывающий сделает полный refresh вместо молчаливого
  // потеря поддерева.
  return inserted ? result : tree;
}

/**
 * Удаляет заметку (по id) или папку (по path) из дерева и возвращает
 * `[treeWithout, removedNode]` (вход по ссылке + `null` если не нашли).
 * Позволяет двигать узлы между основным деревом и корзиной в памяти,
 * чтобы restore не требовал полного обновления диска.
 */
function extractNode(
  nodes: TreeNode[],
  path: string,
): [TreeNode[], TreeNode | null] {
  let removed: TreeNode | null = null;
  const walk = (ns: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of ns) {
      if (node.kind === "folder") {
        if (node.path === path) {
          removed = node;
          continue;
        }
        const children = walk(node.children);
        out.push(children === node.children ? node : { ...node, children });
      } else if (node.note.id === path) {
        removed = node;
      } else {
        out.push(node);
      }
    }
    return out;
  };
  const next = walk(nodes);
  return removed ? [next, removed] : [nodes, null];
}

/**
 * Вставляет `node` в `tree` на уровне родительского пути (корень, если
 * пути нет слэша), пересортировывая уровень. `node` уже должен быть
 * перебазирован. Если родитель не найден, отдаёт вход по ссылке.
 */
function insertNode(tree: TreeNode[], node: TreeNode): TreeNode[] {
  const path = node.kind === "folder" ? node.path : node.note.id;
  const parent = parentOf(path);
  if (parent === "") return [...tree, node].sort(compareTreeNodes);
  let inserted = false;
  const insert = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) => {
      if (n.kind !== "folder") return n;
      if (n.path === parent) {
        inserted = true;
        return { ...n, children: [...n.children, node].sort(compareTreeNodes) };
      }
      if (parent.startsWith(`${n.path}/`)) {
        return { ...n, children: insert(n.children) };
      }
      return n;
    });
  const next = insert(tree);
  return inserted ? next : tree;
}

/**
 * Монотонно возрастающий токен для `selectNote`: отбрасывает медленные
 * чтения с диска, если между ними произошёл новый выбор. На уровне модуля,
 * потому что store это синглтон.
 */
let selectGen = 0;

/** Аналогичный токен для обновлений дерева. Когда несколько деструктивных
 *  операций запускают параллельные чтения диска, применяется только результат
 *  последнего. Иначе медленное раннее чтение может вернуть удалённые элементы
 *  (баг "удаление , мелькнуло , снова исчезло"). */
let refreshGen = 0;

/** Сериализует все вызовы `saveNote`, чтобы два дебאונсера (контент и
 *  заголовок) не накладывались и не перезаписывали друг другу поля.
 *  На уровне модуля, store это синглтон. */
let saveChain: Promise<void> = Promise.resolve();

/** Id заметок, которые сейчас переименовываются (moveNote в процессе).
 *  Любой saveNote в это окно должен прерваться, иначе он запишет в СТАРЫЙ
 *  путь, пока storage меняет на новый, и получится дубликат файла. */
const movingNoteIds = new Set<string>();

// ─── Реестр фlush-колбэков ─────────────────────────────────────────────────
//
// Редактор и NoteHero имеют свои дебаунсеры сохранения. Без возможности
// синхронно сбросить таймеры, переход (Ctrl+K, клик в сайдбаре, goBack)
// за ~400мс до последнего нажатия молча терял незаписанное. Компоненты
// регистрируют async flushNow() при монтировании, `flushAllPending()` ждёт
// их все параллельно и вызывается ПЕРЕД каждым selectNote / openNoteByTitle /
// openLinkMatch / goBack / openDailyNote / restoreNoteVersion / createNote /
// closeActiveNote, которые меняют activeId.
//
// Два предохранителя, чтобы зависший flusher не заморозил навигацию:
//   -  Каждый flush обёрнут в try/finally, ошибки не летят в обработчик клика.
//   -  Promise.race с FLUSH_TIMEOUT_MS: если flush завис (битая FS, антивирус),
//     идём дальше и теряем данные, вместо того чтобы вешать весь UI.
type Flusher = () => Promise<void>;
const pendingFlushers = new Set<Flusher>();
const FLUSH_TIMEOUT_MS = 2000;

/** Сколько чип показывает "saved" перед тем как скрыться. Достаточно
 *  чтобы пользователь успел заметить ("о, сохранилось"), но не задерживается
 *  дольше нужного. */
const SAVED_LINGER_MS = 2000;
let savedLingerTimer: ReturnType<typeof setTimeout> | null = null;

/** Перезапускает таймер saved , idle. Вызывается при каждом переходе
 *  в 'saved', чтобы быстрые последовательные сохранения не сбрасывались
 *  посерединеfade. */
function scheduleSavedToIdle(): void {
  if (savedLingerTimer !== null) clearTimeout(savedLingerTimer);
  savedLingerTimer = setTimeout(() => {
    savedLingerTimer = null;
    // Переключаем только если всё ещё 'saved' (saving или error важнее,
    // таймер linger не должен их перебивать).
    const s = useNotesStore.getState();
    if (s.savingState === "saved") {
      useNotesStore.setState({ savingState: "idle" });
    }
  }, SAVED_LINGER_MS);
}

/** Редакторы/инпуты вызывают при монтировании и unregister при размонтировании.
 *  Несколько регистраций независимы: и title, и body flusher регистрируются,
 *  оба срабатывают при переключении. */
export function registerFlusher(fn: Flusher): () => void {
  pendingFlushers.add(fn);
  return () => {
    pendingFlushers.delete(fn);
  };
}

/** Запускает все зарегистрированные flusher параллельно и ждёт все. Каждый
 *  flusher обёрнут в try/catch + timeout-raced, так что один битой flusher
 *  не может заблокировать навигацию, которая вызвала этот вызов. Безопасно
 *  вызывать откуда угодно. */
export async function flushAllPending(): Promise<void> {
  if (pendingFlushers.size === 0) return;
  const runs = Array.from(pendingFlushers).map((fn) => {
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, FLUSH_TIMEOUT_MS),
    );
    return Promise.race([
      Promise.resolve()
        .then(fn)
        .catch((e) => {
          console.error("flushAllPending: flusher failed:", e);
        }),
      timeout,
    ]);
  });
  await Promise.all(runs);
}

/** Ставится `goBack`, чтобы `selectNote` который он вызывает, не пушнул
 *  обратно запись, которую только что достал (это застряло бы навигацию
 *  в двухзаметочном цикле). */
let navigatingBack = false;

// ─── Store ─────────────────────────────────────────────────────────────────

export const useNotesStore = create<Store>((set, get) => {
  // Обновляет оба дерева параллельно и терпит частичные ошибки, чтобы
  // битое основное дерево не блокировало загрузку корзины (и наоборот).
  const refreshAll = async (): Promise<void> => {
    const myGen = ++refreshGen;
    const results = await Promise.allSettled([listTree(), listTrashTree()]);
    if (myGen !== refreshGen) return; // пришёл более свежий рефреш
    const update: Partial<State> = {};
    if (results[0].status === "fulfilled") update.tree = results[0].value;
    else console.error("refreshAll: listTree failed:", results[0].reason);
    if (results[1].status === "fulfilled") update.trashTree = results[1].value;
    else
      console.error("refreshAll: listTrashTree failed:", results[1].reason);
    if (Object.keys(update).length > 0) set(update);
  };

  // Пушит undo, если мы не внутри replay. Новые действия пользователя
  // всегда сбрасывают redo.
  const pushUndo = (entry: UndoEntry): void => {
    if (get()._undoing) return;
    set({
      _undoStack: boundedPush(get()._undoStack, entry, UNDO_LIMIT),
      _redoStack: [],
    });
  };

  /**
   * Атомарный мутатор стека: pop из `from`, выполняет entry, push в `to`.
   * - Pop до await, чтобы параллельный клик не стащил тот же entry.
   * - При ошибке entry возвращается обратно.
   * - `_undoRedoBusy` сериализует, `_undoing` блокирует вложенные pushUndo
   *   внутри тела entry.
   */
  const moveEntry = async (
    from: StackKey,
    to: StackKey,
    label: "undo" | "redo",
  ): Promise<boolean> => {
    if (get()._undoRedoBusy) return false;
    const source = get()[from];
    if (source.length === 0) return false;
    const entry = source[source.length - 1];

    set({
      [from]: source.slice(0, -1),
      _undoing: true,
      _undoRedoBusy: true,
    } as Partial<State>);

    try {
      await (label === "undo" ? entry.undo() : entry.redo());
      set({
        [to]: boundedPush(get()[to], entry, UNDO_LIMIT),
      } as Partial<State>);
      return true;
    } catch (e) {
      reportError(
        label === "undo"
          ? "Не удалось отменить действие"
          : "Не удалось повторить действие",
        `${label} failed:`,
        e,
      );
      set({ [from]: [...get()[from], entry] } as Partial<State>);
      return false;
    } finally {
      set({ _undoing: false, _undoRedoBusy: false });
    }
  };

  // Очищает активную заметку, если открыт именно этот id.
  const dropActiveIfId = (id: string): void => {
    if (get().activeId === id) set({ activeId: null, activeNote: null });
  };

  /** true, если активная заметка внутри поддерева `folder`. */
  const activeIsUnderFolder = (folder: string): boolean => {
    const af = get().activeNote?.folder ?? "";
    return af === folder || af.startsWith(`${folder}/`);
  };

  /**
   * Синхронный rebase id активной заметки при смене id (например, moveNote
   * переименовывает файл на диске). Патчим `activeNote.id` и `.folder` в
   * одном `set()` с `activeId`, чтобы любой downstream (flusher-сохранения
   * редактора в первую очередь) всегда видел согласованную пару (id, note).
   *
   * expandFolder раскрывает нового родителя, чтобы показать перемещённую
   * заметку (как при исходном selectNote).
   */
  // `reveal=true` раскрывает нового родителя (нужно при перемещении).
  // Переименование на месте передаёт `false`, чтобы не раскрывать папку,
  // которую юзер не просил.
  const reselectIfActive = (
    oldId: string,
    newId: string,
    reveal = true,
  ): void => {
    if (get().activeId !== oldId) return;
    const old = get().activeNote;
    const newFolder = parentOf(newId);
    if (!old) {
      set({ activeId: newId });
    } else {
      set({
        activeId: newId,
        activeNote: { ...old, id: newId, folder: newFolder },
      });
    }
    if (reveal && newFolder) get().expandFolder(newFolder);
  };

  /** То же, что `reselectIfActive`, но для переименования/перемещения папок.
   *  Использует `rebaseId` для вычисления нового id из старого. */
  const reselectIfUnderFolder = (
    oldFolder: string,
    newFolder: string,
    reveal = true,
  ): void => {
    const activeId = get().activeId;
    if (!activeId || !isUnderFolder(activeId, oldFolder)) return;
    reselectIfActive(activeId, rebaseId(activeId, oldFolder, newFolder), reveal);
  };

  /** Сохраняет состояние expanded/closed папки при смене её пути (rename
   *  или move), перезаписывая соответствующие записи в `expandedFolders`. */
  const rebaseExpandedFolders = (
    oldFolder: string,
    newFolder: string,
  ): void => {
    let changed = false;
    const next = new Set<string>();
    for (const path of get().expandedFolders) {
      const rebased = rebaseId(path, oldFolder, newFolder);
      if (rebased !== path) changed = true;
      next.add(rebased);
    }
    if (changed) set({ expandedFolders: next });
  };

  /** Сохраняет позицию Files-view на той же папке после её переименования
   *  / перемещения. */
  const rebaseCurrentFolder = (oldFolder: string, newFolder: string): void => {
    const cur = get().currentFolder;
    if (isUnderFolder(cur, oldFolder)) {
      set({ currentFolder: rebaseId(cur, oldFolder, newFolder) });
    }
  };

  /** Переписывает id в backStack при смене пути заметки/папки (move заметки
   *  или rename/move папки), чтобы стрелка "назад" в редакторе всё ещё
   *  вела на перемещённую заметку, а `goBack` не отбрасывал её как мёртвую
   *  (её старый id больше не в дереве). `rebaseId` обрабатывает и точное
   *  совпадение (move заметки), и префикс поддерева (операция с папкой). */
  const rebaseBackStack = (oldPath: string, newPath: string): void => {
    const cur = get().backStack;
    let changed = false;
    const next = cur.map((id) => {
      const r = rebaseId(id, oldPath, newPath);
      if (r !== id) changed = true;
      return r;
    });
    if (changed) set({ backStack: next });
  };

  /** Перенаправляет ключи цветов папок при rename/move папки (изменяется
   *  путь) и сохраняет перебазированную мапу, чтобы диск оставался
   *  консистентным. */
  const rebaseFolderColors = (oldFolder: string, newFolder: string): void => {
    const cur = get().folderColors;
    let changed = false;
    const next: Record<string, string> = {};
    for (const [path, color] of Object.entries(cur)) {
      const rebased = rebaseId(path, oldFolder, newFolder);
      if (rebased !== path) changed = true;
      next[rebased] = color;
    }
    if (!changed) return;
    set({ folderColors: next });
    void writeFolderColors(next).catch((e) =>
      console.error("rebaseFolderColors: persist failed:", e),
    );
  };

  /** После удаления папки в корзину, сбрасываем currentFolder на
   *  (ещё существующий) родительский, чтобы не застрять в несуществующей папке. */
  const dropCurrentFolderIfUnder = (folder: string): void => {
    if (isUnderFolder(get().currentFolder, folder)) {
      set({ currentFolder: parentOf(folder) });
    }
  };

  /**
   * Применяет переименование/перемещение папки полностью в памяти, без
   * refreshTree и чтения диска. Патчит дерево, активную заметку, позицию
   * Files, раскрытые папки и ключи строк за один тик, чтобы переименованная
   * папка и её открытые дети обновлялись на месте, а не исчезали и
   * появлялись заново после чтения диска.
   */
  const applyFolderRename = (oldPath: string, newPath: string): void => {
    rebaseKeys(oldPath, newPath);
    rebaseFolderColors(oldPath, newPath);
    reselectIfUnderFolder(oldPath, newPath, false);
    rebaseExpandedFolders(oldPath, newPath);
    rebaseCurrentFolder(oldPath, newPath);
    rebaseBackStack(oldPath, newPath);
    set({ tree: renameFolderInTree(get().tree, oldPath, newPath) });
  };

  /**
   * Перемещение папки в памяти (сменился родитель): тот же мгновенный,
   * безмерцающий патч, что и `applyFolderRename`, но со структурным
   * перемещением поддерева (`moveFolderInTree` вместо `renameFolderInTree`).
   * Без чтения диска, даже тяжёлая папка едет мгновенно.
   */
  const applyFolderMove = (oldPath: string, newPath: string): void => {
    rebaseKeys(oldPath, newPath);
    rebaseFolderColors(oldPath, newPath);
    reselectIfUnderFolder(oldPath, newPath);
    rebaseExpandedFolders(oldPath, newPath);
    rebaseCurrentFolder(oldPath, newPath);
    rebaseBackStack(oldPath, newPath);
    const before = get().tree;
    const next = moveFolderInTree(before, oldPath, newPath);
    // moveFolderInTree отдаёт вход по ссылке, если не смог разместить
    // поддерево (родитель назначения не найден) , перечитываем с диска,
    // а не показываем устаревшую/потерянную папку.
    if (next === before) void get().refreshTree();
    else set({ tree: next });
  };

  /**
   * Оптимистичный RESTORE из корзины в памяти (без полного refreshAll, поэтому
   * отмена удаления тяжёлой папки мгновенная): двигает каждый узел
   * {trashPath , mainPath} из кэша корзины в основное дерево. Полный refresh
   * только если узла нет в кэше корзины или родитель назначения отсутствует
   * (устаревший кэш).
   */
  const applyRestore = (
    items: { trashPath: string; mainPath: string }[],
  ): void => {
    if (items.length === 0) return;
    let tree = get().tree;
    let trashTree = get().trashTree;
    let ok = true;
    for (const { trashPath, mainPath } of items) {
      const [nextTrash, node] = extractNode(trashTree, trashPath);
      if (!node) {
        ok = false;
        break;
      }
      const placed = insertNode(tree, rebaseTreeNode(node, trashPath, mainPath));
      if (placed === tree) {
        ok = false; // destination parent not in the cached tree
        break;
      }
      tree = placed;
      trashTree = nextTrash;
    }
    if (ok) set({ tree, trashTree });
    else void refreshAll();
  };

  /**
   * Оптимистичный TRASH в памяти (обратное к `applyRestore`): вставляет
   * каждый захваченный узел основного дерева в корзину на post-trash путь.
   * Вызывающий уже вырезал узлы из основного дерева, так что это ЗАМЕНЯЕТ
   * refreshAll на успехе. Именно он раньше воскрешал только что удалённую
   * папку, когда параллельное удаление перечитывало диск во время rename.
   * Фолбэк на `refreshTrash` (только корзина, основное дерево не читает,
   * ничего не воскресит), если trash-родитель не в кэше.
   */
  const applyTrash = (
    items: { node: TreeNode; originalPath: string; trashPath: string }[],
  ): void => {
    if (items.length === 0) return;
    let trashTree = get().trashTree;
    let ok = true;
    for (const { node, originalPath, trashPath } of items) {
      const placed = insertNode(
        trashTree,
        rebaseTreeNode(node, originalPath, trashPath),
      );
      if (placed === trashTree) {
        ok = false; // trash parent not in the cached trash tree
        break;
      }
      trashTree = placed;
    }
    if (ok) set({ trashTree });
    else void get().refreshTrash();
  };

  /**
   * Вставляет обратно узлы, чей FS-trash упал с ошибкой (файл всё ещё
   * на диске) в основное дерево без чтения диска, чтобы параллельное
   * удаление не воскресило их. Фолбэк на `refreshTree` только если родитель
   * узла не в кэше.
   */
  const reinsertNodes = (nodes: TreeNode[]): void => {
    if (nodes.length === 0) return;
    let tree = get().tree;
    let ok = true;
    for (const node of nodes) {
      const placed = insertNode(tree, node);
      if (placed === tree) {
        ok = false;
        break;
      }
      tree = placed;
    }
    if (ok) set({ tree });
    else void get().refreshTree();
  };

  /**
   * Записывает новый заголовок в заметку (любую, не только активную) и
   * Патчит кэш дерева + активную заметку. Использует кэш активной заметки,
   * чтобы пропустить чтение с диска. Возвращает false, если заметку не
   * удалось прочитать или записать, чтобы вызывающий не пушил undo для
   * несостоявшегося изменения.
   */
  const applyNoteTitle = async (id: string, title: string): Promise<boolean> => {
    const cached = get().activeId === id ? get().activeNote : null;
    const current = cached ?? (await readNote(id));
    if (!current) return false;
    const next: Note = { ...current, title, updatedAt: Date.now() };
    try {
      await writeNote(next);
    } catch (e) {
      reportError("Не удалось переименовать заметку", "applyNoteTitle failed:", id, e);
      return false;
    }
    set({
      tree: patchNoteInTree(get().tree, id, {
        title,
        updatedAt: next.updatedAt,
      }),
      ...(get().activeId === id ? { activeNote: next } : {}),
    });
    return true;
  };

  // ── Проверки коллизий имён на одном уровне (регистронезависимо, как FS) ──
  /** Дети папки `parent` в кэше дерева ("" = корень). */
  const siblingsAt = (parent: string): TreeNode[] =>
    findFolderByPath(get().tree, parent) ?? [];

  /** Папка с таким именем уже есть в `parent`. */
  const folderNameTaken = (parent: string, name: string): boolean =>
    siblingsAt(parent).some(
      (n) => n.kind === "folder" && n.name.toLowerCase() === name.toLowerCase(),
    );

  /** Заметка с таким заголовком уже есть в `parent`. */
  const noteTitleTaken = (parent: string, title: string): boolean =>
    siblingsAt(parent).some(
      (n) =>
        n.kind === "note" &&
        n.note.title.trim().toLowerCase() === title.toLowerCase(),
    );

  /** Тело сохранения заметки. Сериализовано через `saveChain` (действие
   *  `saveNote`), чтобы параллельные дебаунсеры бежали по одному, каждый
   *  мержит патч на свежий `activeNote` (без lost-update). */
  const persistNote = async (patch: SaveNotePatch): Promise<void> => {
    const current = get().activeNote;
    if (!current) return;
    // Защита от гонки: если заметка сейчас переименовывается (rename файла
    // в процессе), пропускаем сохранение. Запись пойдёт в СТАРЫЙ путь, пока
    // storage меняет на НОВЫЙ, и получится дубликат. Rename завершится за
    // сотни мс, следующее нажатие запишет через дебаунсер на новый id.
    if (movingNoteIds.has(current.id)) return;

    const updated: Note = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };

    // Переключаем индикатор , "Сохраняю…". Живёт сотни мс (одна запись
    // на диск), так что чип только мелькает при быстрой печати.
    set({ savingState: "saving" });

    try {
      await writeNote(updated);
    } catch (e) {
      // Не патчим состояние заметки при ошибке записи, чтобы UI
      // соответствовал тому, что реально на диске. Показываем ошибку в чипе.
      reportError("Не удалось сохранить заметку", "saveNote failed:", e);
      set({
        savingState: "error",
        lastSaveError: (e as Error)?.message ?? String(e),
      });
      return;
    }
    set({ savingState: "saved", lastSavedAt: Date.now(), lastSaveError: null });
    // После паузы возвращаем 'idle', чтобы чип скрылся (иначе "Сохранено
    // 5 минут назад" висит вечно). Таймер на уровне модуля, store это синглтон.
    scheduleSavedToIdle();

    // Если активная заметка не изменилась с момента начала, патчим локально.
    if (get().activeId !== updated.id) return;
    set({ activeNote: updated });

    // Для контента/заголовка обновляем превью/теги, перечитывая один файл
    // (очень дёшево), а не обходя весь воркспейс.
    const contentLikeChanged =
      patch.content !== undefined || patch.title !== undefined;

    if (contentLikeChanged) {
      const fresh = await readNote(updated.id).catch((e) => {
        console.error("saveNote: re-read failed:", e);
        return null;
      });
      if (fresh && get().activeId === updated.id) {
        set({
          tree: patchNoteInTree(get().tree, updated.id, {
            title: fresh.title,
            updatedAt: fresh.updatedAt,
            icon: fresh.icon,
            cover: fresh.cover,
            favorite: fresh.favorite,
            preview: fresh.preview,
            tags: fresh.tags,
            mood: fresh.mood,
            // Обновляем links, чтобы бэклinks (и граф) видели свежий
            // [[wiki-link]] без полного обновления дерева.
            links: fresh.links,
            // Aliases в NoteMeta, чтобы [[ popup видел их без повторного
            // чтения с диска.
            aliases: fresh.aliases,
          }),
        });
      }
    } else {
      set({
        tree: patchNoteInTree(get().tree, updated.id, {
          updatedAt: updated.updatedAt,
          icon: updated.icon,
          cover: updated.cover,
          favorite: updated.favorite,
          mood: updated.mood,
        }),
      });
    }
  };

  return {
    view: "notes",
    tree: [],
    trashTree: [],
    assets: [],
    assetsLoaded: false,
    savingState: "idle",
    lastSavedAt: null,
    lastSaveError: null,
    expandedFolders: new Set<string>(),
    activeId: null,
    activeNote: null,
    backStack: [],
    creatingFolderIn: null,
    creatingNoteIn: null,
    currentFolder: "",
    currentTrashFolder: "",
    currentTag: null,
    folderColors: {},
    settings: { ...DEFAULT_SETTINGS },
    linkPicker: null,
    versionHistoryFor: null,
    editorReloadNonce: 0,
    _undoing: false,
    _undoRedoBusy: false,
    _busyCreatingNote: false,
    _busyCreatingFolder: false,
    _undoStack: [],
    _redoStack: [],

    setView: (v) => set({ view: v }),
    setCurrentFolder: (folder) => set({ currentFolder: folder }),
    setCurrentTrashFolder: (folder) => set({ currentTrashFolder: folder }),
    setCurrentTag: (tag) => set({ currentTag: tag }),
    // Возврат в галерею завершает сессию навигации "назад".
    closeActiveNote: async () => {
      // Обходим selectNote , нужно сбросить таймеры вручную. Без этого
      // закрытие за ~400мс до последнего нажатия теряет незаписанное.
      await flushAllPending();
      set({
        activeId: null,
        activeNote: null,
        backStack: [],
        savingState: "idle",
        lastSavedAt: null,
        lastSaveError: null,
      });
    },

    goBack: () => {
      // Пропускаем записи, чьи заметки больше не существуют (удалены,
      // или id сменился при move/rename), чтобы "назад" всегда вёл
      // на реальную заметку, а не в пустой редактор.
      const liveIds = new Set(flattenNotes(get().tree).map((n) => n.id));
      let stack = get().backStack;
      while (stack.length > 0 && !liveIds.has(stack[stack.length - 1])) {
        stack = stack.slice(0, -1);
      }
      if (stack.length === 0) {
        set({ backStack: [] });
        return;
      }
      const prevId = stack[stack.length - 1];
      set({ backStack: stack.slice(0, -1), view: "notes" });
      navigatingBack = true;
      void get().selectNote(prevId);
    },

    openNoteByTitle: (title) => {
      const matches = findNotesByTitle(get().tree, title);
      if (matches.length === 0) return false;
      if (matches.length === 1) {
        // Одна подсказка , переходим, если это не текущая заметка (ссылка
        // на саму себя попадает в обычное редактирование, чтобы курсор
        // мог сесть).
        if (matches[0].id === get().activeId) return false;
        set({ view: "notes" });
        void get().selectNote(matches[0].id);
        return true;
      }
      // Несколько подсказок , пусть пользователь выбирает.
      set({ linkPicker: { title: title.trim(), matches } });
      return true;
    },

    createNoteByTitle: async (title) => {
      const t = title.trim();
      if (!t) return;
      // Если заметка с таким заголовком уже есть где-то в дереве,
      // переходим (или открываем пикер для неоднозначных). Никогда не
      // создаём дубликат, даже если единственная подсказка это текущая
      // заметка (ссылка на текущий заголовок иначе создаст ненужную копию).
      // Используем тот же `openNoteByTitle`, boolean нам не нужен.
      if (findNotesByTitle(get().tree, t).length > 0) {
        get().openNoteByTitle(t);
        return;
      }
      // Создаём в корне воркспейса. `createNote` пишет файл + выбирает
      // новую заметку + обновляет дерево, так что效应 titlesSig в редакторе
      // автоматически обновляет wiki-link декорации.
      await get().createNote("", t);
    },

    openLinkMatch: (id) => {
      set({ view: "notes", linkPicker: null });
      void get().selectNote(id);
    },

    closeLinkPicker: () => set({ linkPicker: null }),

    /**
     * Открывает заметку дня для `date` (детерминированный путь
     * `Дневник/<year>/<YYYY-MM-DD>`), создаёт при первом открытии.
     * Переключает на "Заметки". Новую заметку дня штампует `createdAt` =
     * полночь `date`, чтобы тепловая карта и "В этот день" группировали
     * по правильной дате, даже если записали задним числом.
     */
    openDailyNote: async (date) => {
      const id = dailyNoteId(date);
      const folder = dailyNoteFolder(date);
      set({ view: "notes" });

      // Уже в кэше дерева , просто выбираем (без обращения к диску).
      if (flattenNotes(get().tree).some((n) => n.id === id)) {
        await get().selectNote(id);
        return;
      }

      // Нет в кэше, но может ещё лежать на диске (из прошлой сессии,
      // или дерево на секунду устарело). Читаем перед созданием, чтобы
      // не затереть содержимое готового дня пустой заметкой.
      let existing: Note | null = null;
      try {
        existing = await readNote(id);
      } catch (e) {
        console.error("openDailyNote: read failed:", id, e);
      }
      if (existing) {
        await get().refreshTree();
        get().expandFolder(folder);
        await get().selectNote(id);
        return;
      }

      // Совершенно новая заметка дня, заполняем из шаблона (встроенный по
      // умолчанию, пока юзер не настроит "Шаблон заметки дня"). createdAt
      // фиксируется на полночь `date`.
      const tmpl = await readNote(DAILY_TEMPLATE_ID).catch(() => null);
      const created = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      ).getTime();
      const note: Note = {
        id,
        title: toISODate(date),
        folder,
        createdAt: created,
        updatedAt: created,
        content: tmpl ? tmpl.content : DEFAULT_DAILY_TEMPLATE,
        blocknote: tmpl ? (tmpl.blocknote ?? null) : null,
        bnHash: tmpl ? (tmpl.bnHash ?? null) : null,
        icon: null,
        cover: null,
        preview: "",
        favorite: false,
        tags: [],
        links: [],
      };
      try {
        await writeNote(note);
      } catch (e) {
        reportError("Не удалось открыть заметку дня", "openDailyNote failed:", id, e);
        return;
      }
      await get().refreshTree();
      get().expandFolder(folder);
      await get().selectNote(id);
    },

    openDailyTemplate: async () => {
      set({ view: "notes" });
      // Создаём шаблон из встроенного при первом использовании, затем
      // открываем как обычную заметку (живёт за пределами дерева, в
      // `.templates`).
      const existing = await readNote(DAILY_TEMPLATE_ID).catch(() => null);
      if (!existing) {
        const now = Date.now();
        const seed: Note = {
          id: DAILY_TEMPLATE_ID,
          title: "Шаблон заметки дня",
          folder: parentOf(DAILY_TEMPLATE_ID),
          createdAt: now,
          updatedAt: now,
          content: DEFAULT_DAILY_TEMPLATE,
          icon: null,
          cover: null,
          preview: "",
          favorite: false,
          tags: [],
          links: [],
        };
        try {
          await writeNote(seed);
        } catch (e) {
          reportError("Не удалось открыть шаблон дня", "openDailyTemplate failed:", e);
          return;
        }
      }
      await get().selectNote(DAILY_TEMPLATE_ID);
    },

    openVersionHistory: (id) => set({ versionHistoryFor: id }),
    closeVersionHistory: () => set({ versionHistoryFor: null }),

    /**
     * Восстанавливает заметку к прошлой версии: записывает содержимое
     * версии (что автоматически снапшотит текущее состояние до restore,
     * так что restore отменяем через ту же историю), обновляет кэш меты,
     * и если заметка открыта, патчит `editorReloadNonce` для перезагрузки
     * документа даже при том же `activeId`.
     */
    restoreNoteVersion: async (id, timestamp) => {
      const ver = await readNoteVersion(id, timestamp);
      if (!ver) {
        reportError(
          "Не удалось прочитать версию",
          "restoreNoteVersion: version missing:",
          id,
          timestamp,
        );
        return;
      }
      const cached = get().activeId === id ? get().activeNote : null;
      const current = cached ?? (await readNote(id));
      if (!current) {
        reportError(
          "Не удалось восстановить версию",
          "restoreNoteVersion: note missing:",
          id,
        );
        return;
      }
      const updated: Note = {
        ...current,
        content: ver.body,
        blocknote: ver.blocknote,
        bnHash: ver.bnHash,
        updatedAt: Date.now(),
      };
      // Всегда снапшотим текущее состояние первым (без throttle), чтобы
      // сам restore можно было отменить из истории, даже сразу после правки.
      await snapshotNoteNow(id).catch((e) =>
        console.error("restoreNoteVersion: pre-restore snapshot failed:", id, e),
      );
      try {
        await writeNote(updated);
      } catch (e) {
        reportError(
          "Не удалось восстановить версию",
          "restoreNoteVersion: write failed:",
          id,
          e,
        );
        return;
      }
      // Обновляем кэш меты дерева (превью/теги берутся из тела).
      const fresh = await readNote(id);
      set((s) => ({
        tree: fresh
          ? patchNoteInTree(s.tree, id, {
              title: fresh.title,
              preview: fresh.preview,
              tags: fresh.tags,
              updatedAt: fresh.updatedAt,
              icon: fresh.icon,
              cover: fresh.cover,
              favorite: fresh.favorite,
            })
          : s.tree,
        ...(s.activeId === id ? { activeNote: updated } : {}),
        editorReloadNonce: s.editorReloadNonce + 1,
        versionHistoryFor: null,
      }));
    },

    linkMention: async (noteId, title) => {
      const n = await readNote(noteId);
      if (!n) {
        reportError(t("Заметка не найдена"), "linkMention: note missing:", noteId);
        return;
      }
      // Оборачиваем ПЕРВОЕ обычное вхождение `title` (граница Unicode-слова,
      // любой регистр), пропуская текст уже внутри `[[ ]]`. Заметка
      // предлагается для линка только если она ещё не ссылается на этот
      // заголовок, так что существующие ссылки не трогаем.
      const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `(\\[\\[[^\\]]*\\]\\])|((?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_]))`,
        "giu",
      );
      let done = false;
      const newContent = n.content.replace(re, (m, link: string, word: string) => {
        if (link) return link; // оставляем существующие wiki-ссылки как есть
        if (word && !done) {
          done = true;
          return `[[${word}]]`;
        }
        return m;
      });
      if (!done || newContent === n.content) return;

      // Тело изменилось, lossless blocknote JSON устарел; сбрасываем,
      // чтобы редактор перепарсил markdown (новая [[ссылка]] станет
      // wiki-ссылкой).
      const updated: Note = {
        ...n,
        content: newContent,
        blocknote: null,
        bnHash: null,
        updatedAt: Date.now(),
      };
      try {
        await writeNote(updated);
      } catch (e) {
        reportError("Не удалось связать", "linkMention: write failed:", noteId, e);
        return;
      }
      // Обновляем кэш дерева с новой ссылкой (для бэклinks/графа).
      const fresh = await readNote(noteId);
      set((s) => ({
        tree: fresh
          ? patchNoteInTree(s.tree, noteId, {
              links: fresh.links,
              preview: fresh.preview,
              tags: fresh.tags,
              updatedAt: fresh.updatedAt,
            })
          : s.tree,
        ...(s.activeId === noteId
          ? { activeNote: updated, editorReloadNonce: s.editorReloadNonce + 1 }
          : {}),
      }));
    },

    toggleFolder: (path) => {
      const next = new Set(get().expandedFolders);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      set({ expandedFolders: next });
    },

    expandFolder: (path) => {
      if (!path) return;
      const expanded = get().expandedFolders;
      const next = new Set(expanded);
      let cursor = "";
      let added = false;
      for (const part of path.split("/")) {
        cursor = cursor ? `${cursor}/${part}` : part;
        if (!next.has(cursor)) {
          next.add(cursor);
          added = true;
        }
      }
      if (added) set({ expandedFolders: next });
    },

    startCreateNote: (parent) => {
      if (parent) get().expandFolder(parent);
      set({ creatingNoteIn: parent, creatingFolderIn: null });
    },
    cancelCreateNote: () => set({ creatingNoteIn: null }),

    startCreateFolder: (parent) => {
      if (parent) get().expandFolder(parent);
      set({ creatingFolderIn: parent, creatingNoteIn: null });
    },
    cancelCreateFolder: () => set({ creatingFolderIn: null }),

    refreshTree: async () => {
      const myGen = ++refreshGen;
      try {
        const tree = await listTree();
        if (myGen !== refreshGen) return; // superseded by a newer refresh
        set({ tree });
      } catch (e) {
        console.error("refreshTree failed:", e);
      }
    },

    refreshTrash: async () => {
      try {
        const trashTree = await listTrashTree();
        set({ trashTree });
      } catch (e) {
        console.error("refreshTrash failed:", e);
      }
    },

    refreshAssets: async () => {
      try {
        const assets = await listAssets();
        set({ assets, assetsLoaded: true });
      } catch (e) {
        console.error("refreshAssets failed:", e);
        // Всё равно помечаем loaded, чтобы UI спрятал скелетон вместо
        // вечного ожидания при временной ошибке. Следующий вызов повторит.
        set({ assetsLoaded: true });
      }
    },

    selectNote: async (id) => {
      // Сбрасываем pending-таймеры исходящей заметки ДО смены activeId.
      // Без этого Ctrl+K за ~400мс до последнего нажатия молча потерял бы
      // нажатия. saveChain уже сериализует записи, так что flush не
      // повлияет на current. FLUSH_TIMEOUT_MS ограничивает ожидание,
      // зависший IO не заморозит навигацию.
      const prev = get().activeId;
      if (prev && prev !== id) {
        await flushAllPending();
      }

      // Записываем в историю "назад" при реальном переходе заметка, заметка.
      // Переход через `goBack` ставит `navigatingBack`, чтобы не пушить
      // то, что только что достали из стека.
      if (!navigatingBack && prev && prev !== id) {
        const stack = get().backStack;
        // Защита от дублей: быстрые клики могут запустить второй selectNote,
        // пока disk-read первого ещё летит (activeId ещё не обновился),
        // и пушить тот же id дважды.
        if (stack[stack.length - 1] !== prev) {
          set({ backStack: boundedPush(stack, prev, BACK_STACK_LIMIT) });
        }
      }
      navigatingBack = false;

      // Инкрементируем токен, чтобы медленное чтение устаревшего id не
      // перезаписало более свежий выбор.
      const myGen = ++selectGen;
      let note: Note | null = null;
      try {
        note = await readNote(id);
      } catch (e) {
        console.error("selectNote failed:", id, e);
      }
      if (myGen !== selectGen) return; // пришёл более свежий выбор
      // Сбрасываем индикатор сохранения, новая заметка ещё не сохранялась,
      // устаревшее "Сохранено · 5 мин назад" от предыдущей заметки будет
      // неверным.
      set({
        activeId: id,
        activeNote: note,
        savingState: "idle",
        lastSavedAt: null,
        lastSaveError: null,
      });
      if (note?.folder) get().expandFolder(note.folder);
    },

    createNote: async (folder = "", title = "") => {
      // Склейка быстрых двойных кликов. Возвращаем "", а не предыдущий
      // activeId, чтобы вызывающие (сейчас игнорируют, но могут измениться)
      // получили однозначный "ничего не создано".
      if (get()._busyCreatingNote) return "";
      // Отбрасываем дубль заголовка на этом уровне, но только если имя
      // реально введено. Безымянные заметки ("+" / палитра) могут
      // сосуществовать.
      const wantedTitle = title.trim();
      if (wantedTitle && noteTitleTaken(folder, wantedTitle)) {
        useToastStore.getState().push(`Заметка «${wantedTitle}» уже существует`);
        // Закрываем инлайн-создатель, а не оставляем висеть. Та же
        // условная очистка, что и на успехе, чтобы не сбить чужой
        // создатель, открытый параллельно.
        set((state) =>
          state.creatingNoteIn === folder ? { creatingNoteIn: null } : {},
        );
        return "";
      }
      set({ _busyCreatingNote: true });
      try {
        // `currentId` мутабельный, чтобы undo entry отслеживал файл
        // через последующие move и восстановления с суффиксом коллизии.
        let currentId = newNoteId(folder);
        const now = Date.now();
        const note: Note = {
          id: currentId,
          title,
          folder,
          createdAt: now,
          updatedAt: now,
          content: "",
          icon: null,
          cover: null,
          preview: "",
          favorite: false,
          tags: [],
          links: [],
        };

        try {
          await writeNote(note);
        } catch (e) {
          // Запись не удалась, не пушим undo для призрачной заметки.
          reportError("Не удалось создать заметку", "createNote failed:", e);
          return "";
        }

        await get().refreshTree();
        if (folder) get().expandFolder(folder);
        await get().selectNote(currentId);
        // Очищаем `creatingNoteIn` только если он всё ещё указывает на НАШУ
        // папку. Пользователь мог кликнуть "+ Note" в другом месте во время
        // долгого IPC, и мы не должны сбить его свежий выбор.
        set((state) =>
          state.creatingNoteIn === folder ? { creatingNoteIn: null } : {},
        );

        // `trashedPath` это реальный путь в корзине от trashNoteFs, может
        // отличаться от currentId если был добавлен суффикс при коллизии.
        // Захвачен в замыкание, чтобы redo нашёл файл даже для вложенных id
        // (например "folder/foo"), где угадать по basename не получится.
        let trashedPath = "";
        pushUndo({
          label: t("Создание заметки"),
          undo: async () => {
            trashedPath = await trashNoteFs(currentId);
            dropActiveIfId(currentId);
            await refreshAll();
          },
          redo: async () => {
            if (!trashedPath) return;
            const r = await restoreFromTrash(trashedPath);
            if (r.kind !== "missing") currentId = r.path;
            trashedPath = "";
            await refreshAll();
          },
        });
        return currentId;
      } finally {
        set({ _busyCreatingNote: false });
      }
    },

    createFolder: async (parent, name) => {
      // Склейка быстрых двойных отправок (Enter-массовый, Enter + клик
      // снаружи). Аналог `_busyCreatingNote`. Папка не дублируется (mkdir
      // идемпотентен), но без этого в undo-стеке окажется дубль "Создание
      // папки" и дерево обновится дважды.
      if (get()._busyCreatingFolder) return;
      // Отбрасываем дубль имени папки на этом уровне. Без этого FS молча
      // сливает с существующей папкой (mkdir идемпотентен), что выглядит
      // как "ничего не произошло".
      const safe = sanitizeFolderName(name);
      if (!safe) return;
      if (folderNameTaken(parent, safe)) {
        useToastStore.getState().push(`Папка «${safe}» уже существует`);
        // Закрываем инлайн-создатель, а не оставляем висеть.
        set((state) =>
          state.creatingFolderIn === parent ? { creatingFolderIn: null } : {},
        );
        return;
      }
      set({ _busyCreatingFolder: true });
      try {
        let currentPath: string;
        try {
          currentPath = await createFolderFs(parent, name);
        } catch (e) {
          reportError("Не удалось создать папку", "createFolder failed:", e);
          return;
        }
        // Оптимистично: вставляем (пустую) новую папку в памяти вместо
        // полного перечитывания воркспейса. Чтение могло бы зависнуть или
        // устареть после большого удаления; папка пустая, узел точный.
        // Фолбэк на refresh только если родитель не в кэше дерева.
        const folderNode: TreeNode = {
          kind: "folder",
          name: currentPath.slice(currentPath.lastIndexOf("/") + 1),
          path: currentPath,
          children: [],
        };
        const withFolder = insertNode(get().tree, folderNode);
        if (withFolder !== get().tree) set({ tree: withFolder });
        else await get().refreshTree();
        get().expandFolder(currentPath);
        // См. createNote, почему это условное, а не безусловное.
        set((state) =>
          state.creatingFolderIn === parent ? { creatingFolderIn: null } : {},
        );

        // Захваченный путь в корзине отслеживает реальный on-disk путь
        // через undo/redo, включая суффиксы коллизий.
        let trashedPath = "";
        pushUndo({
          label: t("Создание папки"),
          undo: async () => {
            trashedPath = await trashFolderFs(currentPath);
            await refreshAll();
          },
          redo: async () => {
            if (!trashedPath) return;
            const r = await restoreFromTrash(trashedPath);
            if (r.kind !== "missing") currentPath = r.path;
            trashedPath = "";
            await refreshAll();
          },
        });
      } finally {
        set({ _busyCreatingFolder: false });
      }
    },

    /**
     * Сохраняет патч активной заметки.
     *
     * Производительность: не делает полного refresh дерева. Для контента/
     * заголовка перечитывает только эту заметку (дёшево, 1 файл) и патчит
     * кэш. Для метаданных патчит на месте без лишних IO.
     */
    // Сериализовано через `saveChain` (тело в `persistNote`), чтобы два
    // дебаунсера (контент и заголовок) не накладывались и не перезаписывали
    // друг другу поля: каждый работает после того, как предыдущий обновил
    // `activeNote`, так что `{...activeNote, ...patch}` всегда свежий.
    saveNote: (patch) => {
      const result = saveChain.then(() => persistNote(patch));
      saveChain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    toggleFavorite: async (id) => {
      // Используем кэш активной заметки, чтобы пропустить чтение с диска.
      // Фолбэк если переключаем неактивную заметку (например, из контекстного
      // меню сайдбара).
      const cached = get().activeId === id ? get().activeNote : null;
      const current = cached ?? (await readNote(id));
      if (!current) return;

      const next: Note = {
        ...current,
        favorite: !current.favorite,
        updatedAt: Date.now(),
      };
      try {
        await writeNote(next);
      } catch (e) {
        reportError("Не удалось обновить избранное", "toggleFavorite failed:", e);
        return;
      }
      set({
        tree: patchNoteInTree(get().tree, id, {
          favorite: next.favorite,
          updatedAt: next.updatedAt,
        }),
        ...(get().activeId === id ? { activeNote: next } : {}),
      });
    },

    /**
     * Переименовывает заметку, меняя заголовок (файловый id остаётся,
     * в стиле Notion, заголовок не привязан к пути). Работает для любой
     * заметки, активной или нет. Отменяемо.
     */
    renameNote: async (id, title) => {
      const trimmed = title.trim();
      const cached = get().activeId === id ? get().activeNote : null;
      const current = cached ?? (await readNote(id));
      if (!current) return;
      const oldTitle = current.title;
      if (trimmed === oldTitle) return; // ничего не меняем, undo-история чистая

      if (!(await applyNoteTitle(id, trimmed))) return;

      pushUndo({
        label: t("Переименование заметки"),
        // Захваченный `id` может устареть, если родительская папка заметки
        // была переименована/перемещена (с суффиксом коллизии) между этим
        // rename и его undo, так что путь больше не резолвится. Не молчим,
        // говорим пользователю вместо видимости "undo прошёл". (Полный фикс
        // перебазировал бы id undo-entry при операциях с папками, это
        // более широкий рефакторинг.)
        undo: async () => {
          if (!(await applyNoteTitle(id, oldTitle))) {
            reportError(
              "Не удалось отменить переименование (заметку переместили?)",
              "undo rename: note path unavailable:",
              id,
            );
          }
        },
        redo: async () => {
          if (!(await applyNoteTitle(id, trimmed))) {
            reportError(
              "Не удалось повторить переименование (заметку переместили?)",
              "redo rename: note path unavailable:",
              id,
            );
          }
        },
      });
    },

    /**
     * Переименовывает папку на месте (родитель не меняется). Аналогично
     * undo/redo в moveFolder: `renameFolderFs` может добавить суффикс
     * коллизии, так что отслеживаем реальный путь через циклы. Отменяемо.
     */
    renameFolder: async (folder, newName) => {
      const oldName = folder.includes("/")
        ? folder.slice(folder.lastIndexOf("/") + 1)
        : folder;

      let currentPath: string;
      try {
        currentPath = await renameFolderFs(folder, newName);
      } catch (e) {
        reportError("Не удалось переименовать папку", "renameFolder failed:", e);
        return;
      }
      if (currentPath === folder) return; // storage решил, что это no-op

      let originalPath = folder;
      // Оптимистично, без мерцания: патчим всё в памяти за один тик
      // вместо перечитывания всего воркспейса. См. `applyFolderRename`.
      applyFolderRename(folder, currentPath);

      pushUndo({
        label: t("Переименование папки"),
        undo: async () => {
          const restoredPath = await renameFolderFs(currentPath, oldName);
          applyFolderRename(currentPath, restoredPath);
          originalPath = restoredPath;
        },
        redo: async () => {
          const reRenamed = await renameFolderFs(originalPath, newName);
          applyFolderRename(originalPath, reRenamed);
          currentPath = reRenamed;
        },
      });
    },

    setFolderColor: async (folder, color) => {
      const next = { ...get().folderColors };
      if (color === null) delete next[folder];
      else next[folder] = color;
      set({ folderColors: next }); // оптимистично, запись ниже подтвердит
      try {
        await writeFolderColors(next);
      } catch (e) {
        reportError("Не удалось сохранить цвет папки", "setFolderColor failed:", folder, e);
      }
    },

    loadFolderColors: async () => {
      try {
        set({ folderColors: await readFolderColors() });
      } catch (e) {
        console.error("loadFolderColors failed:", e);
      }
    },

    loadSettings: async () => {
      try {
        const settings = await readSettings();
        set({ settings });
        applyAccent(settings.accentColor);
        // Дефолтный шорткат уже зарегистрирован нативно при старте; пушим
        // только если он отличается, чтобы Rust перебиндился. Best-effort,
        // ошибка просто оставит дефолтный биндинг.
        if (settings.captureShortcut !== DEFAULT_SETTINGS.captureShortcut) {
          try {
            await invoke("set_capture_shortcut", {
              accelerator: settings.captureShortcut,
            });
          } catch (e) {
            console.error("set_capture_shortcut (load) failed:", e);
          }
        }
      } catch (e) {
        console.error("loadSettings failed:", e);
      }
    },

    updateSettings: async (patch) => {
      const prev = get().settings;
      const next = { ...prev, ...patch };
      set({ settings: next }); // оптимистично

      if (
        patch.accentColor !== undefined &&
        patch.accentColor !== prev.accentColor
      ) {
        applyAccent(next.accentColor);
      }

      // Перебиндим глобальный шорткат ПЕРВЫМ: если нативный слой отклонит
      // (плохой комбо, или уже занят другим приложением), откатываем и
      // выходим до записи шортката, который реально не работает.
      if (
        patch.captureShortcut !== undefined &&
        patch.captureShortcut !== prev.captureShortcut
      ) {
        try {
          await invoke("set_capture_shortcut", {
            accelerator: next.captureShortcut,
          });
        } catch (e) {
          set({
            settings: { ...get().settings, captureShortcut: prev.captureShortcut },
          });
          reportError(
            "Не удалось назначить хоткей (возможно, занят другим приложением)",
            "set_capture_shortcut failed:",
            e,
          );
          return;
        }
      }

      try {
        await writeSettings(get().settings);
      } catch (e) {
        reportError("Не удалось сохранить настройки", "writeSettings failed:", e);
      }
    },

    uploadCoverFromDisk: async (absolutePath) => {
      const noteId = get().activeId;
      if (!noteId) return;
      try {
        const token = await importCoverFile(absolutePath);
        // Импорт был async, применяем только если та же заметка всё ещё
        // активна, иначе обложка попадёт не туда. Смена обложки не через
        // undo (перевыбор это естественный "undo").
        if (get().activeId !== noteId) return;
        await get().saveNote({ cover: token });
      } catch (e) {
        reportError("Не удалось загрузить обложку", "uploadCoverFromDisk failed:", e);
      }
    },

    /**
     * Защита от гонки с дебаунсированным saveNote. Набор `movingNoteIds`
     * переключается вокруг FS rename; persistNote видит id в процессе и
     * прерывается, так что сохранение во время перетаскивания не запишет
     // в старый путь и не оставит дубликат.
     */
    moveNote: async (id, newFolder) => {
      const oldFolder = parentOf(id);
      // Пропускаем no-op перемещения и не засоряем undo-историю.
      if (oldFolder === newFolder) return;

      // Оптимистично: дёргаем карточку со старого места, чтобы move
      // ощущался мгновенным. refreshTree ниже сверит реальное состояние
      // (и при ошибке обновит дерево, откатив спекулятивное удаление).
      set({ tree: removeNoteFromTree(get().tree, id) });

      let currentId: string;
      movingNoteIds.add(id);
      try {
        currentId = await moveNoteFs(id, newFolder);
      } catch (e) {
        reportError("Не удалось переместить заметку", "moveNote failed:", e);
        await get().refreshTree();
        return;
      } finally {
        // Всегда снимаем guard (успех или ошибка), чтобы следующее
        // сохранение могло работать с текущим active id.
        movingNoteIds.delete(id);
      }
      if (currentId === id) {
        await get().refreshTree(); // no-op перемещение, возвращаем карточку
        return;
      }

      let originalId = id;
      // Переносим стабильный токен строки сайдбара на новый id, чтобы
      // не было утечки в ключах и строка обновлялась на месте.
      rebaseKeys(id, currentId);
      rebaseBackStack(id, currentId);
      reselectIfActive(id, currentId);
      await get().refreshTree();
      if (newFolder) get().expandFolder(newFolder);

      pushUndo({
        label: t("Перемещение заметки"),
        undo: async () => {
          const restoredId = await moveNoteFs(currentId, oldFolder);
          rebaseKeys(currentId, restoredId);
          rebaseBackStack(currentId, restoredId);
          reselectIfActive(currentId, restoredId);
          originalId = restoredId;
          await get().refreshTree();
        },
        redo: async () => {
          const reMovedId = await moveNoteFs(originalId, newFolder);
          rebaseKeys(originalId, reMovedId);
          rebaseBackStack(originalId, reMovedId);
          reselectIfActive(originalId, reMovedId);
          currentId = reMovedId;
          await get().refreshTree();
        },
      });
    },

    moveFolder: async (folder, newParent) => {
      const oldParent = parentOf(folder);
      if (oldParent === newParent) return;

      let currentPath: string;
      try {
        currentPath = await moveFolderFs(folder, newParent);
      } catch (e) {
        reportError("Не удалось переместить папку", "moveFolder failed:", e);
        return;
      }
      if (currentPath === folder) return; // storage сказал, что no-op

      let originalPath = folder;
      // Оптимистично, без мерцания, МГНОВЕННО: перемещаем поддерево в памяти,
      // без полного refreshTree (тот обход и был лаг при перемещении тяжёлых
      // папок). moveFolderFs уже вернул реальный финальный путь, так что
      // это точно.
      applyFolderMove(folder, currentPath);
      if (newParent) get().expandFolder(newParent);

      pushUndo({
        label: t("Перемещение папки"),
        undo: async () => {
          const restoredPath = await moveFolderFs(currentPath, oldParent);
          if (restoredPath === currentPath) {
            // Источник больше не на `currentPath` (перемещён извне),
            // undo невозможен. (Предок мог быть переименован/перемещён
            // между оригинальной операцией и этим undo, всё ещё может
            // оказаться на устаревшем `oldParent`; полный фикс требует
            // перебазирования undo-entry путей при каждой операции с
            // папками.)
            reportError(
              "Не удалось отменить перемещение папки",
              "moveFolder undo: source unavailable:",
              currentPath,
            );
            return;
          }
          applyFolderMove(currentPath, restoredPath);
          originalPath = restoredPath;
        },
        redo: async () => {
          const reMovedPath = await moveFolderFs(originalPath, newParent);
          if (reMovedPath === originalPath) {
            reportError(
              "Не удалось повторить перемещение папки",
              "moveFolder redo: source unavailable:",
              originalPath,
            );
            return;
          }
          applyFolderMove(originalPath, reMovedPath);
          currentPath = reMovedPath;
        },
      });
    },

    trashNote: async (id) => {
      // Забираем активную заметку ДО FS rename: любой дебаунсированный
      // saveNote в окне await увидит `activeNote = null` и прервётся,
      // вместо того чтобы воскресить призрачный файл по старому пути.
      const wasActive = get().activeId === id;
      if (wasActive) set({ activeId: null, activeNote: null });
      // Оптимистично: выдергиваем заметку из дерева СЕЙЧАС (захватив,
      // чтобы потом переместить в дерево корзины в памяти, без refreshAll,
      // который и воскрешал элементы при параллельных операциях).
      const [without, removed] = extractNode(get().tree, id);
      if (removed) set({ tree: without });

      let currentId = id;
      let trashedPath = "";
      try {
        trashedPath = await trashNoteFs(currentId);
      } catch (e) {
        reportError("Не удалось удалить заметку", "trashNote failed:", e);
        // Ошибка FS, заметка всё ещё на диске; вставляем обратно без
        // чтения диска.
        if (removed) reinsertNodes([removed]);
        if (wasActive) await get().selectNote(id);
        return;
      }
      if (!trashedPath) return; // источник уже удалён, оптимистичное удаление остаётся
      // Перемещаем в дерево корзины в памяти (без чтения основного дерева).
      if (removed) {
        applyTrash([{ node: removed, originalPath: id, trashPath: trashedPath }]);
      } else {
        void get().refreshTrash();
      }

      pushUndo({
        label: t("Удаление заметки"),
        undo: async () => {
          const r = await restoreFromTrash(trashedPath);
          if (r.kind === RESTORE_FILE) currentId = r.path;
          else
            reportError(
              "Не удалось отменить удаление",
              "trashNote undo: trash entry missing:",
              trashedPath,
            );
          trashedPath = "";
          await refreshAll();
        },
        redo: async () => {
          // Сбрасываем активную ДО FS-операции (зеркало основного пути),
          // чтобы дебаунсированный saveNote в окне await увидел activeNote=null
          // и прервался, вместо того чтобы воскресить файл по опустевшему пути.
          dropActiveIfId(currentId);
          trashedPath = await trashNoteFs(currentId);
          if (!trashedPath)
            reportError(
              "Не удалось повторить удаление",
              "trashNote redo: note missing:",
              currentId,
            );
          await refreshAll();
        },
      });
    },

    deleteFolder: async (folder) => {
      // Паттерн "забрать активную ДО работы": та же логика, что в trashNote.
      // Если активная заметка внутри удаляемой папки, дебаунсированный
      // saveNote иначе воссоздаст дерево каталогов и призрачный файл.
      const droppedActive = activeIsUnderFolder(folder);
      if (droppedActive) set({ activeId: null, activeNote: null });
      // Оптимистично: выдергиваем поддерево папки СЕЙЧАС (захватив,
      // чтобы потом переместить в дерево корзины в памяти, без refreshAll,
      // который воскрешал папки при параллельных удалениях).
      const [withoutFolder, removed] = extractNode(get().tree, folder);
      if (removed) set({ tree: withoutFolder });

      let currentPath = folder;
      let trashedPath = "";
      try {
        trashedPath = await deleteFolderFs(currentPath);
      } catch (e) {
        reportError("Не удалось удалить папку", "deleteFolder failed:", e);
        // Ошибка FS, папка всё ещё на диске; вставляем захваченное поддерево
        // обратно.
        if (removed) reinsertNodes([removed]);
        return;
      }
      if (!trashedPath) return; // источник уже удалён, оптимистичное удаление остаётся
      // Не оставляем Files внутри папки, которая теперь исчезла.
      dropCurrentFolderIfUnder(folder);
      // Перемещаем в дерево корзины в памяти (без чтения основного дерева).
      if (removed) {
        applyTrash([{ node: removed, originalPath: folder, trashPath: trashedPath }]);
      } else {
        void get().refreshTrash();
      }

      pushUndo({
        label: t("Удаление папки"),
        undo: async () => {
          const r = await restoreFromTrash(trashedPath);
          if (r.kind === RESTORE_FOLDER) {
            applyRestore([{ trashPath: trashedPath, mainPath: r.path }]);
            currentPath = r.path;
          } else {
            await refreshAll();
          }
          trashedPath = "";
        },
        redo: async () => {
          trashedPath = await deleteFolderFs(currentPath);
          await refreshAll();
        },
      });
    },

    restoreNote: async (trashId) => {
      try {
        await restoreFromTrash(trashId);
      } catch (e) {
        reportError("Не удалось восстановить", "restoreNote failed:", e);
        return;
      }
      await refreshAll();
    },

    deleteForever: async (trashId) => {
      try {
        await deleteForeverFs(trashId);
      } catch (e) {
        reportError("Не удалось удалить навсегда", "deleteForever failed:", e);
        return;
      }
      await get().refreshTrash();
    },

    emptyTrash: async () => {
      try {
        await emptyTrashFs();
      } catch (e) {
        reportError("Не удалось очистить корзину", "emptyTrash failed:", e);
        return;
      }
      await get().refreshTrash();
    },

    batchTrashNotes: async (ids) => {
      // Забираем активную ДО FS-операций, см. trashNote.
      const activeId = get().activeId;
      if (activeId !== null && ids.includes(activeId)) {
        set({ activeId: null, activeNote: null });
      }
      // Оптимистично: выдергиваем каждую заметку из дерева СЕЙЧАС
      // (захватив, чтобы потом переместить удалённые в дерево корзины
      // в памяти, без refreshAll, чтобы параллельные операции не
      // воскресили ничего).
      let working = get().tree;
      const captured = new Map<string, TreeNode>();
      for (const id of ids) {
        const [withoutNote, node] = extractNode(working, id);
        if (node) {
          captured.set(id, node);
          working = withoutNote;
        }
      }
      set({ tree: working });

      // Каждый entry отслеживает И live-tree id (может получить суффикс
      // "-restored-" после undo), И текущий путь в корзине (может получить
      // суффикс коллизии после redo). Storage разделяет их, но они всегда
      // возвращаются парой через trashNoteFs и restoreFromTrash.
      type Entry = { id: string; trashPath: string };
      const trashed: Entry[] = [];
      const failed: string[] = [];
      for (const id of ids) {
        try {
          const trashPath = await trashNoteFs(id);
          if (trashPath) trashed.push({ id, trashPath });
        } catch (e) {
          failed.push(id);
          reportError("Не удалось удалить некоторые заметки", "batchTrash failed:", id, e);
        }
      }
      // Перемещаем удалённые заметки в дерево корзины; вставляем обратно
      // упавшие (всё ещё на диске). Без чтения основного дерева, ничего
      // не воскреснет.
      applyTrash(
        trashed
          .filter((e) => captured.has(e.id))
          .map((e) => ({
            node: captured.get(e.id)!,
            originalPath: e.id,
            trashPath: e.trashPath,
          })),
      );
      reinsertNodes(
        failed.map((id) => captured.get(id)).filter((n): n is TreeNode => !!n),
      );
      if (trashed.length === 0) return;

      const word = pluralRu(trashed.length, "заметку", "заметки", "заметок");
      pushUndo({
        label: `Удаление ${trashed.length} ${word}`,
        undo: async () => {
          for (const entry of trashed) {
            if (!entry.trashPath) continue;
            try {
              const r = await restoreFromTrash(entry.trashPath);
              if (r.kind === RESTORE_FILE) entry.id = r.path;
              entry.trashPath = "";
            } catch (e) {
              console.error("batchTrash undo failed:", entry.id, e);
            }
          }
          await refreshAll();
        },
        redo: async () => {
          for (const entry of trashed) {
            try {
              dropActiveIfId(entry.id); // before the await , see trashNote redo
              entry.trashPath = await trashNoteFs(entry.id);
            } catch (e) {
              console.error("batchTrash redo failed:", entry.id, e);
            }
          }
          await refreshAll();
        },
      });
    },

    // Массовое удаление заметок И папок за один проход: вырезаем из
    // дерева в памяти мгновенно (интерфейс не мерцает), делаем все
    // FS-операции, затем ОДИН refresh вместо обновления дерева N раз.
    batchTrash: async (noteIds, folderPaths) => {
      if (noteIds.length === 0 && folderPaths.length === 0) return;

      // Забираем активную, если она из удаляемых или внутри удаляемой
      // папки (та же логика saveNote-гонки, что в trashNote).
      const activeId = get().activeId;
      if (
        (activeId !== null && noteIds.includes(activeId)) ||
        folderPaths.some((f) => activeIsUnderFolder(f))
      ) {
        set({ activeId: null, activeNote: null });
      }
      // Не оставляем Files внутри папки, которая вот-вот исчезнет.
      for (const f of folderPaths) dropCurrentFolderIfUnder(f);

      // Оптимистично: выдергиваем всё из дерева СЕЙЧАС (захватив каждый узел,
      // чтобы потом переместить в дерево корзины в памяти). Без refreshAll:
      // чтение основного дерева это то, что воскрешало папки при параллельных
      // операциях.
      let working = get().tree;
      const capturedNotes = new Map<string, TreeNode>();
      const capturedFolders = new Map<string, TreeNode>();
      for (const id of noteIds) {
        const [withoutNote, node] = extractNode(working, id);
        if (node) {
          capturedNotes.set(id, node);
          working = withoutNote;
        }
      }
      for (const f of folderPaths) {
        const [withoutFolder, node] = extractNode(working, f);
        if (node) {
          capturedFolders.set(f, node);
          working = withoutFolder;
        }
      }
      set({ tree: working });

      // FS-trash: заметки с ограниченной параллельностью (неограниченный
      // Promise.all на тысячах элементов зальёт мост и повесит UI);
      // папки последовательно (параллельные rename могут конфликтовать
      // в общей родительской папке). Ошибки на элементах не прерывают
      // пакет.
      type NoteEntry = { id: string; trashPath: string };
      type FolderEntry = { path: string; trashPath: string };
      const tNotes: NoteEntry[] = [];
      const tFolders: FolderEntry[] = [];
      const failed: string[] = [];
      await mapPool(noteIds, BATCH_FS_CONCURRENCY, async (id) => {
        try {
          const p = await trashNoteFs(id);
          if (p) tNotes.push({ id, trashPath: p });
        } catch (e) {
          failed.push(id);
          reportError("Не удалось удалить некоторые элементы", "batchTrash note failed:", id, e);
        }
      });
      for (const path of folderPaths) {
        try {
          const p = await deleteFolderFs(path);
          if (p) tFolders.push({ path, trashPath: p });
        } catch (e) {
          failed.push(path);
          reportError("Не удалось удалить некоторые элементы", "batchTrash folder failed:", path, e);
        }
      }

      // Перемещаем всё в дерево корзины в памяти; вставляем обратно
      // упавшие (всё ещё на диске). Без чтения основного дерева,
      // ничего не воскреснет.
      applyTrash([
        ...tNotes
          .filter((e) => capturedNotes.has(e.id))
          .map((e) => ({
            node: capturedNotes.get(e.id)!,
            originalPath: e.id,
            trashPath: e.trashPath,
          })),
        ...tFolders
          .filter((e) => capturedFolders.has(e.path))
          .map((e) => ({
            node: capturedFolders.get(e.path)!,
            originalPath: e.path,
            trashPath: e.trashPath,
          })),
      ]);
      reinsertNodes(
        failed
          .map((p) => capturedNotes.get(p) ?? capturedFolders.get(p))
          .filter((n): n is TreeNode => !!n),
      );
      if (tNotes.length === 0 && tFolders.length === 0) return;

      const n = tNotes.length + tFolders.length;
      pushUndo({
        label: `Удаление ${n} ${pluralRu(n, "элемент", "элемента", "элементов")}`,
        undo: async () => {
          const restored: { trashPath: string; mainPath: string }[] = [];
          for (const e of tNotes) {
            if (!e.trashPath) continue;
            try {
              const r = await restoreFromTrash(e.trashPath);
              if (r.kind === RESTORE_FILE) {
                restored.push({ trashPath: e.trashPath, mainPath: r.path });
                e.id = r.path;
              }
              e.trashPath = "";
            } catch (err) {
              console.error("batchTrash undo (note) failed:", e.id, err);
            }
          }
          for (const e of tFolders) {
            if (!e.trashPath) continue;
            try {
              const r = await restoreFromTrash(e.trashPath);
              if (r.kind === RESTORE_FOLDER) {
                restored.push({ trashPath: e.trashPath, mainPath: r.path });
                e.path = r.path;
              }
              e.trashPath = "";
            } catch (err) {
              console.error("batchTrash undo (folder) failed:", e.path, err);
            }
          }
          applyRestore(restored);
        },
        redo: async () => {
          for (const e of tNotes) {
            try {
              dropActiveIfId(e.id); // before the await , see trashNote redo
              e.trashPath = await trashNoteFs(e.id);
            } catch (err) {
              console.error("batchTrash redo (note) failed:", e.id, err);
            }
          }
          for (const e of tFolders) {
            try {
              e.trashPath = await deleteFolderFs(e.path);
            } catch (err) {
              console.error("batchTrash redo (folder) failed:", e.path, err);
            }
          }
          await refreshAll();
        },
      });
    },

    batchRestoreTrash: async (ids) => {
      if (ids.length === 0) return;
      // Оптимистично: убираем выбранные элементы из дерева корзины СЕЙЧАС,
      // чтобы интерфейс (и массовая панель) очистились мгновенно. Один
      // refreshAll ниже сверит: восстановленные вернутся в основное дерево,
      // ошибки останутся в корзине. Каждый id это либо id заметки в корзине,
      // либо путь папки; пробуем удалить как оба (одно сработает).
      let pruned = get().trashTree;
      for (const id of ids) {
        pruned = removeNoteFromTree(pruned, id);
        pruned = removeFolderFromTree(pruned, id);
      }
      set({ trashTree: pruned });

      // Восстанавливаем с ограниченной параллельностью: последовательные
      // await на сотнях элементов тормозили (по одному IPC-вызову на
      // элемент), но неограниченный Promise.all на тысячах зальёт мост
      // и повесит UI. В корзине можно выделить только элементы одного
      // уровня, так что параллельные restore не конфликтуют по путям.
      // Ошибки не прерывают пакет.
      await mapPool(ids, BATCH_FS_CONCURRENCY, (id) =>
        restoreFromTrash(id).catch((e) =>
          reportError(
            "Не удалось восстановить некоторые элементы",
            "batchRestore failed:",
            id,
            e,
          ),
        ),
      );
      await refreshAll(); // одно обновление на весь пакет
    },

    batchDeleteForever: async (ids) => {
      if (ids.length === 0) return;
      // Оптимистичная обрезка (мгновенный UI) + удаление с ограниченной
      // параллельностью: та же логика, что в batchRestoreTrash. refreshTrash
      // сверит после.
      let pruned = get().trashTree;
      for (const id of ids) {
        pruned = removeNoteFromTree(pruned, id);
        pruned = removeFolderFromTree(pruned, id);
      }
      set({ trashTree: pruned });

      await mapPool(ids, BATCH_FS_CONCURRENCY, (id) =>
        deleteForeverFs(id).catch((e) =>
          reportError(
            "Не удалось удалить некоторые элементы навсегда",
            "batchDeleteForever failed:",
            id,
            e,
          ),
        ),
      );
      await get().refreshTrash();
    },

    deleteAsset: async (name) => {
      try {
        await deleteAssetFs(name);
      } catch (e) {
        reportError("Не удалось удалить файл", "deleteAsset failed:", name, e);
        return;
      }
      await get().refreshAssets();
    },

    batchDeleteAssets: async (names) => {
      for (const name of names) {
        try {
          await deleteAssetFs(name);
        } catch (e) {
          reportError("Не удалось удалить некоторые файлы", "batchDeleteAssets failed:", name, e);
        }
      }
      await get().refreshAssets();
    },

    canUndo: () => get()._undoStack.length > 0,
    canRedo: () => get()._redoStack.length > 0,
    undo: () => moveEntry("_undoStack", "_redoStack", "undo"),
    redo: () => moveEntry("_redoStack", "_undoStack", "redo"),

    // Пишет папку-маркер с заметками напрямую через storage, минуя
    // per-action refresh/undo/validation, чтобы пакет лег быстро и за
    // одно обновление дерева. Повторный запуск стирает предыдущий пакет.
    // Генератор строит *реалистичный* граф: заметки распределены по
    // папкам по весу, тегированы палитрой секции и ссылаются в основном
    // внутри своей секции через preferential attachment (несколько хабов),
    // с редкими мостами между секциями.
    seedTestData: async (count = SEED_NOTE_COUNT) => {
      try {
        const total = Math.max(1, Math.min(Math.floor(count), SEED_MAX_COUNT));
        await purgeFolder(SEED_ROOT);
        if (activeIsUnderFolder(SEED_ROOT)) {
          set({ activeId: null, activeNote: null });
        }

        const { paths, bearers } = buildSeedFolders();
        for (const f of paths) {
          const i = f.lastIndexOf("/");
          await createFolderFs(
            i === -1 ? "" : f.slice(0, i),
            i === -1 ? f : f.slice(i + 1),
          );
        }

        // Суммарные веса, для перекоса распределения (где-то плотно,
        // где-то разреженно).
        const cumulative: number[] = [];
        let acc = 0;
        for (const b of bearers) {
          acc += b.weight;
          cumulative.push(acc);
        }

        // Проход 1: папка, секция, уникальный заголовок, теги для каждой
        // заметки.
        const titles: string[] = [];
        const folderOf: string[] = [];
        const sectionOf: number[] = [];
        const tagsOf: string[][] = [];
        const bySection: number[][] = SEED_SECTIONS.map(() => []);
        const usedTitles = new Set<string>();
        for (let i = 0; i < total; i++) {
          const bearer = bearers[weightedPick(cumulative, acc)];
          const section = SEED_SECTIONS[bearer.section];
          const base = section.words[Math.floor(Math.random() * section.words.length)];
          let title = base;
          let k = 2;
          while (usedTitles.has(title)) title = `${base} ${k++}`;
          usedTitles.add(title);
          const tags = pickSome(section.tags, 1 + Math.floor(Math.random() * 2));
          if (Math.random() < 0.3) {
            const g = SEED_GLOBAL_TAGS[Math.floor(Math.random() * SEED_GLOBAL_TAGS.length)];
            if (!tags.includes(g)) tags.push(g);
          }
          titles.push(title);
          folderOf.push(bearer.path);
          sectionOf.push(bearer.section);
          tagsOf.push(tags);
          bySection[bearer.section].push(i);
        }

        // Проход 2: ссылки через кластеризованный preferential attachment:
        // P(target) ∝ degree+1, с перекосом в пользу своей секции.
        const degree = new Float64Array(total);
        const linksOf: string[][] = Array.from({ length: total }, () => []);
        const allIdx = Array.from({ length: total }, (_, i) => i);
        const pickByDegree = (candidates: number[], exclude: number): number => {
          let totalW = 0;
          for (const j of candidates) if (j !== exclude) totalW += degree[j] + 1;
          if (totalW <= 0) return -1;
          let r = Math.random() * totalW;
          for (const j of candidates) {
            if (j === exclude) continue;
            r -= degree[j] + 1;
            if (r <= 0) return j;
          }
          return -1;
        };
        for (let i = 0; i < total; i++) {
          const r = Math.random();
          const k = r < 0.15 ? 0 : r < 0.55 ? 1 : r < 0.8 ? 2 : r < 0.95 ? 3 : 4;
          const linked = new Set<number>();
          for (let l = 0; l < k; l++) {
            let target =
              Math.random() < 0.75
                ? pickByDegree(bySection[sectionOf[i]], i)
                : pickByDegree(allIdx, i);
            if (target === -1) target = pickByDegree(allIdx, i);
            if (target === -1 || target === i || linked.has(target)) continue;
            linked.add(target);
            linksOf[i].push(titles[target]);
            degree[i] += 1;
            degree[target] += 1;
          }
        }

        // Создаём записи заметок с гарантированно уникальными id (newNoteId
        // варьируется только 4-символьным random в пределах миллисекунды,
        // так что тысячи в tight loop иначе задублируются и перезапишут
        // друг друга).
        const now = Date.now();
        // Разбрасываем даты создания за последний год (с перекосом к
        // последнему времени), чтобы таймлайн-слайдер графа имел реальный
        // диапазон.
        const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
        const usedIds = new Set<string>();
        const notes: Note[] = [];
        for (let i = 0; i < total; i++) {
          const folder = folderOf[i];
          let id = newNoteId(folder);
          while (usedIds.has(id)) id = newNoteId(folder);
          usedIds.add(id);
          const links = linksOf[i];
          const content =
            `${titles[i]}\n\n` +
            `Темы: ${tagsOf[i].map((t) => `#${t}`).join(" ")}\n\n` +
            (links.length ? `Связи: ${links.map((t) => `[[${t}]]`).join(" ")}\n` : "");
          const createdAt = now - Math.floor(Math.random() ** 1.4 * YEAR_MS);
          const updatedAt = createdAt + Math.floor(Math.random() * (now - createdAt + 1));
          notes.push({
            id,
            title: titles[i],
            folder,
            createdAt,
            updatedAt,
            content,
            icon: null,
            cover: null,
            preview: "",
            favorite: false,
            tags: [],
            links: [],
          });
        }

        // Пакетная запись, чтобы FS/IPC мост не залило тысячами параллельных
        // записей.
        const CHUNK = 64;
        for (let i = 0; i < notes.length; i += CHUNK) {
          await Promise.all(notes.slice(i, i + CHUNK).map((n) => writeNote(n)));
        }
        await get().refreshTree();
      } catch (e) {
        reportError("Не удалось создать тестовые данные", "seedTestData failed:", e);
      }
    },

    clearTestData: async () => {
      try {
        await purgeFolder(SEED_ROOT);
      } catch (e) {
        reportError("Не удалось удалить тестовые данные", "clearTestData failed:", e);
        return;
      }
      if (activeIsUnderFolder(SEED_ROOT)) {
        set({ activeId: null, activeNote: null });
      }
      dropCurrentFolderIfUnder(SEED_ROOT);
      await get().refreshTree();
    },
  };
});
