import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Archive,
  CalendarDays,
  Check,
  FolderOpen,
  Globe,
  HardDrive,
  Keyboard,
  Palette,
  RefreshCw,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { backupWorkspace, restoreWorkspace } from "../lib/backup";
import { confirmDialog } from "../store/confirm";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { useI18n } from "./LanguageProvider";
import {
  ACCENT_PRESETS,
  accelFromKeyboardEvent,
  DEFAULT_SETTINGS,
  isValidHex,
  isValidIcsUrl,
  normalizeHex,
  prettyAccelerator,
} from "../lib/settings";
import { getWorkspaceDir } from "../lib/storage";
import { useCalendarStore } from "../store/calendar";
import { useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";

// Клавиши, которые являются ТОЛЬКО модификаторами: игнорируются при записи
// комбинации, ждём реальную клавишу перед сборкой хоткея.
const LONE_MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function SettingsView() {
  const settings = useNotesStore((s) => s.settings);
  const updateSettings = useNotesStore((s) => s.updateSettings);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-10 py-6 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
          {t("Настройки")}
        </h2>
        <p className="text-[13px] text-zinc-500 mt-1">
          {t("Внешний вид, быстрая заметка и хранилище")}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-10 py-8">
        <div className="max-w-2xl space-y-10">
          <LanguageSection />
          <AccentSection
            value={settings.accentColor}
            onChange={(hex) => void updateSettings({ accentColor: hex })}
          />
          <DailySection
            value={settings.openDailyOnStartup}
            onChange={(v) => void updateSettings({ openDailyOnStartup: v })}
          />
          <ShortcutSection
            value={settings.captureShortcut}
            onChange={(accel) => void updateSettings({ captureShortcut: accel })}
          />
          <CalendarSection />
          <StorageSection />
        </div>
      </div>
    </div>
  );
}

// ─── Оболочка секции ───────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2.5">
        <Icon
          size={16}
          strokeWidth={2}
          className="text-[var(--color-accent)] shrink-0"
        />
        <h3 className="text-[15px] font-semibold text-zinc-200">{title}</h3>
      </div>
      {description && (
        <p className="text-[13px] text-zinc-500 mt-1 ml-[26px]">{description}</p>
      )}
      <div className="mt-4 ml-[26px]">{children}</div>
    </section>
  );
}

function LanguageSection() {
  const { lang, setLang } = useI18n();

  return (
    <Section
      icon={Globe}
      title="Language"
      description="Interface language"
    >
      <div className="flex items-center gap-2">
        {(["ru", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={cn(
              "px-4 py-1.5 rounded-md text-[13px] font-medium border transition-colors",
              lang === l
                ? "border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                : "border-[var(--color-border-strong)] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]",
            )}
          >
            {l === "ru" ? "Русский" : "English"}
          </button>
        ))}
      </div>
    </Section>
  );
}

function AccentSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  // Локальное зеркало текстового поля hex, чтобы юзер мог свободно вводить.
  // Коммитим только валидный 6-значный hex (на blur / Enter).
  const [custom, setCustom] = useState(value);
  useEffect(() => setCustom(value), [value]);

  const commitCustom = (raw: string) => {
    if (isValidHex(raw)) onChange(normalizeHex(raw));
    else setCustom(value); // snap back to the applied colour
  };

  return (
    <Section
      icon={Palette}
      title={t("Акцентный цвет")}
      description={t("Цвет выделения, ссылок и активных элементов")}
    >
      <div className="flex flex-wrap gap-2.5 mb-4">
        {ACCENT_PRESETS.map((p) => {
          const active = normalizeHex(value) === normalizeHex(p.hex);
          return (
            <button
              key={p.hex}
              type="button"
              title={p.label}
              aria-label={p.label}
              aria-pressed={active}
              onClick={() => onChange(normalizeHex(p.hex))}
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110",
                active &&
                  "ring-2 ring-offset-2 ring-offset-[var(--color-bg)] ring-white/80",
              )}
              style={{ backgroundColor: p.hex }}
            >
              {active && (
                <Check size={14} strokeWidth={3} className="text-white" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <input
          type="color"
          aria-label={t("Выбрать свой цвет")}
          value={isValidHex(custom) ? normalizeHex(custom) : value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-md bg-transparent border border-[var(--color-border-strong)] cursor-pointer p-0.5"
        />
        <input
          type="text"
          value={custom}
          spellCheck={false}
          placeholder="#6366f1"
          onChange={(e) => setCustom(e.target.value)}
          onBlur={() => commitCustom(custom)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCustom(custom);
          }}
          className="w-32 px-3 py-1.5 rounded-md bg-white/[0.04] border border-[var(--color-border-strong)] text-[13px] text-zinc-200 font-mono outline-none focus:border-[var(--color-accent-border)]"
        />
        <span className="text-[12px] text-zinc-500">{t("Свой цвет (HEX)")}</span>
      </div>
    </Section>
  );
}

function DailySection({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Section
      icon={Sparkles}
      title={t("Заметка дня")}
      description={t("Поведение при запуске приложения")}
    >
      <Toggle
        checked={value}
        onChange={onChange}
        label={t("Открывать заметку дня при запуске")}
      />
    </Section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 group"
    >
      <span
        className={cn(
          "relative w-9 h-5 rounded-full transition-colors shrink-0",
          checked ? "bg-[var(--color-accent)]" : "bg-white/[0.12]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
      <span className="text-[13px] text-zinc-300 group-hover:text-zinc-100 transition-colors">
        {label}
      </span>
    </button>
  );
}

function ShortcutSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (accel: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      // Capture-фаза + preventDefault: глотаем нажатие, чтобы оно не
      // триггерило глобальные хоткеи (undo/redo и т.п.) пока записываем.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        setHint(null);
        return;
      }
      if (LONE_MODIFIERS.has(e.key)) return; // ждём реальную клавишу
      const accel = accelFromKeyboardEvent(e);
      if (!accel) {
        setHint(t("Нужен модификатор (Ctrl / Alt / Shift) + буква, цифра или F-клавиша"));
        return;
      }
      onChange(accel);
      setRecording(false);
      setHint(null);
    };
    // Capture-фаза, чтобы работать раньше bubble-phase обработчика App.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  const isDefault = value === DEFAULT_SETTINGS.captureShortcut;

  return (
    <Section
      icon={Keyboard}
      title={t("Хоткей быстрой заметки")}
      description={t("Глобальная комбинация для окна быстрой записи , работает даже когда приложение свёрнуто в трей")}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setRecording((r) => !r);
            setHint(null);
          }}
          className={cn(
            "min-w-[170px] px-4 py-2 rounded-md text-[13px] font-medium border transition-colors text-center",
            recording
              ? "border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-[var(--color-accent)] animate-pulse"
              : "border-[var(--color-border-strong)] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]",
          )}
        >
          {recording ? t("Нажмите комбинацию…") : prettyAccelerator(value)}
        </button>
        {!isDefault && !recording && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_SETTINGS.captureShortcut)}
            className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {t("Сбросить")}
          </button>
        )}
      </div>
      {hint && <p className="text-[12px] text-amber-400/80 mt-2">{hint}</p>}
    </Section>
  );
}

function CalendarSection() {
  const url = useNotesStore((s) => s.settings.calendarIcsUrl);
  const updateSettings = useNotesStore((s) => s.updateSettings);
  const status = useCalendarStore((s) => s.status);
  const error = useCalendarStore((s) => s.error);
  const eventCount = useCalendarStore((s) => s.events.length);
  const lastSync = useCalendarStore((s) => s.lastSync);
  const syncNow = useCalendarStore((s) => s.syncNow);

  // Локальное зеркало, чтобы юзер мог свободно вводить; коммит (+ пересинхронизация)
  // на blur/Enter.
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);

  const commit = () => {
    const next = draft.trim();
    if (next === url) return;
    if (next !== "" && !isValidIcsUrl(next)) {
      setDraft(url); // не http(s) URL -- откат к сохранённому значению
      return;
    }
    void updateSettings({ calendarIcsUrl: next }).then(() => {
      if (next) void syncNow();
    });
  };

  return (
    <Section
      icon={CalendarDays}
      title={t("Календарь")}
      description={t("Подключить внешний календарь по приватной ссылке iCalendar (.ics) , только чтение")}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          spellCheck={false}
          placeholder="https://calendar.yandex.ru/export/ics.xml?private_token=…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          className="flex-1 min-w-0 px-3 py-1.5 rounded-md bg-white/[0.04] border border-[var(--color-border-strong)] text-[13px] text-zinc-200 font-mono outline-none focus:border-[var(--color-accent-border)]"
        />
        <button
          type="button"
          disabled={!url || status === "loading"}
          onClick={() => void syncNow()}
          title={t("Синхронизировать")}
          className="shrink-0 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium bg-white/[0.04] border border-[var(--color-border-strong)] text-zinc-200 hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-default"
        >
          <RefreshCw
            size={14}
            strokeWidth={2}
            className={cn(status === "loading" && "animate-spin")}
          />
          {t("Обновить")}
        </button>
      </div>

      <div className="mt-2 min-h-[18px] text-[12px]">
        {status === "loading" && <span className="text-zinc-500">{t("Синхронизация…")}</span>}
        {status === "error" && (
          <span className="text-red-400/90 break-words">{t("Ошибка")}: {error}</span>
        )}
        {status === "ok" && (
          <span className="text-zinc-500">
            Событий: {eventCount}
            {lastSync != null
              ? ` · обновлено ${new Date(lastSync).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
        )}
      </div>

      <p className="text-[12px] text-zinc-600 mt-2 leading-relaxed">
        В Яндекс.Календаре: «Настройки» , нужный календарь , скопируйте приватную
        ссылку (iCal). Ссылка содержит секретный токен , не делитесь ей.
      </p>
    </Section>
  );
}

function StorageSection() {
  const [path, setPath] = useState<string | null>(null);
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const refreshTree = useNotesStore((s) => s.refreshTree);
  const refreshTrash = useNotesStore((s) => s.refreshTrash);
  const refreshAssets = useNotesStore((s) => s.refreshAssets);

  const runBackup = async () => {
    setBacking(true);
    try {
      const saved = await backupWorkspace();
      if (saved) {
        useToastStore.getState().push(t("Бэкап сохранён"), "success");
      }
      // saved === null意味着 юзер отменил диалог сохранения, тост не показываем.
    } catch (e) {
      console.error("backup failed:", e);
      useToastStore.getState().push(t("Не удалось создать бэкап"), "error");
    } finally {
      setBacking(false);
    }
  };

  const runRestore = async () => {
    // 1) Выбираем исходный zip. open() возвращает null если юзер отменил,
    //    молчаливый выход, без тоста (отмена была осознанной).
    let picked: string | string[] | null = null;
    try {
      picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Архив", extensions: ["zip"] }],
      });
    } catch (e) {
      console.error("restore: open dialog failed:", e);
      useToastStore.getState().push(t("Не удалось открыть выбор файла"), "error");
      return;
    }
    if (!picked || Array.isArray(picked)) return; // cancelled / impossible

    // 2) Жёсткое подтверждение: восстановление деструктивно (текущая папка
    //    архивируется в notes.bak-<ts>, но это всё равно сюрприз если юзер
    //    случайно нажал). confirmDialog возвращает false при отмене/Escape.
    const ok = await confirmDialog(
      t("Это перезапишет всю текущую папку заметок. Текущее состояние сохранится в notes.bak-<дата> рядом. Продолжить?"),
      { confirmLabel: t("Восстановить"), danger: true },
    );
    if (!ok) return;

    // 3) Запускаем. resetStorageCaches внутри restoreWorkspace сбрасывает
    //    кэши meta + refs, так что refresh ниже увидит новый диск. Активная
    //    заметка вероятно устарела (её id может не существовать в восстановленном
    //    наборе), поэтому чистим её тоже: юзер попадёт в дерево.
    setRestoring(true);
    try {
      const { backupDir, filesRestored } = await restoreWorkspace(picked);
      // Чистим активную заметку перед рефрешем: она почти наверняка указывает
      // на id которого нет в восстановленном дереве.
      useNotesStore.setState({ activeId: null, activeNote: null });
      await Promise.all([refreshTree(), refreshTrash(), refreshAssets()]);
      useToastStore
        .getState()
        .push(
          t(`Восстановлено · ${filesRestored} файлов · старая папка , ${backupDir}`),
          "success",
        );
    } catch (e) {
      console.error("restore failed:", e);
      useToastStore
        .getState()
        .push(
          t(`Не удалось восстановить: ${(e as Error)?.message ?? String(e)}`),
          "error",
        );
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void getWorkspaceDir()
      .then((p) => {
        if (alive) setPath(p);
      })
      .catch((e) => console.error("getWorkspaceDir failed:", e));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Section
      icon={HardDrive}
      title={t("Хранилище")}
      description={t("Где лежат все заметки, изображения и корзина")}
    >
      <div className="mb-3 px-3 py-2 rounded-md bg-white/[0.03] border border-[var(--color-border)]">
        <code className="text-[12px] text-zinc-400 font-mono break-all">
          {path ?? "…"}
        </code>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!path}
          onClick={() => {
            if (path)
              void revealItemInDir(path).catch((e) =>
                console.error("revealItemInDir failed:", e),
              );
          }}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium bg-white/[0.04] border border-[var(--color-border-strong)] text-zinc-200 hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-default"
        >
          <FolderOpen size={14} strokeWidth={2} />
          {t("Открыть папку")}
        </button>
        <button
          type="button"
          disabled={backing || restoring}
          onClick={() => void runBackup()}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium bg-white/[0.04] border border-[var(--color-border-strong)] text-zinc-200 hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-default"
        >
          <Archive size={14} strokeWidth={2} />
          {backing ? t("Создаю бэкап…") : t("Создать бэкап (.zip)")}
        </button>
        <button
          type="button"
          disabled={backing || restoring}
          onClick={() => void runRestore()}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium bg-white/[0.04] border border-[var(--color-border-strong)] text-zinc-200 hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-default"
        >
          <Upload size={14} strokeWidth={2} />
          {restoring ? t("Восстанавливаю…") : t("Восстановить из бэкапа…")}
        </button>
      </div>
      <p className="text-[12px] text-zinc-600 mt-3">
        Бэкап собирает все заметки в один .zip , выберите, куда сохранить
        (облако, флешка, любая папка). Восстановление полностью заменит
        текущую папку; предыдущее состояние сохранится в{" "}
        <code className="font-mono text-zinc-500">notes.bak-&lt;дата&gt;</code>{" "}
        рядом, на случай если потребуется откатиться.
      </p>
    </Section>
  );
}
