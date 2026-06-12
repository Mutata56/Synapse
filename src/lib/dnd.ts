/**
 * Формат drag-and-drop для перемещения элементов в дереве файлов.
 *
 * За один drag можно тащить один или много элементов (заметки и папки вместе,
 * это ок). Полезная нагрузка это JSON с коротким магическим префиксом, чтобы
 * случайное перетаскивание выделенного текста не распарсилось как payload дерева.
 *
 *   "notesapp:[{"kind":"note","id":"..."},{"kind":"folder","path":"..."}]"
 *
 * Любой источник drag идёт через `setDragData`, любая цель drop через
 * `decodeDrag`. Этот файл единственный источник правды.
 */

import { pluralRu } from "./format";

export const DRAG_MIME = "text/plain";

const PAYLOAD_PREFIX = "notesapp:";

export type DragItem =
  | { kind: "note"; id: string }
  | { kind: "folder"; path: string };

/** Необязательный payload для кастомного превью drag (когда тащим один элемент). */
export type DragPreview = {
  /** Основной текст: заголовок заметки или имя папки. */
  label: string;
  /** Вторичный текст помельче: путь к папке, подсказка о типе и т.п. Опционально. */
  meta?: string;
};

// ─── Кастомное превью drag ───────────────────────────────────────────────────
// Стандартный drag-ghost из HTML5 это битмап-снимок исходного DOM-узла.
// У Chromium и WebKit давние баги, из-за которых этот снимок:
//   - целиком теряет `box-shadow` и `backdrop-filter`,
//   - скругляет `border-radius` только на одном углу (остальные квадратные),
//     это и есть знаменитый глюк "один скруглённый угол" на карточках,
//   - игнорирует полупрозрачные фоны, заданные через CSS-переменные.
//
// Поэтому рисуем свой chip и скармливаем его в `setDragImage`. Курсор
// привязываем к центру chip, так предсказуемо: неважно, за какое место
// исходного элемента юзер схватил.

const PREVIEW_OFFSCREEN_PX = -10000;
const PREVIEW_MIN_WIDTH_PX = 280;
const PREVIEW_MAX_WIDTH_PX = 460;

const PREVIEW_BASE_STYLE = {
  position: "fixed" as const,
  top: `${PREVIEW_OFFSCREEN_PX}px`,
  left: `${PREVIEW_OFFSCREEN_PX}px`,
  fontFamily:
    'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  pointerEvents: "none" as const,
  zIndex: "9999",
} satisfies Partial<CSSStyleDeclaration>;

function buildSinglePreview(label: string, meta?: string): HTMLDivElement {
  const node = document.createElement("div");
  Object.assign(node.style, PREVIEW_BASE_STYLE, {
    padding: "16px 22px",
    background: "rgb(20, 20, 24)",
    color: "rgb(244, 244, 245)",
    borderRadius: "14px",
    border: "1px solid rgba(99, 102, 241, 0.5)",
    boxShadow:
      "0 16px 48px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(99, 102, 241, 0.15)",
    minWidth: `${PREVIEW_MIN_WIDTH_PX}px`,
    maxWidth: `${PREVIEW_MAX_WIDTH_PX}px`,
  } satisfies Partial<CSSStyleDeclaration>);

  const titleEl = document.createElement("div");
  titleEl.textContent = label;
  Object.assign(titleEl.style, {
    fontSize: "17px",
    fontWeight: "600",
    lineHeight: "1.3",
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies Partial<CSSStyleDeclaration>);
  node.appendChild(titleEl);

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.textContent = meta;
    Object.assign(metaEl.style, {
      fontSize: "13px",
      color: "rgb(113, 113, 122)",
      marginTop: "5px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    } satisfies Partial<CSSStyleDeclaration>);
    node.appendChild(metaEl);
  }
  return node;
}

/** Два смещённых chip-"хвоста" за основным chip плюс бейдж со счётчиком сверху. */
function buildMultiPreview(count: number): HTMLDivElement {
  const root = document.createElement("div");
  Object.assign(root.style, PREVIEW_BASE_STYLE, {
    width: `${PREVIEW_MIN_WIDTH_PX}px`,
    height: "78px",
  } satisfies Partial<CSSStyleDeclaration>);

  const makeChip = (offsetX: number, offsetY: number, opacity: number) => {
    const chip = document.createElement("div");
    Object.assign(chip.style, {
      position: "absolute",
      top: `${offsetY}px`,
      left: `${offsetX}px`,
      right: `${-offsetX}px`,
      height: "56px",
      background: "rgb(28, 28, 32)",
      borderRadius: "12px",
      border: "1px solid rgba(99, 102, 241, 0.4)",
      boxShadow: "0 10px 28px rgba(0, 0, 0, 0.5)",
      opacity: String(opacity),
    } satisfies Partial<CSSStyleDeclaration>);
    return chip;
  };

  root.appendChild(makeChip(16, 16, 0.45));
  root.appendChild(makeChip(8, 8, 0.75));

  const main = document.createElement("div");
  Object.assign(main.style, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    height: "56px",
    padding: "0 22px",
    background: "rgb(20, 20, 24)",
    color: "rgb(244, 244, 245)",
    borderRadius: "12px",
    border: "1px solid rgba(99, 102, 241, 0.6)",
    boxShadow:
      "0 16px 48px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(99, 102, 241, 0.2)",
    display: "flex",
    alignItems: "center",
    fontSize: "16px",
    fontWeight: "600",
    letterSpacing: "-0.01em",
  } satisfies Partial<CSSStyleDeclaration>);
  main.textContent = `${count} ${pluralRu(count, "элемент", "элемента", "элементов")}`;
  root.appendChild(main);

  // Бейдж со счётчиком: круглый, в правом верхнем углу, акцентного цвета.
  const badge = document.createElement("div");
  Object.assign(badge.style, {
    position: "absolute",
    top: "-10px",
    right: "-10px",
    minWidth: "26px",
    height: "26px",
    padding: "0 8px",
    borderRadius: "13px",
    background: "rgb(99, 102, 241)",
    color: "white",
    fontSize: "13px",
    fontWeight: "700",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow:
      "0 4px 12px rgba(99, 102, 241, 0.55), 0 0 0 2px rgb(20, 20, 24)",
  } satisfies Partial<CSSStyleDeclaration>);
  badge.textContent = String(count);
  root.appendChild(badge);

  return root;
}

function attachDragImage(dt: DataTransfer, node: HTMLDivElement): void {
  document.body.appendChild(node);

  // Чтение offsetWidth/Height форсит layout, чтобы setDragImage получил
  // реальные размеры. Якорь по центру, чтобы не зависеть от того, за какое
  // место исходного элемента нажал юзер.
  const anchorX = node.offsetWidth / 2;
  const anchorY = node.offsetHeight / 2;

  try {
    dt.setDragImage(node, anchorX, anchorY);
  } catch {
    /* в каких-то редких окружениях setDragImage не поддержан, молча
       откатываемся на (косой на вид) нативный ghost. */
  }
  // setDragImage снимает битмап во время вызова, но реально рисует из DOM
  // на следующем кадре. Удаляем после rAF.
  requestAnimationFrame(() => node.remove());
}

// ─── Публичное API ────────────────────────────────────────────────────────────

/**
 * Кладёт в `dt` один или несколько drag-элементов. Если `items.length > 1`,
 * показываем стопку с бейджем-счётчиком, иначе один chip с
 * `preview.label` / `preview.meta` (если передали).
 */
export function setDragData(
  dt: DataTransfer,
  items: DragItem[],
  preview?: DragPreview,
): void {
  if (items.length === 0) return;
  dt.setData(DRAG_MIME, `${PAYLOAD_PREFIX}${JSON.stringify(items)}`);
  dt.effectAllowed = "move";
  if (items.length > 1) {
    attachDragImage(dt, buildMultiPreview(items.length));
  } else if (preview) {
    attachDragImage(dt, buildSinglePreview(preview.label, preview.meta));
  }
}

/**
 * Читает drop-payload из DataTransfer. Для не-древесных drag (выделенный текст,
 * перетаскивание внешних файлов, битые данные) возвращает пустой массив. Всегда
 * отдаёт свежий массив, вызывающий может его мутировать.
 */
export function decodeDrag(dt: DataTransfer): DragItem[] {
  const data = dt.getData(DRAG_MIME);
  if (!data.startsWith(PAYLOAD_PREFIX)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.slice(PAYLOAD_PREFIX.length));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: DragItem[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    if (obj.kind === "note" && typeof obj.id === "string" && obj.id) {
      items.push({ kind: "note", id: obj.id });
    } else if (
      obj.kind === "folder" &&
      typeof obj.path === "string" &&
      obj.path
    ) {
      items.push({ kind: "folder", path: obj.path });
    }
  }
  return items;
}

/**
 * true, если `id` лежит внутри `folder` (или это сама папка).
 * Повторяет `isUnderFolder` из стора, держим локально, чтобы цели drop
 * обходились без зависимостей.
 */
function isPathUnder(id: string, folder: string): boolean {
  if (!folder) return false;
  return id === folder || id.startsWith(`${folder}/`);
}

/**
 * Отсеивает элементы, для которых drop в `destFolder` был бы бессмысленным или
 * недопустимым:
 *   - заметка уже в `destFolder` (родитель не меняется),
 *   - папка брошена в саму себя или в свой же потомок,
 *   - папка, чей родитель и так `destFolder`.
 *
 * `destFolder` это путь к папке через слэш, куда упал drop (пустая строка это
 * корень).
 */
export function filterDroppable(
  items: DragItem[],
  destFolder: string,
): DragItem[] {
  return items.filter((item) => {
    if (item.kind === "note") {
      const parent = item.id.includes("/")
        ? item.id.slice(0, item.id.lastIndexOf("/"))
        : "";
      return parent !== destFolder;
    }
    // папка: отбрасываем саму себя и случай "папка это предок dest"
    if (item.path === destFolder) return false;
    if (isPathUnder(destFolder, item.path)) return false;
    const parent = item.path.includes("/")
      ? item.path.slice(0, item.path.lastIndexOf("/"))
      : "";
    return parent !== destFolder;
  });
}

/**
 * Применяет drop сразу нескольких элементов в `dest`. Сначала двигаем папки,
 * чтобы заметку, которая поехала внутри одной из них, не пересчитали дважды.
 * Ошибки по отдельным элементам логируем, но батч не прерываем. Сырые элементы
 * тут же прогоняем через `filterDroppable`, так что вызывающий шлёт декодированный
 * payload напрямую.
 *
 * Возвращает, тащили ли drop хоть один выделенный сейчас элемент: по этому флагу
 * вызывающий решает, сбрасывать ли своё выделение (перетаскивание НЕвыделенного
 * элемента мимо чужого выделения должно оставить его нетронутым). Общий для
 * FilesView и сайдбарного FolderTree, чтобы пайплайн перемещения жил в одном месте.
 */
export async function applyTreeDrop(
  rawItems: DragItem[],
  dest: string,
  ops: {
    moveFolder: (path: string, dest: string) => Promise<unknown>;
    moveNote: (id: string, dest: string) => Promise<unknown>;
    isSelected: (item: DragItem) => boolean;
  },
): Promise<boolean> {
  const filtered = filterDroppable(rawItems, dest);
  // Выкидываем любой элемент, вложенный в ДРУГУЮ тащимую папку: переезд предка
  // утащит его с собой, так что отдельный переезд это двойное перемещение и
  // гонка, а результат зависел бы от порядка drag (например, тащим `p` и `p/c`
  // вместе).
  const draggedFolders = filtered
    .filter(
      (it): it is Extract<DragItem, { kind: "folder" }> => it.kind === "folder",
    )
    .map((f) => f.path);
  const items = filtered.filter((it) => {
    const path = it.kind === "folder" ? it.path : it.id;
    return !draggedFolders.some((f) => path !== f && path.startsWith(`${f}/`));
  });
  if (items.length === 0) return false;
  const draggedSelection = items.some(ops.isSelected);

  // Сначала папки (так id вложенных заметок остаются согласованными), потом заметки.
  for (const it of items) {
    if (it.kind !== "folder") continue;
    try {
      await ops.moveFolder(it.path, dest);
    } catch (e) {
      console.error("applyTreeDrop: move folder failed:", it.path, e);
    }
  }
  for (const it of items) {
    if (it.kind !== "note") continue;
    try {
      await ops.moveNote(it.id, dest);
    } catch (e) {
      console.error("applyTreeDrop: move note failed:", it.id, e);
    }
  }
  return draggedSelection;
}
