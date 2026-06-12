import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, FileText, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSelection } from "../hooks/useSelection";
import { cn } from "../lib/cn";
import { DEFAULT_NOTE_TITLE, formatBytes, pluralRu } from "../lib/format";
import { t } from "../lib/i18n";
import type { AssetInfo } from "../lib/storage";
import { confirmDialog } from "../store/confirm";
import { useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { BulkActionBar } from "./BulkActionBar";

const HASH_PREVIEW_CHARS = 8;
const USAGE_CHIP_MAX_WIDTH_PX = 140;
const THUMB_FALLBACK_ICON_PX = 28;
const SKELETON_CARDS = 6;

/** Синтетические id использования, которые отдаёт listAssets(), чтобы ссылки
 *  из корзины и снапшотов версий нельзя было молча удалить. Реальным заметкам
 *  они не соответствуют, так что клик по чипу не должен слать их в selectNote
 *  (тот закоммитил бы activeId на несуществующую заметку и увёл AnimatePresence
 *  в сломанный экран редактора). */
const SYNTHETIC_USAGE_IDS: ReadonlySet<string> = new Set([
  "__trash__",
  "__versions__",
]);

const CARD_ANIM = {
  initial: { opacity: 0, y: 8, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: {
    opacity: 0,
    scale: 0.88,
    y: -4,
    transition: { duration: 0.18 },
  },
  // Без `layout`: карточки на стабильных именах SHA-256 и никогда не
  // переставляются, так что механика FLIP только мерила бы относительно
  // y-трансформа обёртки App в полёте и добавляла бы каждой карточке фантомные
  // сдвиги.
  transition: {
    opacity: { duration: 0.22 },
    scale: { duration: 0.22 },
    y: { duration: 0.22 },
  },
};

// ─── Компонент ─────────────────────────────────────────────────────────────

export function ImagesView() {
  const assets = useNotesStore((s) => s.assets);
  const assetsLoaded = useNotesStore((s) => s.assetsLoaded);
  const refreshAssets = useNotesStore((s) => s.refreshAssets);
  const deleteAsset = useNotesStore((s) => s.deleteAsset);
  const batchDeleteAssets = useNotesStore((s) => s.batchDeleteAssets);
  const setView = useNotesStore((s) => s.setView);
  const selectNote = useNotesStore((s) => s.selectNote);

  // Один рефреш при монтировании. Tauri IPC может отвалиться ещё до создания
  // `.assets/` (права, нет папки на первом запуске), так что показываем это
  // явно, а не отпускаем как unhandledrejection.
  useEffect(() => {
    let cancelled = false;
    refreshAssets().catch((err) => {
      if (!cancelled) console.error("ImagesView: refreshAssets failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshAssets]);

  const sel = useSelection<string>();

  const { totalBytes, unused, unusedNames } = useMemo(() => {
    let bytes = 0;
    const unusedList: AssetInfo[] = [];
    for (const a of assets) {
      bytes += a.sizeBytes;
      if (a.usedBy.length === 0) unusedList.push(a);
    }
    return {
      totalBytes: bytes,
      unused: unusedList,
      // Поиск по Set это O(1) против прежнего O(N) `Array.includes` на элемент.
      unusedNames: new Set(unusedList.map((a) => a.name)),
    };
  }, [assets]);

  const selectedUnused = useMemo(
    () => Array.from(sel.selection).filter((n) => unusedNames.has(n)),
    [sel.selection, unusedNames],
  );
  const hasSelectedUsed = sel.size > selectedUnused.length;

  const headerSummary = !assetsLoaded
    ? t("Загрузка…")
    : assets.length === 0
      ? "Загруженных изображений пока нет"
      : `${assets.length} ${pluralRu(assets.length, "файл", "файла", "файлов")} · ${formatBytes(totalBytes)}${
          unused.length > 0 ? ` · ${unused.length} не используются` : ""
        }`;

  const handleSingleDelete = async (asset: AssetInfo) => {
    if (asset.usedBy.length > 0) return;
    if (await confirmDialog(t("Удалить {name}? Файл нигде не используется.", { name: asset.name }))) {
      void deleteAsset(asset.name);
    }
  };

  // try/finally гарантирует, что выделение очистится, даже если пакетная
  // операция упадёт, иначе у юзера останется устаревший чип "выделено N" со
  // ссылками на имена, которых на диске может уже не быть.
  const handleBulkDelete = async () => {
    if (selectedUnused.length === 0) return;
    const word = pluralRu(selectedUnused.length, "файл", "файла", "файлов");
    if (!(await confirmDialog(t("Удалить {count} {word}?", { count: selectedUnused.length, word })))) return;
    try {
      await batchDeleteAssets(selectedUnused);
      useToastStore
        .getState()
        .push(`Удалено: ${selectedUnused.length} ${word}`, "success");
    } catch (err) {
      console.error("ImagesView: bulk delete failed:", err);
      useToastStore
        .getState()
        .push(t("Не удалось удалить некоторые файлы"), "error");
    } finally {
      sel.clear();
    }
  };

  const handleOpenUsage = async (noteId: string) => {
    // Синтетические id из listAssets() это не настоящие заметки. Прогон их
    // через selectNote закоммитил бы activeId в пустоту и увёл AnimatePresence
    // в сломанный экран редактора. У корзины свой вью, а чип снапшота версий
    // чисто информационный (глобального UI версий нет).
    if (SYNTHETIC_USAGE_IDS.has(noteId)) {
      if (noteId === "__trash__") setView("trash");
      return;
    }

    // ВАЖЕН ПОРЯДОК: ждём selectNote ДО setView. Раньше handleOpenUsage пулял
    // setView("notes") и selectNote(id) в одном тике, и получались ДВА
    // ключевых перехода подряд (images, gallery, editor) внутри
    // <AnimatePresence mode="wait">. Юзер мог вернуться во вью изображений,
    // пока второй exit ещё летел, и новая обёртка монтировалась залипшей на
    // стартовой opacity (карточки есть, DOM ловит клики, но не видно ничего).
    // Если ждать сначала, activeId коммитится, и setView даёт ОДИН переход
    // прямиком из изображений в редактор.
    await selectNote(noteId);
    setView("notes");
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 flex items-end justify-between border-b border-[var(--color-border)] shrink-0">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Изображения
          </h2>
          <p className="text-[13px] text-zinc-500 mt-1">{headerSummary}</p>
        </div>
        {unused.length > 0 && (
          <button
            type="button"
            onClick={() => sel.selectAll(unused.map((a) => a.name))}
            className="text-[13px] text-zinc-400 hover:text-zinc-100 px-3 py-1.5 rounded-md hover:bg-white/[0.04] transition-colors font-medium"
          >
            Выбрать неиспользуемые
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <div className="max-w-7xl mx-auto">
        {!assetsLoaded ? (
          // Скелетон на время первого холодного скана (на воркспейсах с кучей
          // снапшотов .versions/ может занять пару секунд). Без него юзер на миг
          // видит <EmptyState/> ("пусто"), который потом сменяется реальной
          // сеткой, и это выглядело как баг.
          <AssetGridSkeleton />
        ) : assets.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <AnimatePresence initial={false}>
              {assets.map((asset) => (
                <AssetCard
                  key={asset.name}
                  asset={asset}
                  selected={sel.has(asset.name)}
                  selecting={sel.isSelecting}
                  onToggleSelect={() => sel.toggle(asset.name)}
                  onDelete={() => handleSingleDelete(asset)}
                  onOpenUsage={handleOpenUsage}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
        </div>
      </div>

      <BulkActionBar
        count={sel.size}
        total={unused.length}
        onClear={sel.clear}
        onSelectAll={() => sel.selectAll(unused.map((a) => a.name))}
        actions={[
          {
            id: "delete",
            label: hasSelectedUsed
              ? t("Удалить ({count})", { count: selectedUnused.length })
              : t("Удалить"),
            icon: Trash2,
            variant: "danger",
            disabled: selectedUnused.length === 0,
            onClick: handleBulkDelete,
          },
        ]}
      />
    </div>
  );
}

// ─── Карточка ассета ────────────────────────────────────────────────────────────

type AssetCardProps = {
  asset: AssetInfo;
  selected: boolean;
  selecting: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onOpenUsage: (noteId: string) => void;
};

function AssetCard({
  asset,
  selected,
  selecting,
  onToggleSelect,
  onDelete,
  onOpenUsage,
}: AssetCardProps) {
  const canSelect = asset.usedBy.length === 0;
  const isUsed = !canSelect;

  return (
    <motion.div
      initial={CARD_ANIM.initial}
      animate={CARD_ANIM.animate}
      exit={CARD_ANIM.exit}
      transition={CARD_ANIM.transition}
      onClick={() => {
        if (selecting && canSelect) onToggleSelect();
      }}
      className={cn(
        "group rounded-xl border overflow-hidden flex flex-col transition-colors",
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent-bg)] ring-1 ring-[var(--color-accent-border)]"
          : "border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)]",
        selecting && canSelect && "cursor-pointer",
      )}
    >
      <AssetThumb
        asset={asset}
        canSelect={canSelect}
        selected={selected}
        selecting={selecting}
        onToggleSelect={onToggleSelect}
      />

      <div className="p-3 flex-1 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="text-[12px] text-zinc-400 font-mono truncate"
              title={asset.name}
            >
              {previewAssetName(asset.name)}
            </div>
            <div className="text-[11px] text-zinc-600 mt-0.5">
              {formatBytes(asset.sizeBytes)}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={isUsed}
            title={isUsed ? t("Используется , удалить нельзя") : t("Удалить файл")}
            aria-label={isUsed ? t("Используется , удалить нельзя") : t("Удалить файл")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              isUsed
                ? "text-zinc-800 cursor-not-allowed"
                : "text-zinc-500 hover:text-red-300 hover:bg-red-500/10",
            )}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1 pt-2 border-t border-[var(--color-border)] min-h-[2rem]">
          {asset.usedBy.length === 0 ? (
            <span className="text-[11px] text-zinc-600 italic">
              Не привязан к заметкам
            </span>
          ) : (
            asset.usedBy.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUsage(u.id);
                }}
                title={u.folder ? `${u.folder} / ${u.title}` : u.title}
                className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-accent-bg)] text-zinc-200 hover:text-white hover:bg-[var(--color-accent-bg-hover)] transition-colors max-w-full"
              >
                <ExternalLink size={9} strokeWidth={2.4} />
                <span
                  className="truncate"
                  style={{ maxWidth: USAGE_CHIP_MAX_WIDTH_PX }}
                >
                  {u.title || DEFAULT_NOTE_TITLE}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AssetThumb({
  asset,
  canSelect,
  selected,
  selecting,
  onToggleSelect,
}: {
  asset: AssetInfo;
  canSelect: boolean;
  selected: boolean;
  selecting: boolean;
  onToggleSelect: () => void;
}) {
  // Состояние ошибки держим в React, а не дёргаем `style.visibility` на DOM
  // напрямую: так виртуальный и реальный DOM не расходятся, и есть удобное
  // место нарисовать заглушку-иконку.
  const [imgFailed, setImgFailed] = useState(false);

  return (
    // `data-lightbox-target` это явный хук, на который слушает ImageLightbox
    // (его CONTENT_SELECTOR включает `[data-lightbox-target]`). Ставим его
    // только ВНЕ режима выделения, иначе один клик и открыл бы лайтбокс, и
    // переключил бы выделение ассета на родительской AssetCard.
    <div
      data-lightbox-target={selecting ? undefined : true}
      className="aspect-video bg-[var(--color-pre-bg)] relative overflow-hidden"
    >
      {!imgFailed && (
        /* alt="" потому что картинка декоративная, имя файла показано в теле
           карточки. Не даём скринридерам зачитывать хеш SHA-256. */
        <img
          src={asset.url}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      )}
      {imgFailed && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
          <FileText size={THUMB_FALLBACK_ICON_PX} strokeWidth={1.2} />
        </div>
      )}
      {canSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-label={selected ? "Снять выделение" : "Выделить"}
          aria-pressed={selected}
          className={cn(
            "absolute top-2 left-2 w-5 h-5 rounded-md flex items-center justify-center transition-all",
            selected
              ? "bg-[var(--color-accent)] text-white opacity-100"
              : "bg-black/40 backdrop-blur text-transparent border border-white/20 opacity-0 group-hover:opacity-100",
            selecting && !selected && "opacity-100",
          )}
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </button>
      )}
      {asset.usedBy.length === 0 && (
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[10px] uppercase tracking-wider font-semibold border border-red-500/30 backdrop-blur-sm">
          Не используется
        </div>
      )}
    </div>
  );
}

function AssetGridSkeleton() {
  // Статичная сетка-заглушка под брейкпоинты реальной сетки, чтобы не было
  // скачка вёрстки, когда придут данные. animate-pulse даёт мягкое мерцание,
  // framer-motion тут нет, чтобы не лезть в монтажные переходы AnimatePresence
  // у настоящих карточек.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-hidden animate-pulse"
        >
          <div className="aspect-video bg-[var(--color-pre-bg)]" />
          <div className="p-3 space-y-2">
            <div className="h-3 w-2/3 rounded bg-white/[0.04]" />
            <div className="h-2 w-1/3 rounded bg-white/[0.03]" />
            <div className="pt-2 border-t border-[var(--color-border)]">
              <div className="h-3 w-24 rounded bg-white/[0.04]" />
            </div>
          </div>
        </div>
      ))}
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
      Загруженные обложки появятся здесь. Одинаковые файлы хранятся один раз ,
      дедупликация по содержимому (SHA-256).
    </motion.div>
  );
}

/**
 * Короткое представление имени файла ассета:
 *   `abcdef12.png` для SHA-имени, просто `abcdef12`, если расширения нет.
 * Надёжнее, чем `slice(name.lastIndexOf("."))`, который возвращает не тот срез
 * (и, возможно, последний символ), когда в имени нет точки.
 */
function previewAssetName(name: string): string {
  const dot = name.lastIndexOf(".");
  const prefix = name.slice(0, HASH_PREVIEW_CHARS);
  const ext = dot === -1 ? "" : name.slice(dot);
  return `${prefix}…${ext}`;
}
