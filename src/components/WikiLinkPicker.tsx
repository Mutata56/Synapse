import { AnimatePresence, motion } from "framer-motion";
import { FileText, Folder } from "lucide-react";
import { useEffect } from "react";
import { EMOJI_FONT_STACK, formatRelativeDate } from "../lib/format";
import { useNotesStore } from "../store/notes";

// Выше поповеров редактора и hero (z 100), на одном уровне с командной палитрой
// (200): эти двое не сосуществуют (ссылка кликается только из редактора, а не
// из-за модалки палитры). Тосты (400) всё равно перебивают.
const Z_LINK_PICKER = 200;
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Модалка-уточнение для неоднозначной [[wiki-link]]. Если заголовок кликнутой
 * ссылки совпал больше чем с одной заметкой, стор открывает этот пикер (вместо
 * того чтобы молча уйти на первое совпадение), и юзер сам выбирает, что имелось
 * в виду. Путь папки и время последней правки помогают различить тёзок.
 */
export function WikiLinkPicker() {
  const linkPicker = useNotesStore((s) => s.linkPicker);
  const openLinkMatch = useNotesStore((s) => s.openLinkMatch);
  const closeLinkPicker = useNotesStore((s) => s.closeLinkPicker);

  // Esc закрывает без перехода.
  useEffect(() => {
    if (!linkPicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLinkPicker();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkPicker, closeLinkPicker]);

  return (
    <AnimatePresence>
      {linkPicker && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={closeLinkPicker}
          style={{ zIndex: Z_LINK_PICKER }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center p-6 pt-[14vh]"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Выбор заметки"
            className="w-full max-w-md max-h-[70vh] flex flex-col overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-2xl shadow-black/70"
          >
            <div className="px-4 py-3 border-b border-[var(--color-border)] shrink-0">
              <div className="text-[13px] font-semibold text-zinc-100 truncate">
                Несколько заметок: «{linkPicker.title}»
              </div>
              <div className="text-[12px] text-zinc-500 mt-0.5">
                Выбери, какую открыть
              </div>
            </div>

            <div className="overflow-y-auto py-1">
              {linkPicker.matches.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => openLinkMatch(note.id)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-white/[0.05] transition-colors"
                >
                  <span className="shrink-0 w-5 flex justify-center">
                    {note.icon ? (
                      <span
                        style={{ fontFamily: EMOJI_FONT_STACK }}
                        className="text-base leading-none select-none"
                      >
                        {note.icon}
                      </span>
                    ) : (
                      <FileText
                        size={15}
                        strokeWidth={1.8}
                        className="text-zinc-500"
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-[13px] text-zinc-200 min-w-0">
                      <Folder
                        size={11}
                        strokeWidth={2}
                        className="shrink-0 text-zinc-500"
                      />
                      <span className="truncate">{note.folder || "Корень"}</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      изменено {formatRelativeDate(note.updatedAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
