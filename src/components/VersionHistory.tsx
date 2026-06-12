import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn";
import {
  listNoteVersions,
  readNote,
  readNoteVersion,
  type NoteVersion,
} from "../lib/storage";
import { t } from "../lib/i18n";
import { diffText, type DiffLine } from "../lib/textDiff";
import { confirmDialog } from "../store/confirm";
import { useNotesStore } from "../store/notes";
import { Modal } from "./Modal";

type PaneView = "preview" | "diff";

// Выше редактора, но ниже контекстного меню (300) и диалога подтверждения
// (400), чтобы подтверждение восстановления всё равно легло сверху.
const Z_VERSIONS = 60;

/**
 * Модалка истории версий для одной заметки, рулится через `versionHistoryFor`.
 * Показывает снапшоты, которые storage.ts держит в `notes/.versions/`,
 * превьюшит выбранный и восстанавливает через стор (тот сначала снимает снапшот
 * текущего состояния, так что восстановление само обратимо).
 */
export function VersionHistory() {
  const noteId = useNotesStore((s) => s.versionHistoryFor);
  const close = useNotesStore((s) => s.closeVersionHistory);
  const restore = useNotesStore((s) => s.restoreNoteVersion);
  const activeId = useNotesStore((s) => s.activeId);
  const activeNote = useNotesStore((s) => s.activeNote);

  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [body, setBody] = useState("");
  // Тело текущей заметки, против него диффим выбранный снапшот.
  const [currentBody, setCurrentBody] = useState("");
  const [view, setView] = useState<PaneView>("preview");

  // Грузим список снапшотов при открытии модалки (или смене целевой заметки).
  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setBody("");
    setView("preview");
    listNoteVersions(noteId)
      .then((v) => {
        if (cancelled) return;
        setVersions(v);
        setSelected(v.length ? v[0].timestamp : null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("VersionHistory: list failed:", e);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // Грузим тело выбранного снапшота для превью.
  useEffect(() => {
    if (!noteId || selected == null) {
      setBody("");
      return;
    }
    let cancelled = false;
    readNoteVersion(noteId, selected)
      .then((v) => {
        if (!cancelled) setBody(v?.body ?? "");
      })
      .catch((e) => {
        if (!cancelled) console.error("VersionHistory: read failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, selected]);

  // Грузим тело текущей заметки, чтобы было с чем диффить. Если открыта именно
  // она, берём из памяти (так же сравнивает Restore, и оно свежее за счёт
  // автосейва), иначе читаем с диска.
  useEffect(() => {
    if (!noteId) {
      setCurrentBody("");
      return;
    }
    if (activeId === noteId && activeNote) {
      setCurrentBody(activeNote.content);
      return;
    }
    let cancelled = false;
    readNote(noteId)
      .then((n) => {
        if (!cancelled) setCurrentBody(n?.content ?? "");
      })
      .catch((e) => {
        if (!cancelled)
          console.error("VersionHistory: current read failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, activeId, activeNote]);

  // Построчный и пословный дифф выбранного снапшота против текущей заметки.
  // Считаем только во вью диффа, иначе пустой массив, чтобы не грузить превью.
  const diff = useMemo<DiffLine[]>(
    () => (view === "diff" ? diffText(body, currentBody) : []),
    [view, body, currentBody],
  );
  const changes = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of diff) {
      if (line.type === "add") added++;
      else if (line.type === "remove") removed++;
    }
    return { added, removed };
  }, [diff]);

  // Закрытие по Esc живёт в общей оболочке <Modal>, локального слушателя нет.

  const handleRestore = async () => {
    if (!noteId || selected == null) return;
    const ok = await confirmDialog(
      "Восстановить эту версию? Текущее состояние сохранится в истории.",
      { confirmLabel: "Восстановить", danger: false },
    );
    if (!ok) return;
    await restore(noteId, selected);
  };

  return (
    <Modal
      open={!!noteId}
      onClose={close}
      ariaLabel={t("История версий")}
      zIndex={Z_VERSIONS}
      // У VersionHistory бэкдроп был чуть темнее (70 против общих 60), оставляем
      // так, чтобы модалка читалась "тяжелее", чем обычный confirm.
      backdropClassName="bg-black/70"
      panelClassName="relative w-full max-w-4xl h-[80vh] flex flex-col bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)] rounded-2xl shadow-2xl shadow-black/80 overflow-hidden"
    >
      <>
        <header className="flex items-center gap-2.5 px-5 py-3.5 border-b border-[var(--color-border)] shrink-0">
          <History size={16} strokeWidth={2} className="text-zinc-400" />
          <h2 className="text-[14px] font-semibold text-zinc-100">
            {t("История версий")}
          </h2>
          <span className="text-[12px] text-zinc-600">
            {versions.length > 0 &&
              `${versions.length} ${pluralVersions(versions.length)}`}
          </span>
          <button
            type="button"
            onClick={close}
            title="Закрыть"
            aria-label="Закрыть"
            className="ml-auto p-1.5 rounded-md text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </header>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600">
            Загрузка…
          </div>
        ) : versions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-zinc-600 px-6 text-center">
            Пока нет сохранённых версий. Они появляются по мере редактирования
            заметки.
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* Список версий */}
            <div className="w-60 shrink-0 overflow-y-auto border-r border-[var(--color-border)] py-1.5">
              {versions.map((v, i) => (
                <button
                  key={v.timestamp}
                  type="button"
                  onClick={() => setSelected(v.timestamp)}
                  className={cn(
                    "w-full text-left px-4 py-2 transition-colors",
                    v.timestamp === selected
                      ? "bg-white/[0.06]"
                      : "hover:bg-white/[0.03]",
                  )}
                >
                  <div
                    className={cn(
                      "text-[12.5px]",
                      v.timestamp === selected
                        ? "text-zinc-100"
                        : "text-zinc-300",
                    )}
                  >
                    {formatStamp(v.timestamp)}
                  </div>
                  <div className="text-[11px] text-zinc-600 mt-0.5">
                    {i === 0 ? "новейшая" : relativeAge(v.timestamp)}
                  </div>
                </button>
              ))}
            </div>

            {/* Правая панель: либо отрендеренное превью, либо дифф против
                    текущей заметки. */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] shrink-0">
                <ViewToggle value={view} onChange={setView} />
                {view === "diff" && (
                  <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-600">
                    <span>{t("эта версия , текущая")}</span>
                    <span className="font-mono">
                      <span className="text-[#7fb79e]">+{changes.added}</span>{" "}
                      <span className="text-[#d08c8c]">−{changes.removed}</span>
                    </span>
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {view === "preview" ? (
                  <div className="px-8 py-6">
                    <div className="md-content max-w-2xl mx-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {body || "*Пустая версия*"}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <DiffView lines={diff} />
                )}
              </div>
            </div>
          </div>
        )}

        {versions.length > 0 && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-overlay)] shrink-0">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded-md text-[13px] font-medium text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
            >
              Закрыть
            </button>
            <button
              type="button"
              onClick={handleRestore}
              disabled={selected == null}
              className="flex items-center gap-1.5 text-[13px] text-white bg-[var(--color-accent)] hover:bg-indigo-500 px-3 py-1.5 rounded-md font-medium shadow-lg shadow-indigo-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw size={13} strokeWidth={2} />
              Восстановить версию
            </button>
          </footer>
        )}
      </>
    </Modal>
  );
}

// ─── Подкомпоненты ───────────────────────────────────────────────────────────

function ViewToggle({
  value,
  onChange,
}: {
  value: PaneView;
  onChange: (v: PaneView) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-white/[0.04]">
      <ToggleBtn
        active={value === "preview"}
        onClick={() => onChange("preview")}
      >
        Просмотр
      </ToggleBtn>
      <ToggleBtn active={value === "diff"} onClick={() => onChange("diff")}>
        Изменения
      </ToggleBtn>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded text-[12px] transition-colors",
        active
          ? "bg-white/[0.08] text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300",
      )}
    >
      {children}
    </button>
  );
}

/** Рисует построчный дифф. Неизменённые строки приглушаем для контекста, у
 *  добавленных и удалённых строк свой знак на полях, подкрашенный фон, а внутри
 *  заменённых строк ярче подсвечиваем именно изменившиеся слова. */
function DiffView({ lines }: { lines: DiffLine[] }) {
  const hasChange = lines.some((l) => l.type !== "equal");
  if (!hasChange) {
    return (
      <div className="px-6 py-10 text-center text-[13px] text-zinc-600">
        Нет изменений между этой версией и текущей
      </div>
    );
  }
  return (
    <div className="font-mono text-[12.5px] leading-relaxed py-2">
      {lines.map((line, i) => (
        <DiffRow key={i} line={line} />
      ))}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const isAdd = line.type === "add";
  const isRemove = line.type === "remove";
  return (
    <div
      className={cn(
        "flex px-3 min-h-[1.45em]",
        isAdd && "bg-[#4a9e80]/10",
        isRemove && "bg-[#be5a5a]/12",
      )}
    >
      <span
        className={cn(
          "select-none w-4 shrink-0 text-right pr-2",
          isAdd
            ? "text-[#7fb79e]"
            : isRemove
              ? "text-[#d08c8c]"
              : "text-transparent",
        )}
      >
        {isAdd ? "+" : isRemove ? "−" : " "}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words",
          isAdd
            ? "text-[#bfe0cf]"
            : isRemove
              ? "text-[#e6b8b8]"
              : "text-zinc-500",
        )}
      >
        {line.parts.map((part, i) =>
          part.changed ? (
            <span
              key={i}
              className={cn(
                "rounded-[2px]",
                isAdd
                  ? "bg-[#4a9e80]/35 text-[#e3f5ec]"
                  : "bg-[#be5a5a]/35 text-[#f6dede]",
              )}
            >
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </span>
    </div>
  );
}

function formatStamp(ts: number): string {
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Грубая подпись "N мин/ч/дн назад" для второй строки. */
function relativeAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${plural(min, "мин", "мин", "мин")} назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${plural(hr, "час", "часа", "часов")} назад`;
  const d = Math.floor(hr / 24);
  return `${d} ${plural(d, "день", "дня", "дней")} назад`;
}

function pluralVersions(n: number): string {
  return plural(n, "версия", "версии", "версий");
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
