import { motion } from "framer-motion";
import { Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_EMOJIS,
  EMOJI_CATEGORIES,
  searchEmojis,
} from "../lib/emojiData";
import { EMOJI_FONT_STACK } from "../lib/format";
import { t } from "../lib/i18n";

const PICKER_WIDTH_CLASS = "w-80";
const MAX_BODY_HEIGHT_CLASS = "max-h-72";
const EMOJI_SIZE_PX = 24;

// ─── Компонент ─────────────────────────────────────────────────────────────

type Props = {
  onPick: (emoji: string) => void;
  onClose: () => void;
  onRemove?: () => void;
};

export function EmojiPicker({ onPick, onClose, onRemove }: Props) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Фокус при монтировании. Два rAF ждут, пока отрисуется motion-анимация
  // родителя, и только потом фокусим. Тот же трюк, что у инлайн-полей
  // создания папки и заметки.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc закрывает пикер, даже если родитель забыл это повесить.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Поиск по ключевым словам (RU + EN) через индекс каталога. null = запроса
  // нет, тогда показываем всю сетку по категориям, а не результаты.
  const filtered = useMemo(
    () => (search.trim() ? searchEmojis(search) : null),
    [search],
  );

  const pickRandom = () => {
    onPick(ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      role="dialog"
      aria-label="Выбор иконки"
      className={`${PICKER_WIDTH_CLASS} rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-overlay)] shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden`}
    >
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 border-b border-[var(--color-border)]">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
          placeholder={t("Поиск emoji...")}
          aria-label={t("Поиск emoji")}
          className="flex-1 bg-white/[0.04] text-zinc-100 px-2.5 py-1.5 rounded-md outline-none ring-1 ring-inset ring-transparent focus:ring-[var(--color-accent-border)] placeholder-zinc-600 text-[13px]"
        />
        <IconBtn title="Случайный emoji" onClick={pickRandom}>
          <Shuffle size={14} strokeWidth={2} />
        </IconBtn>
        <IconBtn title={t("Закрыть")} onClick={onClose}>
          <X size={14} strokeWidth={2} />
        </IconBtn>
      </div>

      <div className={`${MAX_BODY_HEIGHT_CLASS} overflow-y-auto p-2`}>
        {filtered ? (
          filtered.length === 0 ? (
            <div className="text-[12px] text-zinc-600 text-center py-6">
              Ничего не найдено
            </div>
          ) : (
            <EmojiGrid emojis={filtered} onPick={onPick} />
          )
        ) : (
          EMOJI_CATEGORIES.map((cat) => (
            <section key={cat.name} className="mb-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-600 px-1 mb-1.5">
                {cat.name}
              </div>
              <EmojiGrid
                emojis={cat.emojis.map(([char]) => char)}
                onPick={onPick}
              />
            </section>
          ))
        )}
      </div>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="w-full px-3 py-2 text-[12px] text-zinc-500 hover:text-red-300 hover:bg-red-500/10 border-t border-[var(--color-border)] transition-colors text-left"
        >
          Удалить иконку
        </button>
      )}
    </motion.div>
  );
}

// ─── Подкомпоненты ─────────────────────────────────────────────────────────

function EmojiGrid({
  emojis,
  onPick,
}: {
  emojis: readonly string[];
  onPick: (e: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((e, i) => (
        <button
          key={`${e}-${i}`}
          type="button"
          onClick={() => onPick(e)}
          style={{
            fontFamily: EMOJI_FONT_STACK,
            fontSize: EMOJI_SIZE_PX,
            lineHeight: 1,
          }}
          className="aspect-square flex items-center justify-center rounded-md hover:bg-white/[0.06] transition-colors select-none"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
    >
      {children}
    </button>
  );
}
