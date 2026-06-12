import { open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { Loader2, Shuffle, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import {
  COVER_PREFIX,
  GRADIENTS,
  randomGradientToken,
  urlCoverToken,
} from "../lib/covers";
import { COVER_CATEGORIES } from "../lib/coverGallery";
import { t } from "../lib/i18n";
import { reportError, useNotesStore } from "../store/notes";

const PICKER_WIDTH_PX = 480;
const PICKER_MAX_BODY_HEIGHT_PX = 420;
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"] as const;
const CATEGORY_SECTION_ID_PREFIX = "cover-cat-";

type Tab = "gallery" | "gradients";

// ─── Компонент ─────────────────────────────────────────────────────────────

export function CoverPicker({
  onClose,
  hasCover,
}: {
  onClose: () => void;
  hasCover: boolean;
}) {
  const saveNote = useNotesStore((s) => s.saveNote);
  const uploadCoverFromDisk = useNotesStore((s) => s.uploadCoverFromDisk);
  const [tab, setTab] = useState<Tab>("gallery");
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Подстраховочный хендлер Esc. Обычно состоянием открытия рулит родитель, но
  // держим свой, чтобы пикер работал и сам по себе, и если родитель забыл.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickGradient = (id: string) => {
    void saveNote({ cover: `${COVER_PREFIX.gradient}${id}` });
    onClose();
  };

  const pickUrl = (url: string) => {
    void saveNote({ cover: urlCoverToken(url) });
    onClose();
  };

  const pickRandomGradient = () => {
    void saveNote({ cover: randomGradientToken() });
    onClose();
  };

  const remove = () => {
    void saveNote({ cover: null });
    onClose();
  };

  // ─── Нативный диалог файла, затем импорт ──────────────────────────────────────
  // Tauri IPC может упасть (права, ошибка плагина), поэтому try/catch, чтобы
  // пикер не завис в состоянии загрузки при реджекте.
  const handleUpload = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Изображения", extensions: [...IMAGE_EXTS] }],
      });
      if (typeof selected === "string") {
        await uploadCoverFromDisk(selected);
        onClose();
      }
    } catch (e) {
      // Раньше падения диалога открытия были молчаливыми: пикер просто
      // откатывался в покой без какой-либо реакции ("он завис?"). reportError
      // показывает тост и заодно оставляет лог в консоли.
      reportError(t("Не удалось открыть выбор файла"), "CoverPicker: upload dialog failed:", e);
    } finally {
      setUploading(false);
    }
  };

  const jumpTo = (catId: string) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `#${CATEGORY_SECTION_ID_PREFIX}${catId}`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      style={{ width: PICKER_WIDTH_PX }}
      className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-overlay)] shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-hidden flex flex-col"
      role="dialog"
      aria-label="Выбор обложки"
    >
      {/* Вкладки и тулбар */}
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-1">
          <TabBtn active={tab === "gallery"} onClick={() => setTab("gallery")}>
            Галерея
          </TabBtn>
          <TabBtn
            active={tab === "gradients"}
            onClick={() => setTab("gradients")}
          >
            Градиенты
          </TabBtn>
        </div>
        <div className="flex items-center gap-0.5">
          <ToolBtn
            title={uploading ? t("Загрузка...") : t("С диска")}
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            ) : (
              <Upload size={13} strokeWidth={2} />
            )}
          </ToolBtn>
          {tab === "gradients" && (
            <ToolBtn title="Случайный" onClick={pickRandomGradient}>
              <Shuffle size={13} strokeWidth={2} />
            </ToolBtn>
          )}
          <ToolBtn title={t("Закрыть")} onClick={onClose}>
            <X size={13} strokeWidth={2} />
          </ToolBtn>
        </div>
      </div>

      {tab === "gallery" ? (
        <GalleryTab
          scrollRef={scrollRef}
          onJumpToCategory={jumpTo}
          onPickUrl={pickUrl}
        />
      ) : (
        <GradientsTab onPick={pickGradient} />
      )}

      {hasCover && (
        <button
          type="button"
          onClick={remove}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-[12px] text-zinc-500 hover:text-red-300 hover:bg-red-500/10 border-t border-[var(--color-border)] transition-colors shrink-0"
        >
          <Trash2 size={12} strokeWidth={2} />
          Удалить обложку
        </button>
      )}
    </motion.div>
  );
}

// ─── Вкладки ──────────────────────────────────────────────────────────────────

function GalleryTab({
  scrollRef,
  onJumpToCategory,
  onPickUrl,
}: {
  scrollRef: React.Ref<HTMLDivElement>;
  onJumpToCategory: (catId: string) => void;
  onPickUrl: (url: string) => void;
}) {
  return (
    <>
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex flex-wrap gap-1 shrink-0">
        {COVER_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onJumpToCategory(cat.id)}
            className="text-[11px] px-2 py-1 rounded-full font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto p-3 space-y-4"
        style={{ maxHeight: PICKER_MAX_BODY_HEIGHT_PX }}
      >
        {COVER_CATEGORIES.map((cat) => (
          <section key={cat.id} id={`${CATEGORY_SECTION_ID_PREFIX}${cat.id}`}>
            <h4 className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-0.5">
              {cat.label}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {cat.thumbs.map((thumb, i) => (
                <ThumbButton
                  key={`${cat.id}-${i}`}
                  thumb={thumb}
                  onPick={() => onPickUrl(cat.full(i))}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function GradientsTab({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div
      className="p-3 overflow-y-auto"
      style={{ maxHeight: PICKER_MAX_BODY_HEIGHT_PX }}
    >
      <div className="grid grid-cols-4 gap-1.5">
        {GRADIENTS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onPick(g.id)}
            title={g.name}
            aria-label={`Градиент ${g.name}`}
            className={cn(
              g.className,
              "aspect-video rounded-md ring-1 ring-inset ring-white/10",
              // transition (а не transition-all) анимирует только дефолтный
              // GPU-дружелюбный набор (transform/box-shadow/opacity/colors) и
              // никогда свойства, влияющие на layout.
              "hover:ring-white/40 hover:scale-[1.04] transition",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ThumbButton({
  thumb,
  onPick,
}: {
  thumb: string;
  onPick: () => void;
}) {
  // Состояние в React на случай битой картинки. Чище, чем дёргать DOM напрямую
  // через e.currentTarget.style.display.
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <button
      type="button"
      onClick={onPick}
      className="aspect-[16/7] rounded-md overflow-hidden ring-1 ring-inset ring-white/10 hover:ring-white/40 transition hover:scale-[1.03] bg-[var(--color-pre-bg)]"
    >
      <img
        src={thumb}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[12px] px-2.5 py-1 rounded-md font-medium transition-colors",
        active
          ? "text-white bg-white/[0.08]"
          : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]",
      )}
    >
      {children}
    </button>
  );
}

function ToolBtn({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={cn(
        "p-1.5 rounded transition-colors",
        disabled
          ? "text-zinc-700 cursor-not-allowed"
          : "text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.06]",
      )}
    >
      {children}
    </button>
  );
}
