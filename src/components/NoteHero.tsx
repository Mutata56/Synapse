import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Smile,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { gradientClassName, parseCover } from "../lib/covers";
import { dailyDateOf } from "../lib/daily";
import { DEFAULT_NOTE_TITLE, EMOJI_FONT_STACK } from "../lib/format";
import { resolveCoverImageUrl } from "../lib/storage";
import { registerFlusher, useNotesStore } from "../store/notes";
import { useTemplatesStore } from "../store/templates";
import { CoverPicker } from "./CoverPicker";
import { EmojiPicker } from "./EmojiPicker";
import { MoodPicker } from "./MoodPicker";

/** Дебаунс перед записью инпута заголовка на диск. */
const TITLE_SAVE_DEBOUNCE_MS = 300;

const COVER_HEIGHT_PX = 280;
const COVER_PICKER_GAP_PX = 8;
const COVER_PICKER_TOP_PX = COVER_HEIGHT_PX + COVER_PICKER_GAP_PX;

const ICON_BOX_PX = 96;
const ICON_FONT_PX = 78;

/** Лежит выше контента редактора, но ниже модальных оверлеев. */
const Z_HERO_POPOVER = 100;

const SPRING_ICON = { type: "spring", stiffness: 380, damping: 25 } as const;

// ─── Компонент ─────────────────────────────────────────────────────────────

export function NoteHero() {
  const activeNote = useNotesStore((s) => s.activeNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const toggleFavorite = useNotesStore((s) => s.toggleFavorite);

  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  /** Ставится, когда `<img>` обложки стрельнул `error`. Сбрасывается при
   *  смене заметки И при любой смене токена обложки. Позволяет спрятать иконку
   *  битой картинки, когда внешний URL или файл ассета стал недоступен. */
  const [coverImgFailed, setCoverImgFailed] = useState(false);

  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [title, setTitle] = useState(activeNote?.title ?? "");
  const titleTimerRef = useRef<number | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  // ─── Синхроним локальный UI с активной заметкой ───────────────────────────────────
  // Когда юзер переключает заметку:
  //   - сбрасываем локальный инпут заголовка на сохранённый title новой заметки,
  //   - закрываем поповеры (пикеры обложки/эмодзи), открытые для старой
  //     заметки, иначе следующий выбор изменил бы не ту заметку,
  //   - сбрасываем флаг битой картинки,
  //   - отменяем отложенное сохранение заголовка (его значение от прошлой заметки).
  useEffect(() => {
    setTitle(activeNote?.title ?? "");
    setCoverPickerOpen(false);
    setIconPickerOpen(false);
    setCoverImgFailed(false);
    return () => {
      if (titleTimerRef.current !== null) {
        window.clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
    };
  }, [activeNote?.id]);

  // Зеркалим свежий `title` в реф, чтобы flusher из стора (он захватывает
  // значение один раз при монтировании) всегда читал ТЕКУЩЕЕ, а не то, что
  // было в момент регистрации. Без этого flush писал бы устаревший заголовок
  // на каждом переключении.
  const titleRef = useRef(title);
  titleRef.current = title;
  // Регистрируем flusher заголовка рядом с flusher'ом тела редактора. На
  // selectNote / closeActiveNote стор ждёт оба перед сменой activeId, так что
  // заголовок, набранный в последние 300 мс, не проскользнёт.
  useEffect(() => {
    const id = activeNote?.id ?? null;
    if (!id) return;
    const flush = async () => {
      if (titleTimerRef.current === null) return;
      window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
      // Страхуемся от того, что заметку успели сменить: saveNote пишет в
      // ТЕКУЩУЮ activeNote, так что flush после переключения затёр бы заголовок
      // не той заметки.
      const stillActive = useNotesStore.getState().activeNote;
      if (stillActive?.id !== id) return;
      try {
        await saveNote({ title: titleRef.current });
      } catch (e) {
        console.error("NoteHero: title flush failed:", e);
      }
    };
    const unregister = registerFlusher(flush);
    return unregister;
  }, [activeNote?.id, saveNote]);

  // ─── Принимаем внешние правки заголовка (например, переименование из сайдбара) ─────
  // Храним последнее "серверное" значение (activeNote.title), которое видели,
  // чтобы различать:
  //   - наш собственный дебаунс-сейв, прилетевший обратно через activeNote.title
  //     (incoming === последнего виденного сервера): пропускаем, пока в фокусе,
  //     юзер ещё печатает.
  //   - ВНЕШНЕЕ переименование (из сайдбара, undo/redo, восстановление версии,
  //     правка, когда фокус в другом месте): incoming !== lastSeen И !== local
  //     title. Тут всегда перезасеваем local, даже в фокусе, иначе редактор
  //     держит устаревший заголовок, которым следующий blur-сейв затёр бы
  //     реальное внешнее значение.
  const lastSeenTitleRef = useRef(activeNote?.title ?? "");
  useEffect(() => {
    const incoming = activeNote?.title ?? "";
    const lastSeen = lastSeenTitleRef.current;
    lastSeenTitleRef.current = incoming;
    if (incoming === lastSeen) return; // реально ничего не поменялось
    const isFocused = document.activeElement === titleInputRef.current;
    if (isFocused && incoming === title) return; // наше же эхо локального стейта
    if (isFocused && incoming !== title) {
      // Внешнее переименование прилетело, пока мы печатали: отменяем отложенный
      // дебаунс-сейв (иначе он перетёр бы внешнюю правку обратно на устаревшее
      // локальное значение) и принимаем внешний заголовок.
      if (titleTimerRef.current !== null) {
        window.clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
    }
    setTitle(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.title]);

  // Авторост textarea заголовка, чтобы длинный заголовок ПЕРЕНОСИЛСЯ на
  // несколько строк, а не вылезал по горизонтали (обычный <input> переносить
  // не умеет, <textarea> умеет). Бежит на каждую смену заголовка: ввод,
  // переключение заметки, переименование.
  useEffect(() => {
    const el = titleInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // ─── Резолвим обложки `file:*` в URL ассета Tauri ───────────────────────
  // Градиентным и внешним URL-обложкам резолв не нужен: ставим `coverUrl =
  // null` и рисуем прямо из распарсенного токена. `cancelled` страхует от
  // того, что более медленный резолв перетрёт более свежую обложку.
  const coverToken = activeNote?.cover ?? null;
  const coverKind = parseCover(coverToken).kind;
  useEffect(() => {
    // Только что выбранная обложка на ТОЙ ЖЕ заметке должна сбросить прежний
    // провал загрузки <img>, иначе гард рендера `!coverImgFailed` так и будет
    // прятать новую валидную обложку (сброс по [activeNote?.id] срабатывает
    // только при смене заметки, а не смене обложки на той же). Как в NoteCard.
    setCoverImgFailed(false);
    // Заранее чистим URL прошлой обложки, чтобы быстрая смена заметки не
    // нарисовала картинку заметки A в hero заметки B, пока резолв B в полёте
    // (как в TrashPreviewModal / NoteCard).
    setCoverUrl(null);
    if (coverKind !== "file" || !coverToken) {
      return;
    }
    let cancelled = false;
    resolveCoverImageUrl(coverToken)
      .then((url) => {
        if (!cancelled) setCoverUrl(url);
      })
      .catch((e) => {
        if (!cancelled) console.error("NoteHero: resolveCoverImageUrl:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [coverToken, coverKind]);

  // Пикеры взаимоисключающие: открыли один, закрыли другой. Иначе в раскладке
  // без обложки поповеры налезут друг на друга (оба привязаны к
  // `top-full mt-2 left-0` ряда с кнопками).
  const toggleCoverPicker = useCallback(() => {
    setIconPickerOpen(false);
    setCoverPickerOpen((v) => !v);
  }, []);
  const toggleIconPicker = useCallback(() => {
    setCoverPickerOpen(false);
    setIconPickerOpen((v) => !v);
  }, []);

  const handleRemoveIcon = useCallback(() => {
    void saveNote({ icon: null });
    setIconPickerOpen(false);
  }, [saveNote]);

  const handlePickIcon = useCallback(
    (emoji: string) => {
      void saveNote({ icon: emoji });
      setIconPickerOpen(false);
    },
    [saveNote],
  );

  if (!activeNote) return null;

  const cover = parseCover(activeNote.cover);
  const hasCover = cover.kind !== "none";
  const isFavorite = activeNote.favorite;
  // Настроение это штука для дневника, так что показываем его только на заметках дня.
  const isDaily = dailyDateOf(activeNote.id) !== null;

  // ─── Ввод заголовка ────────────────────────────────────────────────
  // id заметки запоминаем в момент планирования сейва, чтобы медленная запись
  // не затёрла заголовок другой заметки. Если переключились посреди дебаунса,
  // просто роняем отложенное значение, а не пишем его не в тот файл.
  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (titleTimerRef.current !== null) {
      window.clearTimeout(titleTimerRef.current);
    }
    const idAtSchedule = activeNote.id;
    titleTimerRef.current = window.setTimeout(() => {
      titleTimerRef.current = null;
      const stillActive = useNotesStore.getState().activeNote;
      if (stillActive?.id !== idAtSchedule) return;
      void saveNote({ title: value });
    }, TITLE_SAVE_DEBOUNCE_MS);
  };

  return (
    <div className="w-full">
      {/* ─── Обложка ───────────────────────────────────────────────── */}
      <div className="group/cover relative">
        {hasCover && (
          <motion.div
            key={activeNote.cover}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            style={{ height: COVER_HEIGHT_PX }}
            className="w-full relative overflow-hidden"
          >
            {cover.kind === "gradient" && (
              <div
                className={cn(
                  "absolute inset-0",
                  gradientClassName(cover.value),
                )}
              />
            )}
            {cover.kind === "file" && coverUrl && !coverImgFailed && (
              <img
                src={coverUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setCoverImgFailed(true)}
              />
            )}
            {cover.kind === "url" && !coverImgFailed && (
              <img
                src={cover.value}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setCoverImgFailed(true)}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-bg)]/60 to-transparent pointer-events-none" />

            <button
              type="button"
              onClick={toggleCoverPicker}
              data-open={coverPickerOpen}
              aria-haspopup="dialog"
              aria-expanded={coverPickerOpen}
              className="absolute right-4 bottom-4 z-30 px-3 py-1.5 rounded-md bg-black/40 backdrop-blur-md text-white/90 text-[12px] font-medium hover:bg-black/60 transition-colors border border-white/10 opacity-0 group-hover/cover:opacity-100 data-[open=true]:opacity-100"
            >
              Изменить обложку
            </button>
          </motion.div>
        )}

        {coverPickerOpen && hasCover && (
          <div
            className="absolute right-4"
            style={{ top: COVER_PICKER_TOP_PX, zIndex: Z_HERO_POPOVER }}
          >
            <CoverPicker
              onClose={() => setCoverPickerOpen(false)}
              hasCover
            />
          </div>
        )}
      </div>

      {/* ─── Шапка (иконка, кнопки, заголовок) ─────────────────── */}
      <div
        className={cn(
          "max-w-3xl mx-auto px-5 sm:px-12 flex flex-col items-start",
          hasCover ? "-mt-16" : "pt-20",
        )}
      >
        <AnimatePresence>
          {activeNote.icon && (
            <motion.button
              type="button"
              aria-label="Изменить иконку"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={SPRING_ICON}
              onClick={toggleIconPicker}
              style={{
                width: ICON_BOX_PX,
                height: ICON_BOX_PX,
                fontSize: ICON_FONT_PX,
                lineHeight: 1,
                fontFamily: EMOJI_FONT_STACK,
              }}
              className="relative flex items-center justify-center rounded-2xl hover:bg-white/[0.04] transition-colors select-none mb-2"
            >
              {activeNote.icon}
            </motion.button>
          )}
        </AnimatePresence>

        <div className="relative my-3 flex items-center gap-1 opacity-0 group-hover/hero:opacity-100 focus-within:opacity-100 transition-opacity">
          {!hasCover && (
            <ActionPill
              icon={ImagePlus}
              label="Добавить обложку"
              onClick={toggleCoverPicker}
            />
          )}
          {!activeNote.icon && (
            <ActionPill
              icon={Smile}
              label={t("Добавить иконку")}
              onClick={toggleIconPicker}
            />
          )}
          <FavoriteButton
            favorite={isFavorite}
            onClick={() => void toggleFavorite(activeNote.id)}
          />
          {/* Кнопку "сохранить как шаблон" прячем, когда правим сам шаблон
              (заметки .templates/*), чтобы нельзя было рекурсивно сохранить
              шаблон как шаблон. */}
          {!activeNote.id.startsWith(".templates/") && (
            <ActionPill
              icon={LayoutTemplate}
              label={t("Сохранить как шаблон")}
              onClick={() =>
                void useTemplatesStore.getState().saveCurrentAsTemplate()
              }
            />
          )}
          <SaveStatusChip />

          {coverPickerOpen && !hasCover && (
            <div
              className="absolute top-full mt-2 left-0"
              style={{ zIndex: Z_HERO_POPOVER }}
            >
              <CoverPicker
                onClose={() => setCoverPickerOpen(false)}
                hasCover={false}
              />
            </div>
          )}
          {iconPickerOpen && (
            <div
              className="absolute top-full mt-2 left-0"
              style={{ zIndex: Z_HERO_POPOVER }}
            >
              <EmojiPicker
                onPick={handlePickIcon}
                onClose={() => setIconPickerOpen(false)}
                onRemove={activeNote.icon ? handleRemoveIcon : undefined}
              />
            </div>
          )}
        </div>

        <textarea
          ref={titleInputRef}
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onKeyDown={(e) => {
            // Заголовок это одна логическая строка, так что Enter не должен
            // вставлять перенос. Он просто коммитит и снимает фокус (тело в одном клике).
            if (e.key === "Enter") {
              e.preventDefault();
              titleInputRef.current?.blur();
            }
          }}
          placeholder={t(DEFAULT_NOTE_TITLE)}
          aria-label={t("Название заметки")}
          spellCheck={false}
          rows={1}
          className="hero-title block w-full bg-transparent text-white outline-none placeholder:text-[var(--color-text-muted)] py-2 text-center resize-none overflow-hidden"
        />

        {isDaily && (
          <div className="w-full flex items-center justify-center gap-2 mt-1">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-600">
              {t("Настроение")}
            </span>
            <MoodPicker
              value={activeNote.mood ?? null}
              onChange={(m) => void saveNote({ mood: m })}
            />
          </div>
        )}

        <AliasesEditor
          value={activeNote.aliases ?? []}
          onChange={(next) => void saveNote({ aliases: next })}
        />
      </div>
    </div>
  );
}

// ─── Редактор псевдонимов ──────────────────────────────────────────────────
// Компактная строка чипсов под заголовком для альтернативных названий
// (как в Obsidian). Если псевдонимов нет, строка схлопывается в одну кнопку
// "+ псевдоним" (заметна, но не шумит). Каждый чипс имеет × для удаления.
// Enter коммитит, Escape отменяет.
//
// Правки идут через saveNote({ aliases }), тот же путь сохранения, что и
// заголовок/обложка/иконка. Стор перечитывает файл после записи и патчит
// дерево с новыми псевдонимами, так что автодополнение [[ подхватывает их
// без ручного обновления.
function AliasesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const commit = () => {
    const t = draft.trim();
    setDraft("");
    setEditing(false);
    if (!t) return;
    // Дедупликация без учёта регистра (как в Obsidian: "X" и "x" это один
    // псевдоним, т.к. это title-класс идентификатора).
    const lower = t.toLowerCase();
    if (value.some((a) => a.toLowerCase() === lower)) return;
    onChange([...value, t]);
  };
  const remove = (i: number) => {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  };

  if (value.length === 0 && !editing) {
    return (
      <div className="w-full flex items-center justify-center mt-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[11px] text-[var(--color-text-muted)] hover:text-zinc-300 opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity px-2 py-1 rounded-md hover:bg-white/[0.04]"
          title="Добавить альтернативное название для [[wiki-link]]"
        >
          + псевдоним
        </button>
      </div>
    );
  }

  return (
    <div className="w-full flex items-center justify-center flex-wrap gap-1.5 mt-2">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] mr-1">
        Псевдонимы
      </span>
      {value.map((a, i) => (
        <span
          key={`${a}-${i}`}
          className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full bg-[var(--color-accent-bg)] text-zinc-200 border border-[var(--color-accent-border)]"
        >
          {a}
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Удалить псевдоним ${a}`}
            className="text-zinc-400 hover:text-zinc-100 leading-none"
          >
            ×
          </button>
        </span>
      ))}
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft("");
              setEditing(false);
            }
          }}
          placeholder={t("Псевдоним…")}
          className="text-[12px] px-2 py-0.5 rounded-full bg-transparent border border-[var(--color-border-strong)] text-zinc-200 placeholder:text-[var(--color-text-muted)] outline-none min-w-[120px] focus:border-[var(--color-accent)]"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[12px] px-2 py-0.5 rounded-full text-[var(--color-text-muted)] hover:text-zinc-200 hover:bg-white/[0.05]"
          title="Добавить псевдоним"
        >
          +
        </button>
      )}
    </div>
  );
}

// ─── Мелкие подкомпоненты ─────────────────────────────────────────────────

function ActionPill({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] rounded-md transition-colors"
    >
      <Icon size={13} strokeWidth={2} />
      {label}
    </button>
  );
}

// ── Индикатор статуса сохранения ────────────────────────────────────────────
//
// Маленький индикатор рядом со звёздой избранного. Показывает состояние
// сохранения редактора. Прятается в idle (не шумит на покое), пульсирует
// при сохранении, показывает зелёную галочку с временем на ~2с после записи,
// показывает красный чипс с тултипом ошибки при падении записи.
//
// Всегда виден в активном состоянии (без opacity-0 group-hover, как у других
// кнопок): при ошибке сохранения юзер ОБЯЗАН это видеть, а не наводить мышь
// на hero. В idle не занимает место.

const SAVED_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});
function fmtSavedAt(ts: number | null): string {
  if (ts === null) return "";
  return SAVED_TIME_FORMAT.format(new Date(ts));
}

function SaveStatusChip() {
  const state = useNotesStore((s) => s.savingState);
  const lastSavedAt = useNotesStore((s) => s.lastSavedAt);
  const lastSaveError = useNotesStore((s) => s.lastSaveError);

  if (state === "idle") return null;

  const base =
    "inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border";
  if (state === "saving") {
    return (
      <span
        className={
          base +
          " border-[var(--color-border)] bg-white/[0.04] text-[var(--color-text-muted)]"
        }
        aria-live="polite"
      >
        <Loader2 size={11} className="animate-spin" strokeWidth={2.4} />
        Сохраняю…
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        className={
          base + " border-red-500/30 bg-red-500/10 text-red-300"
        }
        title={lastSaveError ?? t("Не удалось сохранить")}
        aria-live="assertive"
      >
        <AlertCircle size={11} strokeWidth={2.4} />
        Ошибка сохранения
      </span>
    );
  }
  // 'saved'
  return (
    <span
      className={
        base +
        " border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      }
      title={
        lastSavedAt !== null ? new Date(lastSavedAt).toLocaleString("ru-RU") : ""
      }
    >
      <Check size={11} strokeWidth={2.4} />
      Сохранено · {fmtSavedAt(lastSavedAt)}
    </span>
  );
}

function FavoriteButton({
  favorite,
  onClick,
}: {
  favorite: boolean;
  onClick: () => void;
}) {
  const label = favorite ? "Убрать из избранного" : "В избранное";
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={favorite}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-md transition-colors",
        favorite
          ? "text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/15"
          : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]",
      )}
    >
      <Star
        size={13}
        strokeWidth={2}
        fill={favorite ? "currentColor" : "none"}
      />
      {favorite ? "В избранном" : "В избранное"}
    </button>
  );
}
