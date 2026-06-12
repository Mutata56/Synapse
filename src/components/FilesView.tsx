import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  FilePlus,
  Folder as FolderIcon,
  FolderPlus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelection } from "../hooks/useSelection";
import { cn } from "../lib/cn";
import {
  applyTreeDrop,
  decodeDrag,
  setDragData,
  type DragItem,
} from "../lib/dnd";
import { pluralRu } from "../lib/format";
import { t } from "../lib/i18n";
import type { TreeNode } from "../lib/storage";
import {
  countContents,
  findFolderByPath,
  type FolderNode,
} from "../lib/treeUtils";
import { confirmDialog } from "../store/confirm";
import { reportError, useNotesStore } from "../store/notes";
import { Breadcrumbs } from "./Breadcrumbs";
import { BulkActionBar } from "./BulkActionBar";
import { NoteCard } from "./NoteCard";

type NoteNode = Extract<TreeNode, { kind: "note" }>;

const FOLDER_GRID_CLASS =
  "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3";
const NOTE_GRID_CLASS =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4";
const SECTION_HEADER_CLASS =
  "text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3";
const CLICK_OUTSIDE_GUARD_MS = 200;
const FOLDER_CARD_EASE = [0.16, 1, 0.3, 1] as const;

// ─── Вью ──────────────────────────────────────────────────────────────────

export function FilesView() {
  const tree = useNotesStore((s) => s.tree);
  const currentFolder = useNotesStore((s) => s.currentFolder);
  const setCurrentFolder = useNotesStore((s) => s.setCurrentFolder);
  const setView = useNotesStore((s) => s.setView);
  const selectNote = useNotesStore((s) => s.selectNote);
  const startCreateNote = useNotesStore((s) => s.startCreateNote);
  const startCreateFolder = useNotesStore((s) => s.startCreateFolder);
  const creatingNoteHere = useNotesStore(
    (s) => s.creatingNoteIn === currentFolder,
  );
  const creatingFolderHere = useNotesStore(
    (s) => s.creatingFolderIn === currentFolder,
  );
  const trashNote = useNotesStore((s) => s.trashNote);
  const batchTrash = useNotesStore((s) => s.batchTrash);
  const deleteFolder = useNotesStore((s) => s.deleteFolder);
  const moveNote = useNotesStore((s) => s.moveNote);
  const moveFolder = useNotesStore((s) => s.moveFolder);

  const noteSel = useSelection<string>();
  const folderSel = useSelection<string>();
  const selecting = noteSel.isSelecting || folderSel.isSelecting;
  const totalSelected = noteSel.size + folderSel.size;

  const clearAll = useCallback(() => {
    noteSel.clear();
    folderSel.clear();
  }, [noteSel.clear, folderSel.clear]);

  // Снимок текущего выделения как DragItem[], отдаём карточкам через
  // `getDragItems()`. Карточка, которая сама в выделении, тащит весь набор,
  // иначе едет одна. useRef плюс синхронное обновление держат чтение на
  // dragstart за O(1) и не перерисовывают все карточки на каждую смену выделения.
  const selectionItemsRef = useRef<DragItem[]>([]);
  selectionItemsRef.current = [
    ...Array.from(folderSel.selection).map(
      (path) => ({ kind: "folder", path }) satisfies DragItem,
    ),
    ...Array.from(noteSel.selection).map(
      (id) => ({ kind: "note", id }) satisfies DragItem,
    ),
  ];

  const noteDragItems = useCallback(
    (id: string): DragItem[] =>
      noteSel.has(id) && selectionItemsRef.current.length > 1
        ? selectionItemsRef.current
        : [{ kind: "note", id }],
    [noteSel],
  );

  const folderDragItems = useCallback(
    (path: string): DragItem[] =>
      folderSel.has(path) && selectionItemsRef.current.length > 1
        ? selectionItemsRef.current
        : [{ kind: "folder", path }],
    [folderSel],
  );

  /**
   * Применяет дроп в `dest` пачкой. Папки идут первыми, чтобы заметку, которая
   * лежала внутри перенесённой папки, не перебазировать дважды. Ошибки по
   * элементам логируем, но остаток пачки не роняем.
   *
   * Снимаем выделение, только если драг реально нёс выделенные элементы (так
   * мультидраг и тащит весь набор). Таща невыделенную карточку мимо чужого
   * выделения, его НЕ стираем, переехала только она сама.
   *
   * Зачем вообще снимать: у переехавших id меняется форма (префикс папки), и
   * счётчик BulkActionBar с подсветкой карточек указывали бы на id, которых в
   * дереве уже нет.
   */
  const handleDrop = useCallback(
    async (rawItems: DragItem[], dest: string) => {
      const draggedSelection = await applyTreeDrop(rawItems, dest, {
        moveFolder,
        moveNote,
        isSelected: (it) =>
          it.kind === "note" ? noteSel.has(it.id) : folderSel.has(it.path),
      });
      if (draggedSelection) clearAll();
    },
    [moveFolder, moveNote, clearAll, noteSel, folderSel],
  );

  const contents = useMemo(
    () => findFolderByPath(tree, currentFolder) ?? [],
    [tree, currentFolder],
  );

  const folders = useMemo(
    () => contents.filter((n): n is FolderNode => n.kind === "folder"),
    [contents],
  );

  const notes = useMemo(
    () =>
      contents
        .filter((n): n is NoteNode => n.kind === "note")
        .map((n) => n.note)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [contents],
  );

  const handleBulkTrash = async () => {
    const noteIds = Array.from(noteSel.selection);
    const folderPaths = Array.from(folderSel.selection);
    const total = noteIds.length + folderPaths.length;
    if (!total) return;
    const word = pluralRu(total, t("элемент"), t("элемента"), t("элементов"));
    if (!(await confirmDialog(t("Переместить {count} в корзину?", { count: `${total} ${word}` }), { confirmLabel: t("В корзину") }))) return;

    // Сразу чистим выделение (и прячем бар), удаление крутится на уже
    // захваченных массивах id/path, так что это безопасно и ощущается мгновенно.
    clearAll();
    // Оптимистично выкидываем карточки из стора разом, переносы по ФС и один
    // рефреш доезжают в фоне.
    await batchTrash(noteIds, folderPaths);
  };

  const enterFolder = (path: string) => {
    setCurrentFolder(path);
    clearAll();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 border-b border-[var(--color-border)]">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Breadcrumbs
              path={currentFolder}
              onNavigate={enterFolder}
              onDrop={(items, dest) => handleDrop(items, dest)}
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => startCreateFolder(currentFolder)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors font-medium"
            >
              <FolderPlus size={13} strokeWidth={2} />
              {t("Папка")}
            </button>
            <button
              type="button"
              onClick={() => startCreateNote(currentFolder)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] text-white bg-[var(--color-accent)] hover:bg-indigo-500 transition-colors font-medium shadow-lg shadow-indigo-500/20"
            >
              <FilePlus size={13} strokeWidth={2} />
              {t("Заметка")}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-7xl mx-auto">
        <AnimatePresence>
          {(creatingNoteHere || creatingFolderHere) && (
            <InlineCreators
              parent={currentFolder}
              creatingNote={creatingNoteHere}
              creatingFolder={creatingFolderHere}
            />
          )}
        </AnimatePresence>

        {contents.length === 0 && !creatingNoteHere && !creatingFolderHere ? (
          <EmptyState />
        ) : (
          <>
            {folders.length > 0 && (
              <section className="mb-8">
                <h3 className={SECTION_HEADER_CLASS}>
                  {t("Папки")} · {folders.length}
                </h3>
                <div className={FOLDER_GRID_CLASS}>
                  {folders.map((folder) => (
                    <FolderCard
                      key={folder.path}
                      folder={folder}
                      onEnter={() => enterFolder(folder.path)}
                      selected={folderSel.has(folder.path)}
                      selecting={selecting}
                      onToggleSelect={() => folderSel.toggle(folder.path)}
                      onDelete={async () => {
                        if (
                          await confirmDialog(
                            t("Удалить папку \"{name}\" со всем содержимым?", { name: folder.name }),
                          )
                        ) {
                          try {
                            await deleteFolder(folder.path);
                          } catch (err) {
                            console.error(
                              "FilesView: delete folder failed:",
                              err,
                            );
                          }
                        }
                      }}
                      onDrop={(items) => handleDrop(items, folder.path)}
                      getDragItems={() => folderDragItems(folder.path)}
                    />
                  ))}
                </div>
              </section>
            )}

            {notes.length > 0 && (
              <section>
                <h3 className={SECTION_HEADER_CLASS}>
                  {t("Заметки")} · {notes.length}
                </h3>
                <div className={NOTE_GRID_CLASS}>
                  {notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      draggable
                      animateIn={false}
                      onOpen={() => {
                        setView("notes");
                        void selectNote(note.id);
                      }}
                      onTrash={() => void trashNote(note.id)}
                      selected={noteSel.has(note.id)}
                      selecting={selecting}
                      onToggleSelect={() => noteSel.toggle(note.id)}
                      getDragItems={() => noteDragItems(note.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        </div>
      </div>

      <BulkActionBar
        count={totalSelected}
        total={notes.length + folders.length}
        onClear={clearAll}
        onSelectAll={() => {
          noteSel.selectAll(notes.map((n) => n.id));
          folderSel.selectAll(folders.map((f) => f.path));
        }}
        actions={[
          {
            id: "trash",
            label: t("В корзину"),
            icon: Trash2,
            variant: "danger",
            onClick: handleBulkTrash,
          },
        ]}
      />
    </div>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-zinc-600 text-sm text-center py-24"
    >
      {t("Папка пуста. Создай заметку или подпапку выше.")}
    </motion.div>
  );
}

function FolderCard({
  folder,
  onEnter,
  onDelete,
  onDrop,
  getDragItems,
  selected,
  selecting,
  onToggleSelect,
}: {
  folder: FolderNode;
  onEnter: () => void;
  onDelete: () => void;
  onDrop: (items: DragItem[]) => void | Promise<void>;
  getDragItems: () => DragItem[];
  selected: boolean;
  selecting: boolean;
  onToggleSelect: () => void;
}) {
  const stats = useMemo(
    () => countContents(folder.children),
    [folder.children],
  );
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const folderColor = useNotesStore((s) => s.folderColors[folder.path] ?? null);

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || selecting) {
      e.preventDefault();
      onToggleSelect();
      return;
    }
    onEnter();
  };

  // Внутри карточки вложенные `<button>` (FolderSelectCheckbox плюс
  // необязательная кнопка удаления), так что сам внешний элемент кнопкой быть
  // не может, HTML запрещает вложенные интерактивные элементы. Прикручиваем
  // кнопочную семантику клавиатуры к `motion.div`: role, tabIndex, Enter/Space.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEnter();
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = decodeDrag(e.dataTransfer);
    if (items.length === 0) return;
    try {
      await onDrop(items);
    } catch (err) {
      reportError(t("Не удалось переместить"), "FilesView: folder card drop failed:", err);
    }
  };

  const accent = selected || dragOver;

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: FOLDER_CARD_EASE }}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={onEnter}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      draggable
      // framer-motion типизирует onDragStart под свои pan-жесты, но с
      // `draggable` в рантайме прилетает настоящий HTML5 DragEvent.
      onDragStart={(e) =>
        setDragData(
          (e as unknown as React.DragEvent<HTMLDivElement>).dataTransfer,
          getDragItems(),
          { label: folder.name, meta: t("Папка") },
        )
      }
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "group relative cursor-pointer rounded-xl border p-4 flex items-center gap-3 transition-colors",
        "outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-border)]",
        accent
          ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] ring-1 ring-[var(--color-accent-border)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)]",
      )}
      title={t("Открыть папку")}
    >
      <FolderSelectCheckbox
        selected={selected}
        selecting={selecting}
        onToggle={onToggleSelect}
      />

      <div className="w-10 h-10 rounded-lg bg-[var(--color-accent-bg)] ring-1 ring-inset ring-[var(--color-accent-border)] flex items-center justify-center shrink-0">
        <FolderIcon
          size={18}
          strokeWidth={1.8}
          className="text-[var(--color-accent)]"
          style={folderColor ? { color: folderColor } : undefined}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-zinc-100 truncate">
          {folder.name}
        </div>
        <FolderStats stats={stats} />
      </div>

      {hovered && !selecting && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title={t("Удалить папку")}
          aria-label={t("Удалить папку")}
          className="p-1.5 rounded-md text-zinc-600 hover:text-red-300 hover:bg-red-500/10 transition-colors shrink-0"
        >
          <Trash2 size={12} strokeWidth={2} />
        </button>
      )}
    </motion.div>
  );
}

function FolderSelectCheckbox({
  selected,
  selecting,
  onToggle,
}: {
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={selected ? t("Снять выделение") : t("Выделить")}
      aria-label={selected ? t("Снять выделение") : t("Выделить")}
      aria-pressed={selected}
      className={cn(
        "absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-md flex items-center justify-center transition-all",
        selected
          ? "bg-[var(--color-accent)] text-white opacity-100"
          : "bg-black/40 backdrop-blur text-transparent border border-white/20 opacity-0 group-hover:opacity-100 hover:border-white/50",
        selecting && !selected && "opacity-100",
      )}
    >
      {selected && <Check size={12} strokeWidth={3} />}
    </button>
  );
}

function FolderStats({
  stats,
}: {
  stats: { folders: number; notes: number };
}) {
  if (stats.folders === 0 && stats.notes === 0) {
    return <div className="text-[11px] text-zinc-500 mt-0.5">{t("пусто")}</div>;
  }
  const parts: string[] = [];
  if (stats.folders > 0) {
    parts.push(
      `${stats.folders} ${pluralRu(stats.folders, "папка", "папки", "папок")}`,
    );
  }
  if (stats.notes > 0) {
    parts.push(
      `${stats.notes} ${pluralRu(stats.notes, "заметка", "заметки", "заметок")}`,
    );
  }
  return (
    <div className="text-[11px] text-zinc-500 mt-0.5">{parts.join(" · ")}</div>
  );
}

function InlineCreators({
  parent,
  creatingNote,
  creatingFolder,
}: {
  parent: string;
  creatingNote: boolean;
  creatingFolder: boolean;
}) {
  const createNote = useNotesStore((s) => s.createNote);
  const cancelCreateNote = useNotesStore((s) => s.cancelCreateNote);
  const createFolder = useNotesStore((s) => s.createFolder);
  const cancelCreateFolder = useNotesStore((s) => s.cancelCreateFolder);

  const noteRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [noteVal, setNoteVal] = useState("");
  const [folderVal, setFolderVal] = useState("");
  const noteValRef = useRef("");
  const folderValRef = useRef("");
  noteValRef.current = noteVal;
  folderValRef.current = folderVal;

  useEffect(() => {
    if (creatingNote) requestAnimationFrame(() => noteRef.current?.focus());
  }, [creatingNote]);

  useEffect(() => {
    if (creatingFolder)
      requestAnimationFrame(() => folderRef.current?.focus());
  }, [creatingFolder]);

  // Один обработчик клика снаружи на весь документ для обоих инпутов. Задержка
  // 200ms не даёт тому клику, что всё открыл, тут же дёрнуть обработчик.
  useEffect(() => {
    if (!creatingNote && !creatingFolder) return;
    const onDown = (e: MouseEvent) => {
      if (
        !containerRef.current ||
        containerRef.current.contains(e.target as Node)
      ) {
        return;
      }
      if (creatingNote) {
        const t = noteValRef.current.trim();
        if (t) void createNote(parent, t);
        else cancelCreateNote();
      }
      if (creatingFolder) {
        const t = folderValRef.current.trim();
        if (t) void createFolder(parent, t);
        else cancelCreateFolder();
      }
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
    }, CLICK_OUTSIDE_GUARD_MS);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
    };
  }, [
    creatingNote,
    creatingFolder,
    parent,
    createNote,
    cancelCreateNote,
    createFolder,
    cancelCreateFolder,
  ]);

  const submitNote = () => {
    const title = noteVal.trim();
    if (!title) {
      cancelCreateNote();
      return;
    }
    void createNote(parent, title);
  };

  const submitFolder = () => {
    const name = folderVal.trim();
    if (!name) {
      cancelCreateFolder();
      return;
    }
    void createFolder(parent, name);
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: FOLDER_CARD_EASE }}
      className="mb-6"
    >
      {creatingNote && (
        <CreatorRow
          kind="note"
          inputRef={noteRef}
          value={noteVal}
          onChange={setNoteVal}
          onSubmit={submitNote}
          onCancel={cancelCreateNote}
          spaceBelow={creatingFolder}
        />
      )}
      {creatingFolder && (
        <CreatorRow
          kind="folder"
          inputRef={folderRef}
          value={folderVal}
          onChange={setFolderVal}
          onSubmit={submitFolder}
          onCancel={cancelCreateFolder}
        />
      )}
    </motion.div>
  );
}

function CreatorRow({
  kind,
  inputRef,
  value,
  onChange,
  onSubmit,
  onCancel,
  spaceBelow,
}: {
  kind: "note" | "folder";
  inputRef: React.Ref<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  spaceBelow?: boolean;
}) {
  const isNote = kind === "note";
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-accent-border)]",
        spaceBelow && "mb-2",
      )}
    >
      {isNote ? (
        <FilePlus
          size={14}
          strokeWidth={2}
          className="text-[var(--color-accent)]"
        />
      ) : (
        <FolderPlus
          size={14}
          strokeWidth={2}
          className="text-[var(--color-accent)]"
        />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={isNote ? t("Название заметки") : t("Название папки")}
        className="flex-1 bg-transparent outline-none text-zinc-100 text-[14px] placeholder-zinc-600"
      />
      <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-500 font-mono">
        Enter
      </kbd>
    </div>
  );
}
