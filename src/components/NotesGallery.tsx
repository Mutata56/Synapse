import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useSelection } from "../hooks/useSelection";
import { t } from "../lib/i18n";
import { pluralRu } from "../lib/format";
import { flattenNotes } from "../lib/treeUtils";
import { confirmDialog } from "../store/confirm";
import { useNotesStore } from "../store/notes";
import { BulkActionBar } from "./BulkActionBar";
import { NoteCard } from "./NoteCard";

export function NotesGallery() {
  const tree = useNotesStore((s) => s.tree);
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);
  const trashNote = useNotesStore((s) => s.trashNote);
  const batchTrashNotes = useNotesStore((s) => s.batchTrashNotes);
  const createNote = useNotesStore((s) => s.createNote);

  // Сначала самые свежие по обновлению.
  const notes = useMemo(
    () => flattenNotes(tree).sort((a, b) => b.updatedAt - a.updatedAt),
    [tree],
  );

  const sel = useSelection<string>();

  const handleNew = () => {
    // Запустили и забыли, частые двойные клики стор сторожит сам.
    void createNote("");
  };

  const handleOpen = (id: string) => {
    setView("notes");
    void selectNote(id);
  };

  const handleBulkTrash = async () => {
    const ids = Array.from(sel.selection);
    if (ids.length === 0) return;
    const word = pluralRu(ids.length, t("заметку"), t("заметки"), t("заметок"));
    if (!(await confirmDialog(t("Переместить {n} {word} в корзину?", { n: ids.length, word }), { confirmLabel: t("В корзину") }))) return;
    // try/finally гарантирует, что выделение снимется даже если пакетный IPC
    // упадёт, иначе остался бы висеть старый чип "выделено N" со ссылками на
    // id, которых, может, уже нет.
    try {
      await batchTrashNotes(ids);
    } finally {
      sel.clear();
    }
  };

  const summary =
    notes.length === 0
      ? t("Здесь будут все твои заметки")
      : `${notes.length} ${pluralRu(notes.length, t("заметка"), t("заметки"), t("заметок"))}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 flex items-end justify-between border-b border-[var(--color-border)] shrink-0">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
            {t("Все заметки")}
          </h2>
          <p className="text-[13px] text-zinc-500 mt-1">{summary}</p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="flex items-center gap-1.5 text-[13px] text-white bg-[var(--color-accent)] hover:bg-indigo-500 px-3 py-1.5 rounded-md font-medium shadow-lg shadow-indigo-500/20 transition-colors"
        >
          <Plus size={14} strokeWidth={2.4} />
          {t("Новая заметка")}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-7xl mx-auto">
          {notes.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <AnimatePresence initial={false}>
                {notes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onOpen={() => handleOpen(note.id)}
                    onTrash={() => void trashNote(note.id)}
                    selected={sel.has(note.id)}
                    selecting={sel.isSelecting}
                    onToggleSelect={() => sel.toggle(note.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <BulkActionBar
        count={sel.size}
        total={notes.length}
        onClear={sel.clear}
        onSelectAll={() => sel.selectAll(notes.map((n) => n.id))}
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

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-zinc-600 text-sm text-center py-24"
    >
      {t("Создай первую заметку, нажав «Новая заметку»")}
    </motion.div>
  );
}
