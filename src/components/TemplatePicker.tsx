// src/components/TemplatePicker.tsx
//
// Одна Modal на два режима: "выбрать шаблон" и "управление шаблонами".
// Монтируется один раз на корне приложения, рулит ей
// useTemplatesStore.pickerMode (null | pick | manage).
//
// Оба режима делят одну и ту же сетку карточек, отличается лишь поведение:
//   - "pick"   клик по карточке ПРИМЕНЯЕТ шаблон к активной заметке.
//   - "manage" у каждой карточки кнопки переименовать / открыть / удалить, а
//              клик по телу карточки ничего не делает (чтобы случайный клик
//              мимо кнопки удаления не применил шаблон).
//
// Никакого нового вью и пункта в сайдбаре, только Modal, так и задумано.
// Шаблоны это каркас, а не тяжёлый рабочий экран. Если ими начнут активно
// пользоваться, потом вынесем в полноценный вью.

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, FileEdit, X } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { promptDialog } from "../store/confirm";
import { useNotesStore } from "../store/notes";
import {
  useTemplatesStore,
  type TemplatePickerMode,
} from "../store/templates";
import type { TemplateMeta } from "../lib/templates";

/** Предел для превью-сниппета на карточке. ~120 символов как раз две строки на
 *  ширину карточки, не ломая раскладку. */
const PREVIEW_MAX = 120;

// ─── Компонент ─────────────────────────────────────────────────────────────

export function TemplatePicker() {
  const pickerMode = useTemplatesStore((s) => s.pickerMode);
  const closeTemplatePicker = useTemplatesStore((s) => s.closeTemplatePicker);
  const openTemplatePicker = useTemplatesStore((s) => s.openTemplatePicker);
  const templates = useTemplatesStore((s) => s.templates);
  const loaded = useTemplatesStore((s) => s.loaded);
  const refresh = useTemplatesStore((s) => s.refresh);
  const renameTemplate = useTemplatesStore((s) => s.renameTemplate);
  const deleteTemplate = useTemplatesStore((s) => s.deleteTemplate);
  const applyTemplateToActiveNote = useTemplatesStore(
    (s) => s.applyTemplateToActiveNote,
  );

  // На каждое открытие пикера обновляем кэш. Закрывает случай, когда юзер в
  // прошлой сессии удалил шаблон-как-заметку и кэш протух.
  useEffect(() => {
    if (pickerMode !== null) void refresh();
  }, [pickerMode, refresh]);

  const open = pickerMode !== null;

  return (
    <Modal
      open={open}
      onClose={closeTemplatePicker}
      role="dialog"
      ariaLabel={t("Шаблоны")}
      panelClassName="w-full max-w-2xl bg-[var(--color-bg-overlay)] border border-[var(--color-border-strong)] rounded-xl shadow-2xl shadow-black/70 flex flex-col max-h-[80vh]"
    >
      <Header
        mode={pickerMode}
        onSwitch={(m) => openTemplatePicker(m)}
        onClose={closeTemplatePicker}
      />
      <div className="overflow-y-auto px-5 py-4 min-h-[200px]">
        {!loaded ? (
          <div className="text-center text-sm text-[var(--color-text-tertiary)] py-12">
            {t("Загружаю…")}
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center text-sm text-[var(--color-text-tertiary)] py-12">
            {t("Пока нет шаблонов")}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {templates.map((meta) => (
              <TemplateCard
                key={meta.id}
                meta={meta}
                mode={pickerMode}
                onApply={() => void applyTemplateToActiveNote(meta.id)}
                onRename={async () => {
                  const next = await promptDialog(t("Новое название"), {
                    defaultValue: meta.name,
                    confirmLabel: t("Переименовать"),
                  });
                  if (next !== null && next !== meta.name) {
                    await renameTemplate(meta.id, next);
                  }
                }}
                onDelete={() => void deleteTemplate(meta)}
              />
            ))}
          </div>
        )}
      </div>
      {pickerMode === "manage" && <ManageFooter />}
    </Modal>
  );
}

function Header({
  mode,
  onSwitch,
  onClose,
}: {
  mode: TemplatePickerMode;
  onSwitch: (m: Exclude<TemplatePickerMode, null>) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)]">
      <div className="text-base font-semibold text-zinc-100">{t("Шаблоны")}</div>
      <div className="flex items-center gap-2">
        <SegmentedToggle
          value={mode}
          options={[
            { value: "pick", label: t("Выбрать") },
            { value: "manage", label: t("Управление") },
          ]}
          onChange={onSwitch}
        />
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-zinc-100 hover:bg-white/[0.05] transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md bg-[var(--color-surface-1)] border border-[var(--color-border)] p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1 text-xs rounded-[5px] transition-colors",
              active
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-secondary)] hover:text-zinc-100 hover:bg-white/[0.05]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function TemplateCard({
  meta,
  mode,
  onApply,
  onRename,
  onDelete,
}: {
  meta: TemplateMeta;
  mode: TemplatePickerMode;
  onApply: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const setView = useNotesStore((s) => s.setView);
  const selectNote = useNotesStore((s) => s.selectNote);
  const closeTemplatePicker = useTemplatesStore((s) => s.closeTemplatePicker);

  // Ленивый превью-сниппет из тела шаблона. В listTemplates его заранее не
  // тянем: для небольшой коллекции это пустая работа, грузим по требованию при
  // монтировании карточки. По возможности: нет сниппета, показываем только имя.
  const [snippet, setSnippet] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { readTemplate } = await import("../lib/templates");
        const tpl = await readTemplate(meta.id);
        if (cancelled) return;
        if (!tpl) return;
        const preview = stripMarkdown(tpl.content).slice(0, PREVIEW_MAX);
        setSnippet(preview);
      } catch {
        /* как получится */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta.id]);

  const updatedRel = useRelativeTime(meta.updatedAt);

  // В режиме "pick" кликается вся карточка, в "manage" тело карточки инертно,
  // чтобы случайный клик мимо кнопок действий не применил шаблон.
  const isPick = mode === "pick";

  return (
    <div
      className={cn(
        "group/card rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] hover:border-[var(--color-border-strong)] transition-colors flex flex-col",
        isPick && "cursor-pointer hover:bg-[var(--color-surface-2)]",
      )}
      onClick={isPick ? onApply : undefined}
      role={isPick ? "button" : undefined}
      tabIndex={isPick ? 0 : -1}
      onKeyDown={
        isPick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onApply();
              }
            }
          : undefined
      }
    >
      <div className="p-3 flex-1 flex flex-col min-h-[88px]">
        <div className="flex items-center gap-2 mb-1.5">
          {meta.icon && (
            <span className="text-base" aria-hidden="true">
              {meta.icon}
            </span>
          )}
          <div className="text-sm font-medium text-zinc-100 truncate flex-1">
            {meta.name}
          </div>
          <div className="text-[11px] text-[var(--color-text-tertiary)] shrink-0">
            {updatedRel}
          </div>
        </div>
        {snippet && (
          <div className="text-xs text-[var(--color-text-tertiary)] line-clamp-2 leading-relaxed">
            {snippet}
          </div>
        )}
      </div>
      {mode === "manage" && (
        <div className="flex items-center gap-1 px-3 py-2 border-t border-[var(--color-border)]">
          <CardAction icon={Pencil} label={t("Переименовать")} onClick={onRename} />
          <CardAction
            icon={FileEdit}
            label={t("Открыть для редактирования")}
            onClick={() => {
              void selectNote(meta.id);
              setView("notes");
              closeTemplatePicker();
            }}
          />
          <div className="flex-1" />
          <CardAction
            icon={Trash2}
            label={t("Удалить")}
            danger
            onClick={onDelete}
          />
        </div>
      )}
    </div>
  );
}

function CardAction({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "p-1.5 rounded-md text-[var(--color-text-tertiary)] transition-colors",
        danger
          ? "hover:text-red-300 hover:bg-red-500/10"
          : "hover:text-zinc-100 hover:bg-white/[0.06]",
      )}
    >
      <Icon size={14} />
    </button>
  );
}

function ManageFooter() {
  const closeTemplatePicker = useTemplatesStore((s) => s.closeTemplatePicker);
  const setView = useNotesStore((s) => s.setView);
  const selectNote = useNotesStore((s) => s.selectNote);
  const refresh = useTemplatesStore((s) => s.refresh);

  const createEmpty = async () => {
    const name = await promptDialog(t("Название нового шаблона"), {
      defaultValue: t("Новый шаблон"),
      confirmLabel: t("Создать"),
    });
    if (!name) return;
    try {
      const { saveTemplate, slugifyTemplateName } = await import(
        "../lib/templates"
      );
      const slug = slugifyTemplateName(name);
      // Пустое тело saveTemplate не пропустит, поэтому кладём один заголовок:
      // юзеру есть что править, и файл валидный.
      await saveTemplate({
        id: `.templates/${slug}`,
        name,
        content: `# ${name}\n\n`,
      });
      await refresh();
      void selectNote(`.templates/${slug}`);
      setView("notes");
      closeTemplatePicker();
    } catch (e) {
      const { reportError } = await import("../store/notes");
      reportError(t("Не удалось создать шаблон"), "createEmpty failed:", name, e);
    }
  };

  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => void createEmpty()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-white bg-[var(--color-accent)] hover:bg-indigo-500 transition-colors"
      >
        <Plus size={13} strokeWidth={2} />
        {t("Создать пустой шаблон")}
      </button>
    </div>
  );
}

// ─── Хелперы ───────────────────────────────────────────────────────────────

/** Срезает часть markdown-разметки для превью-сниппета карточки. Не полноценный
 *  парсер, ровно настолько, чтобы убрать маркеры заголовков и выделения и
 *  схлопнуть пробелы, чтобы сниппет читался как обычный текст. */
function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " [код] ")
    .replace(/`[^`]*`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

function useRelativeTime(ts: number): string {
  return useMemo(() => {
    const diffMs = ts - Date.now();
    const minutes = Math.round(diffMs / 60_000);
    const hours = Math.round(diffMs / 3_600_000);
    const days = Math.round(diffMs / 86_400_000);
    if (Math.abs(minutes) < 60) return RELATIVE_TIME.format(minutes, "minute");
    if (Math.abs(hours) < 24) return RELATIVE_TIME.format(hours, "hour");
    return RELATIVE_TIME.format(days, "day");
  }, [ts]);
}
