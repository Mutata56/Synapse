import { FileText, FolderInput, Pencil, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { INBOX_FOLDER } from "../lib/inbox";
import type { NoteMeta, TreeNode } from "../lib/storage";
import { flattenNotes } from "../lib/treeUtils";
import { useNotesStore } from "../store/notes";

/** Плоский список путей всех папок с глубиной, для списка целей перемещения. */
function collectFolders(tree: TreeNode[]): { path: string; depth: number }[] {
  const out: { path: string; depth: number }[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (n.kind === "folder") {
        out.push({ path: n.path, depth });
        walk(n.children, depth + 1);
      }
    }
  };
  walk(tree, 0);
  return out;
}

function pluralNotes(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "заметка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "заметки";
  return "заметок";
}

// ─── Вид ──────────────────────────────────────────────────────────────────

export function InboxView() {
  const tree = useNotesStore((s) => s.tree);
  const selectNote = useNotesStore((s) => s.selectNote);
  const setView = useNotesStore((s) => s.setView);
  const moveNote = useNotesStore((s) => s.moveNote);
  const renameNote = useNotesStore((s) => s.renameNote);
  const trashNote = useNotesStore((s) => s.trashNote);

  const inbox = useMemo(
    () =>
      flattenNotes(tree)
        .filter((n) => n.folder === INBOX_FOLDER)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [tree],
  );

  // Куда можно переместить: любая папка, кроме самих входящих (и их подпапок).
  const folders = useMemo(
    () =>
      collectFolders(tree).filter(
        (f) =>
          f.path !== INBOX_FOLDER && !f.path.startsWith(`${INBOX_FOLDER}/`),
      ),
    [tree],
  );

  const open = (id: string) => {
    setView("notes");
    void selectNote(id);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Входящие
        </h2>
        <p className="text-[13px] text-zinc-500 mt-1">
          {inbox.length === 0
            ? "Пусто , всё разобрано"
            : `${inbox.length} ${pluralNotes(inbox.length)} на разбор`}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-2xl mx-auto">
          {inbox.length === 0 ? (
            <div className="text-center text-zinc-600 text-sm py-24 leading-relaxed">
              Быстрый захват (<span className="font-mono text-zinc-500">
                Ctrl+Shift+N
              </span>
              ) складывает мысли сюда.
              <br />
              Разбирай их: переименуй, разложи по папкам или удали.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {inbox.map((note) => (
                <InboxCard
                  key={note.id}
                  note={note}
                  folders={folders}
                  onOpen={() => open(note.id)}
                  onRename={(t) => void renameNote(note.id, t)}
                  onMove={(folder) => void moveNote(note.id, folder)}
                  onTrash={() => void trashNote(note.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Карточка ────────────────────────────────────────────────────────────────────

function InboxCard({
  note,
  folders,
  onOpen,
  onRename,
  onMove,
  onTrash,
}: {
  note: NoteMeta;
  folders: { path: string; depth: number }[];
  onOpen: () => void;
  onRename: (title: string) => void;
  onMove: (folder: string) => void;
  onTrash: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [draft, setDraft] = useState(note.title);

  const commitRename = () => {
    const t = draft.trim();
    setRenaming(false);
    if (t && t !== note.title) onRename(t);
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <span className="shrink-0 w-5 flex justify-center pt-0.5">
          {note.icon ? (
            <span
              style={{ fontFamily: EMOJI_FONT_STACK }}
              className="text-base leading-none select-none"
            >
              {note.icon}
            </span>
          ) : (
            <FileText size={15} strokeWidth={1.8} className="text-zinc-500" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(note.title);
                  setRenaming(false);
                }
              }}
              className="w-full bg-white/[0.06] text-zinc-100 px-2 py-1 rounded outline-none ring-1 ring-inset ring-[var(--color-accent-border)] text-[13px]"
            />
          ) : (
            <button
              type="button"
              onClick={onOpen}
              className="block w-full text-left"
            >
              <div className="text-[13px] text-zinc-100 truncate">
                {note.title || DEFAULT_NOTE_TITLE}
              </div>
              {note.preview && (
                <div className="text-[12px] text-zinc-500 truncate mt-0.5">
                  {note.preview}
                </div>
              )}
            </button>
          )}
        </div>

        {!renaming && (
          <div className="flex items-center gap-0.5 shrink-0">
            <IconBtn
              title="Переименовать"
              onClick={() => {
                setDraft(note.title);
                setMoving(false);
                setRenaming(true);
              }}
            >
              <Pencil size={13} strokeWidth={2} />
            </IconBtn>
            <IconBtn
              title="Переместить в папку"
              active={moving}
              onClick={() => setMoving((v) => !v)}
            >
              <FolderInput size={13} strokeWidth={2} />
            </IconBtn>
            <IconBtn title="В корзину" danger onClick={onTrash}>
              <Trash2 size={13} strokeWidth={2} />
            </IconBtn>
          </div>
        )}
      </div>

      {/* Список целей прямо тут: раскрывает карточку, а не висит поверх. */}
      {moving && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-overlay)]/40">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600">
              Переместить в…
            </span>
            <button
              type="button"
              onClick={() => setMoving(false)}
              className="p-0.5 rounded text-zinc-600 hover:text-zinc-200"
              aria-label="Отмена"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto pb-1.5">
            <MoveTarget label="Корень" onClick={() => onMove("")} depth={0} />
            {folders.map((f) => (
              <MoveTarget
                key={f.path}
                label={f.path.slice(f.path.lastIndexOf("/") + 1)}
                onClick={() => onMove(f.path)}
                depth={f.depth}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MoveTarget({
  label,
  onClick,
  depth,
}: {
  label: string;
  onClick: () => void;
  depth: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ paddingLeft: 12 + depth * 14 }}
      className="w-full text-left pr-3 py-1.5 text-[13px] text-zinc-300 hover:bg-white/[0.05] hover:text-zinc-100 transition-colors truncate"
    >
      {label}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "p-1.5 rounded-md transition-colors",
        active && "bg-white/[0.08] text-zinc-100",
        !active &&
          (danger
            ? "text-zinc-500 hover:text-red-300 hover:bg-red-500/10"
            : "text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.06]"),
      )}
    >
      {children}
    </button>
  );
}
