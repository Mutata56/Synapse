import { RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn";
import { gradientClassName, parseCover } from "../lib/covers";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { t } from "../lib/i18n";
import {
  readTrashedNoteBody,
  resolveCoverImageUrl,
  type NoteMeta,
} from "../lib/storage";
import { confirmDialog } from "../store/confirm";
import { useNotesStore } from "../store/notes";
import { Modal } from "./Modal";

const Z_TRASH_MODAL = 50;
const Z_CLOSE_BUTTON = 20;

const COVER_HEIGHT_CLASS = "h-44";
const ICON_FONT_PX = 88;
const TITLE_FONT_PX = 32;
const DATE_FONT_PX = 11;

// ─── Компонент ─────────────────────────────────────────────────────────────

export function TrashPreviewModal({
  note,
  onClose,
}: {
  note: NoteMeta | null;
  onClose: () => void;
}) {
  const restoreNote = useNotesStore((s) => s.restoreNote);
  const deleteForever = useNotesStore((s) => s.deleteForever);

  const [body, setBody] = useState<string>("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverImgFailed, setCoverImgFailed] = useState(false);

  // Стабильный id, чтобы привязать `aria-labelledby` диалога к заголовку.
  const titleId = useId();

  // Две независимые загрузки: тело зависит только от id заметки, обложка только
  // от токена обложки. Разделили, чтобы не перечитывать тело, когда у активной
  // заметки сменилась обложка (например, родитель перерисовался с тем же id, но
  // новым объектом NoteMeta).
  const noteId = note?.id ?? null;
  const noteCover = note?.cover ?? null;

  // ─── Загрузка тела ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Сбрасываем при закрытии или смене, чтобы не мигнуть телом прошлой заметки
    // под новым заголовком, пока асинхронное чтение в пути.
    setBody("");
    if (!noteId) return;

    let cancelled = false;
    readTrashedNoteBody(noteId)
      .then((b) => {
        if (!cancelled) setBody(b);
      })
      .catch((e) => {
        if (!cancelled)
          console.error("TrashPreviewModal: body read failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // ─── Резолв обложки (только для токенов `file:`) ────────────────────────────
  useEffect(() => {
    setCoverUrl(null);
    setCoverImgFailed(false);
    if (!noteCover) return;
    if (parseCover(noteCover).kind !== "file") return;

    let cancelled = false;
    resolveCoverImageUrl(noteCover)
      .then((u) => {
        if (!cancelled) setCoverUrl(u);
      })
      .catch((e) => {
        if (!cancelled)
          console.error("TrashPreviewModal: cover resolve failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [noteCover]);

  // Закрытие по Escape живёт в общей оболочке <Modal>.

  const handleDeleteForever = async () => {
    if (!note) return;
    if (
      !(await confirmDialog(t("Удалить навсегда?"), {
        confirmLabel: t("Удалить навсегда"),
      }))
    )
      return;
    // Закрываем оптимистично. Ошибки стор разрулит сам, если удаление упадёт,
    // заметка просто останется в корзине (refreshAll в TrashView перерисует
    // галерею), так что состояние у юзера будет верное.
    void deleteForever(note.id);
    onClose();
  };

  const handleRestore = () => {
    if (!note) return;
    void restoreNote(note.id);
    onClose();
  };

  return (
    <Modal
      open={!!note}
      onClose={onClose}
      zIndex={Z_TRASH_MODAL}
      // Повторяем исходный потемнее бэкдроп (70 против общих 60).
      backdropClassName="bg-black/70"
      // Замечание: aria-labelledby ставится на панель через role/aria-modal у
      // Modal, с этим рефактором связку через labelledby теряем, для оболочки
      // компромисс терпимый. (Если станет важно, верни `aria-labelledby` в
      // ModalProps, Modal просто прокинет его в panel motion.div.)
      ariaLabel={note?.title || DEFAULT_NOTE_TITLE}
      panelClassName="relative w-full max-w-3xl max-h-[88vh] flex flex-col bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)] rounded-2xl shadow-2xl shadow-black/80 overflow-hidden"
    >
      {/* Гейтим тело по `note != null`, чтобы TS сузил тип note внутри.
          AnimatePresence у Modal и так стережёт маунт, но TS этого не видит. */}
      {note && (
        <>
          <button
            type="button"
            onClick={onClose}
            title={t("Закрыть")}
            aria-label={t("Закрыть превью")}
            style={{ zIndex: Z_CLOSE_BUTTON }}
            className="absolute top-3 right-3 p-2 rounded-md bg-black/40 backdrop-blur-md text-white/80 hover:text-white hover:bg-black/60 transition-colors"
          >
            <X size={14} strokeWidth={2} />
          </button>

          <div className="overflow-y-auto flex-1">
            <CoverArea
              note={note}
              coverUrl={coverUrl}
              coverImgFailed={coverImgFailed}
              onCoverImgError={() => setCoverImgFailed(true)}
            />

            <div className="max-w-2xl mx-auto px-10 -mt-10 pb-10">
              {note.icon && (
                <div
                  style={{
                    fontFamily: EMOJI_FONT_STACK,
                    fontSize: ICON_FONT_PX,
                    lineHeight: 1,
                  }}
                  className="mb-3 select-none"
                >
                  {note.icon}
                </div>
              )}
              <h1
                id={titleId}
                style={{ fontSize: TITLE_FONT_PX }}
                className="font-bold text-zinc-100 tracking-tight mb-1"
              >
                {note.title || DEFAULT_NOTE_TITLE}
              </h1>
              <div
                style={{ fontSize: DATE_FONT_PX }}
                className="text-zinc-600 mb-6"
              >
                Удалено {new Date(note.updatedAt).toLocaleString("ru-RU")}
              </div>

              <div className="md-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {body || "*Пустая заметка*"}
                </ReactMarkdown>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-overlay)]">
            <button
              type="button"
              onClick={handleDeleteForever}
              className="flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-red-300 hover:bg-red-500/10 px-3 py-1.5 rounded-md transition-colors font-medium"
            >
              <Trash2 size={13} strokeWidth={2} />
              {t("Удалить навсегда")}
            </button>
            <button
              type="button"
              onClick={handleRestore}
              className="flex items-center gap-1.5 text-[13px] text-white bg-[var(--color-accent)] hover:bg-indigo-500 px-3 py-1.5 rounded-md font-medium shadow-lg shadow-indigo-500/20 transition-colors"
            >
              <RotateCcw size={13} strokeWidth={2} />
              Восстановить
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function CoverArea({
  note,
  coverUrl,
  coverImgFailed,
  onCoverImgError,
}: {
  note: NoteMeta;
  coverUrl: string | null;
  coverImgFailed: boolean;
  onCoverImgError: () => void;
}) {
  const cover = parseCover(note.cover);
  const showFileImg = cover.kind === "file" && coverUrl && !coverImgFailed;
  const showUrlImg = cover.kind === "url" && !coverImgFailed;
  // Откатываемся на нейтральный градиент, когда обложки нет или картинка не
  // загрузилась (удалили ассет, сдох внешний URL и т.п.).
  const showFallback = cover.kind === "none" || coverImgFailed;

  return (
    <div className={cn("relative overflow-hidden", COVER_HEIGHT_CLASS)}>
      {cover.kind === "gradient" && !coverImgFailed && (
        <div
          className={cn("absolute inset-0", gradientClassName(cover.value))}
        />
      )}
      {showFileImg && (
        <img
          src={coverUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={onCoverImgError}
        />
      )}
      {showUrlImg && (
        <img
          src={cover.value}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          onError={onCoverImgError}
        />
      )}
      {showFallback && (
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-950" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg-elevated)] to-transparent" />
    </div>
  );
}
