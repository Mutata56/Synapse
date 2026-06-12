import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelection } from "../hooks/useSelection";
import { cn } from "../lib/cn";
import {
  applyTreeDrop,
  decodeDrag,
  setDragData,
  type DragItem,
} from "../lib/dnd";
import { exportNoteMarkdown } from "../lib/export";
import { FOLDER_COLORS } from "../lib/folderColors";
import { DEFAULT_NOTE_TITLE } from "../lib/format";
import type { TreeNode } from "../lib/storage";
import { stableKey } from "../lib/treeKeys";
import { confirmDialog } from "../store/confirm";
import { reportError, useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { t } from "../lib/i18n";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const DEPTH_INDENT_PX = 14;
const FOLDER_ROW_PAD_LEFT_PX = 6;
const NOTE_ROW_PAD_LEFT_PX = 22;
const CLICK_OUTSIDE_GUARD_MS = 200;

// ─── Контекст дерева ──────────────────────────────────────────────────────────
// Чтобы вложенные строки читали и меняли мультивыделение без прокидывания
// пропсов через рекурсию TreeNodeView.

type TreeCtx = {
  noteSelHas: (id: string) => boolean;
  folderSelHas: (path: string) => boolean;
  toggleNote: (id: string) => void;
  toggleFolder: (path: string) => void;
  selecting: boolean;
  openMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void;
  bulkTrash: () => Promise<void>;
  selCount: number;
  /** Собирает payload для перетаскивания строки. Если строка в выделении,
   *  тащим всё выделение, иначе только её саму. */
  noteDragItems: (id: string) => DragItem[];
  folderDragItems: (path: string) => DragItem[];
  /** Общий конвейер дропа: отсекает перемещения сам-в-себя и пустышки,
   *  применяет пачкой, в конце снимает выделение. */
  handleDrop: (items: DragItem[], dest: string) => Promise<void>;
};

const TreeContext = createContext<TreeCtx | null>(null);

function useTreeCtx(): TreeCtx {
  const c = useContext(TreeContext);
  if (!c) throw new Error("TreeContext missing");
  return c;
}

// ─── Компонент ─────────────────────────────────────────────────────────────

export function FolderTree() {
  const tree = useNotesStore((s) => s.tree);
  const startCreateNote = useNotesStore((s) => s.startCreateNote);
  const startCreateFolder = useNotesStore((s) => s.startCreateFolder);
  const creatingFolderIn = useNotesStore((s) => s.creatingFolderIn);
  const creatingNoteIn = useNotesStore((s) => s.creatingNoteIn);
  const moveNote = useNotesStore((s) => s.moveNote);
  const moveFolder = useNotesStore((s) => s.moveFolder);
  const batchTrash = useNotesStore((s) => s.batchTrash);

  const [rootDragOver, setRootDragOver] = useState(false);

  const noteSel = useSelection<string>();
  const folderSel = useSelection<string>();
  const selecting = noteSel.isSelecting || folderSel.isSelecting;

  const clearAll = useCallback(() => {
    noteSel.clear();
    folderSel.clear();
  }, [noteSel.clear, folderSel.clear]);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const openMenu = useCallback(
    (e: React.MouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [],
  );

  const handleBulkTrash = useCallback(async () => {
    const noteIds = Array.from(noteSel.selection);
    const folderPaths = Array.from(folderSel.selection);
    const total = noteIds.length + folderPaths.length;
    if (!total) return;
    if (!(await confirmDialog(`Переместить ${total} в корзину?`, { confirmLabel: "В корзину" }))) return;
    clearAll(); // сразу прячем выделение
    await batchTrash(noteIds, folderPaths); // оптимистично выкидываем из дерева, потом один рефреш
  }, [noteSel.selection, folderSel.selection, batchTrash, clearAll]);

  // Delete / Backspace удаляют всё, что сейчас выделено. Игнорим, пока пишут в
  // input/textarea/contenteditable, чтобы не перебивать хоткеи редактора.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isEditing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void handleBulkTrash();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, handleBulkTrash]);

  // Страховка для подсветки цели дропа: HTML5 `dragleave` врёт, когда курсор
  // быстро бегает между детьми, упирается в край окна или драг кончается без
  // финального leave (дроп мимо любой цели, отмена через Esc). А вот `dragend`
  // (стреляет на источнике после любого конца драга) и `drop` (где угодно в
  // документе) надёжно ловят конец сессии, по любому из них гасим подсветку.
  useEffect(() => {
    const clear = () => setRootDragOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  // Мемоизируем контекст, чтобы дочерние строки не перерисовывались просто
  // потому что перерисовался родитель. Всё ниже либо стабильно (экшены Zustand
  // плюс useCallback), либо меняется только при смене выделения.
  const noteSelHas = useCallback(
    (id: string) => noteSel.selection.has(id),
    [noteSel.selection],
  );
  const folderSelHas = useCallback(
    (path: string) => folderSel.selection.has(path),
    [folderSel.selection],
  );

  // Всё мультивыделение как payload для драга. Мемоизируем (а не пишем в ref
  // во время рендера, это антипаттерн), чтобы пересобиралось только при реальной
  // смене выделения. Нужно, когда тащим строку, которая сама в выделении.
  const selectionItems = useMemo<DragItem[]>(
    () => [
      ...Array.from(folderSel.selection).map(
        (path) => ({ kind: "folder", path }) satisfies DragItem,
      ),
      ...Array.from(noteSel.selection).map(
        (id) => ({ kind: "note", id }) satisfies DragItem,
      ),
    ],
    [folderSel.selection, noteSel.selection],
  );

  const noteDragItems = useCallback(
    (id: string): DragItem[] =>
      noteSel.selection.has(id) && selectionItems.length > 1
        ? selectionItems
        : [{ kind: "note", id }],
    [noteSel.selection, selectionItems],
  );

  const folderDragItems = useCallback(
    (path: string): DragItem[] =>
      folderSel.selection.has(path) && selectionItems.length > 1
        ? selectionItems
        : [{ kind: "folder", path }],
    [folderSel.selection, selectionItems],
  );

  // Общий конвейер перемещения (`applyTreeDrop` из lib/dnd), тот же, что и в
  // FilesView. Снимаем выделение, только если драг шёл из него, так что таща
  // невыделенную строку мимо чужого выделения, его не трогаем.
  const handleDrop = useCallback(
    async (rawItems: DragItem[], dest: string) => {
      const draggedSelection = await applyTreeDrop(rawItems, dest, {
        moveFolder,
        moveNote,
        isSelected: (it) =>
          it.kind === "note"
            ? noteSel.selection.has(it.id)
            : folderSel.selection.has(it.path),
      });
      if (draggedSelection) clearAll();
    },
    [moveFolder, moveNote, clearAll, noteSel.selection, folderSel.selection],
  );

  const ctx = useMemo<TreeCtx>(
    () => ({
      noteSelHas,
      folderSelHas,
      toggleNote: noteSel.toggle,
      toggleFolder: folderSel.toggle,
      selecting,
      openMenu,
      bulkTrash: handleBulkTrash,
      selCount: noteSel.size + folderSel.size,
      noteDragItems,
      folderDragItems,
      handleDrop,
    }),
    [
      noteSelHas,
      folderSelHas,
      noteSel.toggle,
      folderSel.toggle,
      selecting,
      openMenu,
      handleBulkTrash,
      noteSel.size,
      folderSel.size,
      noteDragItems,
      folderDragItems,
      handleDrop,
    ],
  );

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setRootDragOver(false);
    const items = decodeDrag(e.dataTransfer);
    if (items.length === 0) return;
    try {
      await handleDrop(items, "");
    } catch (err) {
      console.error("FolderTree: root drop failed:", err);
    }
  };

  return (
    <TreeContext.Provider value={ctx}>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-zinc-600">
            {t("Файлы")}
          </span>
          <div className="flex items-center gap-0.5">
            <IconBtn title={t("Новая папка")} onClick={() => startCreateFolder("")}>
              <FolderPlus size={13} strokeWidth={2} />
            </IconBtn>
            <IconBtn title={t("Новая заметка")} onClick={() => startCreateNote("")}>
              <FilePlus size={13} strokeWidth={2} />
            </IconBtn>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setRootDragOver(true);
          }}
          onDragLeave={(e) => {
            // `target === currentTarget` слишком строго: когда курсор уходит
            // из зоны дропа прямо с дочернего элемента (FolderRow, NoteRow и
            // т.п.), `target` у dragleave это тот ребёнок, а не мы, проверка
            // не сработает и подсветка залипнет. Берём реальные координаты
            // курсора и наш bounding rect: если курсор правда снаружи, гасим
            // подсветку, неважно с какого ребёнка всплыло событие.
            const rect = e.currentTarget.getBoundingClientRect();
            const outside =
              e.clientX < rect.left ||
              e.clientX >= rect.right ||
              e.clientY < rect.top ||
              e.clientY >= rect.bottom;
            if (outside) setRootDragOver(false);
          }}
          onDrop={handleRootDrop}
          className={cn(
            "flex-1 overflow-y-auto px-1 pb-2 transition-colors",
            rootDragOver && "bg-[var(--color-accent-bg)]/30",
          )}
        >
          {creatingFolderIn === "" && (
            <InlineCreator kind="folder" parent="" depth={0} />
          )}
          {creatingNoteIn === "" && (
            <InlineCreator kind="note" parent="" depth={0} />
          )}

          {tree.length === 0 &&
          creatingFolderIn !== "" &&
          creatingNoteIn !== "" ? (
            <div className="px-4 py-12 text-[12px] text-zinc-600 text-center leading-relaxed">
              {t("Здесь будут твои заметки.")}
              <br />
              <span className="text-zinc-700">{t("Нажми + чтобы начать")}</span>
            </div>
          ) : (
            tree.map((node) => (
              <TreeNodeView key={nodeKey(node)} node={node} depth={0} />
            ))
          )}
        </div>
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
      />
    </TreeContext.Provider>
  );
}

// ─── Рендеринг ─────────────────────────────────────────────────────────────

// Стабильные ключи (не по пути), чтобы переименование или перенос папки
// обновлял строки на месте, а не перемонтировал всё поддерево (моргало бы).
// См. lib/treeKeys.ts.
function nodeKey(node: TreeNode): string {
  return node.kind === "folder"
    ? stableKey(node.path)
    : stableKey(node.note.id);
}

function TreeNodeView({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.kind === "folder") return <FolderRow node={node} depth={depth} />;
  return <NoteRow note={node.note} depth={depth} />;
}

function FolderRow({
  node,
  depth,
}: {
  node: Extract<TreeNode, { kind: "folder" }>;
  depth: number;
}) {
  const expanded = useNotesStore((s) => s.expandedFolders.has(node.path));
  const toggle = useNotesStore((s) => s.toggleFolder);
  const startCreateFolder = useNotesStore((s) => s.startCreateFolder);
  const deleteFolder = useNotesStore((s) => s.deleteFolder);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const setFolderColor = useNotesStore((s) => s.setFolderColor);
  const folderColor = useNotesStore((s) => s.folderColors[node.path] ?? null);
  const expandFolder = useNotesStore((s) => s.expandFolder);
  const startCreateNote = useNotesStore((s) => s.startCreateNote);
  const creatingFolderHere = useNotesStore(
    (s) => s.creatingFolderIn === node.path,
  );
  const creatingNoteHere = useNotesStore(
    (s) => s.creatingNoteIn === node.path,
  );

  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const ctx = useTreeCtx();
  const selected = ctx.folderSelHas(node.path);

  const handleAddNote = (e: React.MouseEvent) => {
    e.stopPropagation();
    startCreateNote(node.path);
  };
  const handleAddFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    startCreateFolder(node.path);
  };
  const handleDeleteInline = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirmDialog(`Удалить папку "${node.name}" со всем содержимым?`)) {
      try {
        await deleteFolder(node.path);
      } catch (err) {
        reportError(t("Не удалось удалить папку"), "FolderTree: delete folder failed:", err);
      }
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if (renaming) return;
    if (e.ctrlKey || e.metaKey || ctx.selecting) {
      e.preventDefault();
      ctx.toggleFolder(node.path);
      return;
    }
    toggle(node.path);
  };

  // Если папка не входит в текущее мультивыделение, опасный пункт меню бьёт
  // только по ней одной, чужое выделение где-то ещё не трогаем.
  const onContextMenu = (e: React.MouseEvent) => {
    const targetingSelection = selected && ctx.selCount > 1;
    ctx.openMenu(e, [
      {
        kind: "item",
        label: expanded ? t("Свернуть") : t("Раскрыть"),
        icon: expanded ? ChevronRight : FolderOpen,
        onClick: () => toggle(node.path),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("Новая заметка"),
        icon: FilePlus,
        onClick: () => startCreateNote(node.path),
      },
      {
        kind: "item",
        label: t("Новая папка"),
        icon: FolderPlus,
        onClick: () => startCreateFolder(node.path),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: t("Переименовать"),
        icon: Pencil,
        onClick: () => setRenaming(true),
      },
      {
        kind: "swatches",
        label: t("Цвет папки"),
        colors: FOLDER_COLORS.map((c) => c.hex),
        active: folderColor,
        onPick: (color) => void setFolderColor(node.path, color),
      },
      { kind: "separator" },
      {
        kind: "item",
        label: targetingSelection
          ? `Удалить выделенные (${ctx.selCount})`
          : "Удалить",
        icon: Trash2,
        danger: true,
        onClick: async () => {
          if (targetingSelection) {
            await ctx.bulkTrash();
          } else if (
            await confirmDialog(t("Удалить папку \"{name}\" со всем содержимым?", { name: node.name }))
          ) {
            await deleteFolder(node.path);
          }
        },
      },
    ]);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    // Строка папки лежит ВНУТРИ корневой зоны дропа. Без stopPropagation один
    // дроп выстрелит и тут (dest = эта папка), и в корневом хендлере (dest = ""
    // = корень), а это два параллельных moveNote, которые гонятся. Первый
    // переносит файл, второй его уже не находит ("os error 2"), и заметка может
    // вообще уехать в корень. Один дроп = ровно одна цель.
    e.stopPropagation();
    setDragOver(false);
    const items = decodeDrag(e.dataTransfer);
    if (items.length === 0) return;
    try {
      await ctx.handleDrop(items, node.path);
      // Раскрываем папку-цель, чтобы было видно, что дроп долетел.
      expandFolder(node.path);
    } catch (err) {
      reportError(t("Не удалось переместить"), "FolderTree: drop into folder failed:", err);
    }
  };

  return (
    <div>
      <div
        draggable={!renaming}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragStart={(e) =>
          setDragData(e.dataTransfer, ctx.folderDragItems(node.path), {
            label: node.name,
            meta: t("Папка"),
          })
        }
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "group flex items-center gap-1 px-1.5 py-1 cursor-pointer rounded-md text-[13px] transition-colors",
          selected || dragOver
            ? "bg-[var(--color-accent-bg)] text-white ring-1 ring-inset ring-[var(--color-accent-border)]"
            : "hover:bg-white/[0.04] text-zinc-400",
        )}
        style={{
          paddingLeft: FOLDER_ROW_PAD_LEFT_PX + depth * DEPTH_INDENT_PX,
        }}
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className="text-zinc-600 flex items-center"
        >
          <ChevronRight size={11} strokeWidth={2.4} />
        </motion.div>
        {expanded ? (
          <FolderOpen
            size={13}
            strokeWidth={1.8}
            className="text-[var(--color-accent)]/80"
            style={folderColor ? { color: folderColor } : undefined}
          />
        ) : (
          <Folder
            size={13}
            strokeWidth={1.8}
            className="text-zinc-500"
            style={folderColor ? { color: folderColor } : undefined}
          />
        )}
        {renaming ? (
          <RenameInput
            initial={node.name}
            onCommit={(v) => {
              setRenaming(false);
              void renameFolder(node.path, v);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="truncate flex-1 ml-0.5">{node.name}</span>
        )}
        <AnimatePresence>
          {hovered && !renaming && (
            <motion.span
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 4 }}
              transition={{ duration: 0.12 }}
              className="flex items-center gap-0.5"
            >
              <IconBtn title={t("Новая заметка")} onClick={handleAddNote} small>
                <FilePlus size={11} strokeWidth={2} />
              </IconBtn>
              <IconBtn title={t("Новая папка")} onClick={handleAddFolder} small>
                <FolderPlus size={11} strokeWidth={2} />
              </IconBtn>
              <IconBtn
                title={t("Переименовать")}
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming(true);
                }}
                small
              >
                <Pencil size={11} strokeWidth={2} />
              </IconBtn>
              <IconBtn title={t("Удалить")} onClick={handleDeleteInline} small danger>
                <Trash2 size={11} strokeWidth={2} />
              </IconBtn>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            {creatingFolderHere && (
              <InlineCreator
                kind="folder"
                parent={node.path}
                depth={depth + 1}
              />
            )}
            {creatingNoteHere && (
              <InlineCreator kind="note" parent={node.path} depth={depth + 1} />
            )}
            {node.children.map((child) => (
              <TreeNodeView key={nodeKey(child)} node={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NoteRow({
  note,
  depth,
}: {
  note: { id: string; title: string; favorite?: boolean };
  depth: number;
}) {
  // Производный булев селектор: NoteRow перерисовывается, только когда меняется
  // ЕГО собственный active, а не на каждую смену activeId по всему дереву (с
  // одной грубой подпиской на `activeId` перерисовывались все строки на каждом
  // переключении заметки).
  const active = useNotesStore(
    (s) => s.view === "notes" && s.activeId === note.id,
  );
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);
  const trashNote = useNotesStore((s) => s.trashNote);
  const toggleFavorite = useNotesStore((s) => s.toggleFavorite);
  const renameNote = useNotesStore((s) => s.renameNote);
  const openVersionHistory = useNotesStore((s) => s.openVersionHistory);

  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const ctx = useTreeCtx();
  const selected = ctx.noteSelHas(note.id);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await trashNote(note.id);
      useToastStore
        .getState()
        .push(t("«{title}» в корзине", { title: note.title || t("Без названия") }), "success");
    } catch (err) {
      console.error("FolderTree: trash note failed:", err);
      useToastStore
        .getState()
        .push(t("Не удалось переместить в корзину"), "error");
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const targetingSelection = selected && ctx.selCount > 1;
    ctx.openMenu(e, [
      {
        kind: "item",
        label: t("Открыть"),
        icon: FileText,
        onClick: () => {
          setView("notes");
          void selectNote(note.id);
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        label: note.favorite ? t("Убрать из избранного") : t("В избранное"),
        icon: Star,
        onClick: () => toggleFavorite(note.id),
      },
      {
        kind: "item",
        label: t("Переименовать"),
        icon: Pencil,
        onClick: () => setRenaming(true),
      },
      {
        kind: "item",
        label: t("История версий"),
        icon: History,
        onClick: () => openVersionHistory(note.id),
      },
      {
        kind: "item",
        label: t("Экспорт в Markdown"),
        icon: Download,
        onClick: async () => {
          try {
            const saved = await exportNoteMarkdown(note);
            if (saved) {
              useToastStore
                .getState()
                .push(t("Заметка экспортирована"), "success");
            }
          } catch (err) {
            console.error("export note failed:", err);
              useToastStore.getState().push(t("Не удалось экспортировать"), "error");
          }
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        label: targetingSelection
          ? t("Удалить выделенные ({count})", { count: ctx.selCount })
          : t("В корзину"),
        icon: Trash2,
        danger: true,
        onClick: async () => {
          if (targetingSelection) await ctx.bulkTrash();
          else await trashNote(note.id);
        },
      },
    ]);
  };

  const onClick = (e: React.MouseEvent) => {
    if (renaming) return;
    if (e.ctrlKey || e.metaKey || ctx.selecting) {
      e.preventDefault();
      ctx.toggleNote(note.id);
      return;
    }
    setView("notes");
    void selectNote(note.id);
  };

  return (
    <div>
      <div
        draggable={!renaming}
        onDragStart={(e) => {
          setDragData(e.dataTransfer, ctx.noteDragItems(note.id), {
            label: note.title || DEFAULT_NOTE_TITLE,
          });
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "group relative flex items-center gap-1.5 px-1.5 py-1 cursor-pointer text-[13px] rounded-md transition-colors select-none",
          selected || active
            ? "bg-[var(--color-accent-bg)] text-white ring-1 ring-inset ring-[var(--color-accent-border)]"
            : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200",
          dragging && "opacity-40",
        )}
        style={{ paddingLeft: NOTE_ROW_PAD_LEFT_PX + depth * DEPTH_INDENT_PX }}
      >
        <FileText
          size={12}
          strokeWidth={1.8}
          className={cn(
            "shrink-0 transition-colors",
            active ? "text-[var(--color-accent)]" : "text-zinc-600",
          )}
        />
        {renaming ? (
          <RenameInput
            initial={note.title}
            onCommit={(v) => {
              setRenaming(false);
              void renameNote(note.id, v);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="truncate flex-1">
            {note.title || DEFAULT_NOTE_TITLE}
          </span>
        )}
        <AnimatePresence>
          {hovered && !renaming && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex items-center"
            >
              <IconBtn
                title={t("Переименовать")}
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming(true);
                }}
                small
              >
                <Pencil size={11} strokeWidth={2} />
              </IconBtn>
              <IconBtn title={t("В корзину")} onClick={handleDelete} small danger>
                <Trash2 size={11} strokeWidth={2} />
              </IconBtn>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function InlineCreator({
  kind,
  parent,
  depth,
}: {
  kind: "note" | "folder";
  parent: string;
  depth: number;
}) {
  const createNote = useNotesStore((s) => s.createNote);
  const createFolder = useNotesStore((s) => s.createFolder);
  const cancelCreateNote = useNotesStore((s) => s.cancelCreateNote);
  const cancelCreateFolder = useNotesStore((s) => s.cancelCreateFolder);

  const isNote = kind === "note";
  const createFn = isNote ? createNote : createFolder;
  const cancelFn = isNote ? cancelCreateNote : cancelCreateFolder;

  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef("");
  valueRef.current = value;

  // На маунте фокусим input и вешаем обработчик клика снаружи. setTimeout
  // нужен, чтобы тот самый клик, который открыл создание, сразу же его не
  // закрыл (мелкая гонка: иначе слушатель счёл бы клик по кнопке за "снаружи").
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        const trimmed = valueRef.current.trim();
        if (trimmed) void createFn(parent, trimmed);
        else cancelFn();
      }
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
    }, CLICK_OUTSIDE_GUARD_MS);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
    };
  }, [parent, createFn, cancelFn]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      cancelFn();
      return;
    }
    try {
      await createFn(parent, trimmed);
    } catch (e) {
      reportError(
        kind === "note" ? t("Не удалось создать заметку") : t("Не удалось создать папку"),
        `FolderTree: create ${kind} failed:`,
        e,
      );
      cancelFn();
    }
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}
      className={cn(
        "flex items-center px-1.5 py-1 text-[13px] overflow-hidden",
        isNote ? "gap-1.5" : "gap-1",
      )}
      style={{
        paddingLeft:
          (isNote ? NOTE_ROW_PAD_LEFT_PX : FOLDER_ROW_PAD_LEFT_PX) +
          depth * DEPTH_INDENT_PX,
      }}
    >
      {isNote ? (
        <FileText
          size={12}
          strokeWidth={1.8}
          className="text-[var(--color-accent)]/80"
        />
      ) : (
        <>
          <ChevronRight
            size={11}
            strokeWidth={2.4}
            className="text-zinc-700"
          />
          <Folder
            size={13}
            strokeWidth={1.8}
            className="text-[var(--color-accent)]/70"
          />
        </>
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelFn();
          }
        }}
        placeholder={isNote ? t("Имя заметки") : t("Имя папки")}
        className={cn(
          "flex-1 bg-white/[0.04] text-zinc-100 px-2 py-0.5 rounded outline-none ring-1 ring-inset ring-[var(--color-accent-border)] focus:bg-white/[0.06] placeholder-zinc-600 text-[13px]",
          !isNote && "ml-0.5",
        )}
      />
    </motion.div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  // Защита от двойного срабатывания Enter (коммит), потом blur (опять коммит):
  // как только разрулили (коммит или отмена), input размонтируется, и его blur
  // должен быть пустышкой.
  const doneRef = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = value.trim();
    if (commit && trimmed) onCommit(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      className="flex-1 min-w-0 ml-0.5 bg-white/[0.06] text-zinc-100 px-1.5 py-0.5 rounded outline-none ring-1 ring-inset ring-[var(--color-accent-border)] text-[13px]"
    />
  );
}

function IconBtn({
  children,
  onClick,
  title,
  small,
  danger,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  small?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "rounded transition-all duration-150",
        small ? "p-1" : "p-1.5",
        danger
          ? "text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
          : "text-zinc-600 hover:text-zinc-100 hover:bg-white/[0.06]",
      )}
    >
      {children}
    </button>
  );
}
