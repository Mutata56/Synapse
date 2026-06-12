import { motion } from "framer-motion";
import {
  Check,
  Folder as FolderIcon,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSelection } from "../hooks/useSelection";
import { cn } from "../lib/cn";
import { pluralRu } from "../lib/format";
import { t } from "../lib/i18n";
import type { NoteMeta, TreeNode } from "../lib/storage";
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
import { TrashPreviewModal } from "./TrashPreviewModal";

type NoteNode = Extract<TreeNode, { kind: "note" }>;

const FOLDER_GRID_CLASS =
  "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3";
const NOTE_GRID_CLASS =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4";
const SECTION_HEADER_CLASS =
  "text-[11px] uppercase tracking-wider font-semibold text-zinc-600 mb-3";
const FOLDER_CARD_EASE = [0.16, 1, 0.3, 1] as const;

// ─── Вью ──────────────────────────────────────────────────────────────────

export function TrashView() {
  const trashTree = useNotesStore((s) => s.trashTree);
  const refreshTrash = useNotesStore((s) => s.refreshTrash);
  const currentTrashFolder = useNotesStore((s) => s.currentTrashFolder);
  const setCurrentTrashFolder = useNotesStore((s) => s.setCurrentTrashFolder);
  const emptyTrash = useNotesStore((s) => s.emptyTrash);
  const restoreNote = useNotesStore((s) => s.restoreNote);
  const deleteForever = useNotesStore((s) => s.deleteForever);
  const batchRestore = useNotesStore((s) => s.batchRestoreTrash);
  const batchDelete = useNotesStore((s) => s.batchDeleteForever);

  const [preview, setPreview] = useState<NoteMeta | null>(null);
  // Защита для пакетных IPC-операций (восстановить / удалить навсегда /
  // очистить), чтобы двойной клик не запустил второй проход по тем же файлам.
  const [busy, setBusy] = useState(false);
  const sel = useSelection<string>();

  // Обновляем корзину на маунте вью. Tauri IPC может отвалиться (права, нет
  // папки до инициализации), показываем это, а не пускаем как unhandledrejection.
  useEffect(() => {
    let cancelled = false;
    refreshTrash().catch((err) => {
      if (!cancelled) console.error("TrashView: refreshTrash failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTrash]);

  const contents = useMemo(
    () => findFolderByPath(trashTree, currentTrashFolder) ?? [],
    [trashTree, currentTrashFolder],
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

  // Держим выделение в синхроне с тем, что реально на экране. Когда элементы
  // пропадают (очистили корзину или удалили/восстановили выделенное через
  // hover-кнопки), выкидываем их повисшие id, чтобы бар не торчал над пустотой.
  useEffect(() => {
    const visible = new Set<string>([
      ...folders.map((f) => f.path),
      ...notes.map((n) => n.id),
    ]);
    const live = Array.from(sel.selection).filter((id) => visible.has(id));
    if (live.length !== sel.selection.size) sel.selectAll(live);
  }, [folders, notes, sel.selection, sel.selectAll]);

  const enterFolder = (path: string) => {
    setCurrentTrashFolder(path);
    sel.clear();
  };

  const totalItems = useMemo(() => {
    const c = countContents(trashTree);
    return c.folders + c.notes;
  }, [trashTree]);

  // try/finally гарантирует, что выделение снимется и `busy` отпустится даже
  // если пакетная операция упадёт, иначе при ошибке остался бы висеть старый
  // чип "выделено N" (или навсегда залоченные кнопки).
  const handleBulkRestore = async () => {
    const ids = Array.from(sel.selection);
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      await batchRestore(ids);
    } catch (err) {
      reportError(t("Не удалось восстановить"), "TrashView: bulk restore failed:", err);
    } finally {
      sel.clear();
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(sel.selection);
    if (!ids.length || busy) return;
    const word = pluralRu(ids.length, "элемент", "элемента", "элементов");
    if (!(await confirmDialog(t(`Удалить ${ids.length} ${word} навсегда?`), { confirmLabel: t("Удалить навсегда") }))) return;
    setBusy(true);
    try {
      await batchDelete(ids);
    } catch (err) {
      reportError(t("Не удалось удалить"), "TrashView: bulk delete failed:", err);
    } finally {
      sel.clear();
      setBusy(false);
    }
  };

  const handleEmptyTrash = async () => {
    if (busy) return;
    if (!(await confirmDialog(t("Очистить корзину полностью?"), { confirmLabel: t("Очистить") }))) return;
    setBusy(true);
    try {
      await emptyTrash();
    } catch (err) {
      reportError(t("Не удалось очистить корзину"), "TrashView: emptyTrash failed:", err);
    } finally {
      sel.clear();
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 border-b border-[var(--color-border)]">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
              {t("Корзина")}
            </h2>
            <p className="text-[13px] text-zinc-500 mt-1">
              {totalItems === 0
                ? t("Пусто")
                : t(`Всего ${totalItems} ${pluralRu(
                    totalItems,
                    "элемент",
                    "элемента",
                    "элементов",
                  )}`)}
            </p>
          </div>
          {totalItems > 0 && (
            <button
              type="button"
              onClick={handleEmptyTrash}
              disabled={busy}
              className="text-[13px] text-red-400 hover:text-red-300 px-3 py-1.5 rounded-md hover:bg-red-500/10 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              {t("Очистить корзину")}
            </button>
          )}
        </div>

        <Breadcrumbs path={currentTrashFolder} onNavigate={enterFolder} />
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-7xl mx-auto">
        {contents.length === 0 ? (
          <EmptyState rooted={currentTrashFolder === ""} />
        ) : (
          <>
            {folders.length > 0 && (
              <section className="mb-8">
                <h3 className={SECTION_HEADER_CLASS}>
                  Папки · {folders.length}
                </h3>
                <div className={FOLDER_GRID_CLASS}>
                  {folders.map((folder) => (
                    <TrashFolderCard
                      key={folder.path}
                      folder={folder}
                      onEnter={() => enterFolder(folder.path)}
                      selected={sel.has(folder.path)}
                      selecting={sel.isSelecting}
                      onToggleSelect={() => sel.toggle(folder.path)}
                      onRestore={() => restoreNote(folder.path)}
                      onDelete={async () => {
                        if (
                          !(await confirmDialog(
                            `Удалить папку "${folder.name}" и всё внутри навсегда?`,
                            { confirmLabel: "Удалить навсегда" },
                          ))
                        ) {
                          return;
                        }
                        try {
                          await deleteForever(folder.path);
                        } catch (err) {
                          console.error(
                            "TrashView: delete folder forever failed:",
                            err,
                          );
                        }
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {notes.length > 0 && (
              <section>
                <h3 className={SECTION_HEADER_CLASS}>
                  Заметки · {notes.length}
                </h3>
                <div className={NOTE_GRID_CLASS}>
                  {notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      animateIn={false}
                      onOpen={() => setPreview(note)}
                      selected={sel.has(note.id)}
                      selecting={sel.isSelecting}
                      onToggleSelect={() => sel.toggle(note.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        </div>
      </div>

      <TrashPreviewModal note={preview} onClose={() => setPreview(null)} />

      <BulkActionBar
        count={sel.size}
        total={notes.length + folders.length}
        onClear={sel.clear}
        onSelectAll={() =>
          sel.selectAll([
            ...folders.map((f) => f.path),
            ...notes.map((n) => n.id),
          ])
        }
        actions={[
          {
            id: "restore",
            label: "Восстановить",
            icon: RotateCcw,
            variant: "primary",
            onClick: handleBulkRestore,
            disabled: busy,
          },
          {
            id: "delete",
            label: "Удалить навсегда",
            icon: Trash2,
            variant: "danger",
            onClick: handleBulkDelete,
            disabled: busy,
          },
        ]}
      />
    </div>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function EmptyState({ rooted }: { rooted: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-zinc-600 text-sm text-center py-24"
    >
      {rooted
        ? "Корзина пуста. Удалённые заметки и папки появятся здесь."
        : "Эта папка корзины пуста."}
    </motion.div>
  );
}

function TrashFolderCard({
  folder,
  onEnter,
  onRestore,
  onDelete,
  selected,
  selecting,
  onToggleSelect,
}: {
  folder: FolderNode;
  onEnter: () => void;
  onRestore: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  selected: boolean;
  selecting: boolean;
  onToggleSelect: () => void;
}) {
  const stats = useMemo(
    () => countContents(folder.children),
    [folder.children],
  );
  const [hovered, setHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || selecting) {
      e.preventDefault();
      onToggleSelect();
      return;
    }
    onEnter();
  };

  // Внутри карточки вложенные `<button>` (FolderSelectCheckbox плюс пара
  // восстановить/удалить), так что внешний элемент сам кнопкой быть не может,
  // HTML запрещает вложенные интерактивные элементы. Прикручиваем кнопочную
  // семантику клавиатуры к motion.div: role, tabIndex, Enter/Space.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEnter();
    }
  };

  const fireRestore = (e: React.MouseEvent) => {
    e.stopPropagation();
    Promise.resolve(onRestore()).catch((err) =>
      reportError("Не удалось восстановить", "TrashView: restore failed:", err),
    );
  };

  const fireDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    Promise.resolve(onDelete()).catch((err) =>
      reportError("Не удалось удалить", "TrashView: delete failed:", err),
    );
  };

  return (
    <motion.div
      layout
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
      transition={{ duration: 0.18, ease: FOLDER_CARD_EASE }}
      whileHover={{ y: -2 }}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={onEnter}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative cursor-pointer rounded-xl border transition-colors p-4 flex items-center gap-3",
        "outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-border)]",
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] ring-1 ring-[var(--color-accent-border)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)]",
      )}
    >
      <FolderSelectCheckbox
        selected={selected}
        selecting={selecting}
        onToggle={onToggleSelect}
      />

      <div className="w-10 h-10 rounded-lg bg-red-500/10 ring-1 ring-inset ring-red-500/20 flex items-center justify-center shrink-0">
        <FolderIcon size={18} strokeWidth={1.8} className="text-red-300" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-zinc-100 truncate">
          {folder.name}
        </div>
        <FolderStats stats={stats} />
      </div>

      {hovered && !selecting && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={fireRestore}
            title="Восстановить"
            aria-label="Восстановить"
            className="p-1.5 rounded-md text-zinc-500 hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-bg)] transition-colors"
          >
            <RotateCcw size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={fireDelete}
            title="Удалить навсегда"
            aria-label="Удалить навсегда"
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={12} strokeWidth={2} />
          </button>
        </div>
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
      title={selected ? "Снять выделение" : "Выделить"}
      aria-label={selected ? "Снять выделение" : "Выделить"}
      aria-pressed={selected}
      className={cn(
        "absolute top-2 left-2 z-20 w-5 h-5 rounded-md flex items-center justify-center transition-all",
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
    return <div className="text-[11px] text-zinc-500 mt-0.5">пусто</div>;
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
