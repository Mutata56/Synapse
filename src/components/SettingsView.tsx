import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { motion, useReducedMotion } from "framer-motion";
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
  Settings,
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
import { discover, yandexHome, type CalCollection } from "../lib/caldav";

const LONE_MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);
const EASE = [0.22, 1, 0.36, 1] as const;

const inputCls =
  "w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-[var(--color-border-strong)] text-[13px] text-zinc-200 font-mono outline-none focus:border-[var(--color-accent-border)] focus:bg-white/[0.06] transition-colors duration-200 placeholder:text-zinc-600";
const btnCls =
  "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium border border-[var(--color-border-strong)] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08] hover:border-[var(--color-accent-border)] active:scale-[0.98] transition-all duration-200 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white/[0.04] disabled:hover:border-[var(--color-border-strong)]";

export function SettingsView() {
  const settings = useNotesStore((s) => s.settings);
  const updateSettings = useNotesStore((s) => s.updateSettings);
  const reduced = useReducedMotion() ?? false;

  // `@container` на корне: вложенные сетки реагируют на ШИРИНУ самой панели, а не
  // окна. Это важно, потому что слева сидит сайдбар, и обычные viewport-брейкпоинты
  // (md:/lg:) переоценили бы доступное место. Так карточки честно встают в одну
  // колонку, когда панель ужимается.
  return (
    <div className="@container flex-1 flex flex-col overflow-hidden">
      {/* ── Шапка ── */}
      <header className="relative shrink-0 overflow-hidden px-6 pt-8 pb-6 @2xl:px-10">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--color-accent-bg)] via-transparent to-transparent opacity-70" />
        <div className="pointer-events-none absolute -top-24 right-6 h-48 w-48 rounded-full bg-[var(--color-accent)] opacity-[0.06] blur-3xl" />
        <motion.div
          initial={reduced ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="relative flex items-center gap-4"
        >
          {/* Шестерёнка слегка проворачивается при наведении, маленькая радость */}
          <motion.div
            whileHover={reduced ? undefined : { rotate: 90 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="grid place-items-center p-2.5 rounded-2xl bg-[var(--color-accent-bg)] ring-1 ring-[var(--color-accent-border)]"
          >
            <Settings size={22} className="text-[var(--color-accent)]" />
          </motion.div>
          <div>
            <h2 className="text-[26px] font-bold tracking-tight text-zinc-50">
              {t("Настройки")}
            </h2>
            <p className="text-[13px] text-zinc-500 mt-0.5">
              {t("Внешний вид, быстрая заметка и хранилище")}
            </p>
          </div>
        </motion.div>
      </header>

      {/* ── Прокручиваемое тело, разбитое на смысловые секции ── */}
      <div className="flex-1 overflow-y-auto px-6 pb-12 pt-2 @2xl:px-10">
        <div className="mx-auto w-full max-w-[920px]">
          <Section icon={Palette} title={t("Внешний вид")} index={0} reduced={reduced}>
            <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)] items-start">
              <LangCard reduced={reduced} delay={1} />
              <AccentCard
                value={settings.accentColor}
                onChange={(hex) => void updateSettings({ accentColor: hex })}
                reduced={reduced}
                delay={2}
              />
            </div>
          </Section>

          <Section icon={Sparkles} title={t("Поведение")} index={1} reduced={reduced}>
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 items-start">
              <DailyCard
                value={settings.openDailyOnStartup}
                onChange={(v) => void updateSettings({ openDailyOnStartup: v })}
                reduced={reduced}
                delay={3}
              />
              <ShortcutCard
                value={settings.captureShortcut}
                onChange={(accel) =>
                  void updateSettings({ captureShortcut: accel })
                }
                reduced={reduced}
                delay={4}
              />
            </div>
          </Section>

          <Section icon={CalendarDays} title={t("Календарь")} index={2} reduced={reduced}>
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 items-start">
              <CalendarCard reduced={reduced} delay={5} />
              <CaldavCard reduced={reduced} delay={6} />
            </div>
          </Section>

          <Section icon={HardDrive} title={t("Данные")} index={3} reduced={reduced}>
            <StorageCard reduced={reduced} delay={7} />
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── Заголовок секции ──────────────────────────────────────────────────────
// Тонкая полоска с лейблом капсом и затухающей линией: задаёт группировку, но
// не спорит по весу с самими карточками.

function Section({
  icon: Icon,
  title,
  index,
  reduced,
  children,
}: {
  icon: LucideIcon;
  title: string;
  index: number;
  reduced: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mb-9 last:mb-0">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: reduced ? 0 : index * 0.08, ease: EASE }}
        className="flex items-center gap-2.5 mb-3.5 px-0.5"
      >
        <Icon size={14} strokeWidth={2.2} className="text-[var(--color-accent)] shrink-0" />
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
          {title}
        </h3>
        <div className="flex-1 h-px bg-gradient-to-r from-[var(--color-border-strong)] via-[var(--color-border)] to-transparent" />
      </motion.div>
      {children}
    </section>
  );
}

// ─── Обёртка-карточка ──────────────────────────────────────────────────────

function Card({
  icon: Icon,
  title,
  description,
  children,
  delay,
  reduced,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  delay: number;
  reduced: boolean;
  className?: string;
}) {
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: reduced ? 0 : delay * 0.05, ease: EASE }}
      whileHover={reduced ? undefined : { y: -2, transition: { duration: 0.18, ease: EASE } }}
      // Лёгкое возвышение: своя поверхность + рамка, на ховере рамка теплеет до
      // акцента и подъезжает мягкая тень. transition сознательно НЕ трогает
      // transform, иначе он дрался бы с подъёмом по y от framer-motion.
      style={{
        background:
          "radial-gradient(130% 130% at 100% 0%, color-mix(in oklab, var(--color-accent) 7%, transparent) 0%, transparent 55%), var(--surface-1)",
      }}
      className={cn(
        "group relative overflow-hidden rounded-2xl p-5 border border-[var(--color-border)]",
        "transition-[border-color,box-shadow] duration-200",
        "hover:border-[var(--color-accent-border)] hover:shadow-[0_12px_34px_-16px_rgba(0,0,0,0.7)]",
        className,
      )}
    >
      {/* Акцентное свечение в углу, проявляется только при наведении */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-32 w-32 rounded-full bg-[var(--color-accent)] opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-[0.08]" />

      <div className="relative flex items-center gap-3 mb-4">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--color-accent-bg)] text-[var(--color-accent)] shrink-0">
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-zinc-200 leading-tight">{title}</h3>
          {description && (
            <p className="text-[12px] text-zinc-500 mt-0.5 leading-snug">{description}</p>
          )}
        </div>
      </div>
      <div className="relative">{children}</div>
    </motion.section>
  );
}

// ─── Язык ──────────────────────────────────────────────────────────────────

function LangCard({ reduced, delay }: { reduced: boolean; delay: number }) {
  const { lang, setLang } = useI18n();

  return (
    <Card icon={Globe} title="Language" description="Interface language" reduced={reduced} delay={delay}>
      <div className="flex gap-2">
        {(["ru", "en"] as const).map((l) => (
          <motion.button
            key={l}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => setLang(l)}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-[13px] font-semibold border transition-all duration-200",
              lang === l
                ? "border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                : "border-[var(--color-border-strong)] bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200",
            )}
          >
            {l === "ru" ? "Русский" : "English"}
          </motion.button>
        ))}
      </div>
    </Card>
  );
}

// ─── Акцентный цвет ────────────────────────────────────────────────────────

function AccentCard({
  value,
  onChange,
  reduced,
  delay,
}: {
  value: string;
  onChange: (hex: string) => void;
  reduced: boolean;
  delay: number;
}) {
  const [custom, setCustom] = useState(value);
  useEffect(() => setCustom(value), [value]);

  const commit = (raw: string) => {
    if (isValidHex(raw)) onChange(normalizeHex(raw));
    else setCustom(value);
  };

  return (
    <Card
      icon={Palette}
      title={t("Акцентный цвет")}
      description={t("Цвет выделения, ссылок и активных элементов")}
      reduced={reduced}
      delay={delay}
    >
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        {/* Плашки-пресеты */}
        <div className="flex flex-wrap gap-2.5 flex-1">
          {ACCENT_PRESETS.map((p) => {
            const active = normalizeHex(value) === normalizeHex(p.hex);
            return (
              <div key={p.hex} className="relative w-9 h-9">
                {active && (
                  <motion.div
                    layoutId="accent-ring"
                    className="absolute -inset-1.5 rounded-full border-2 border-white/50 pointer-events-none"
                    transition={{ type: "spring", stiffness: 380, damping: 26 }}
                  />
                )}
                <motion.button
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  aria-pressed={active}
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => onChange(normalizeHex(p.hex))}
                  className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: p.hex }}
                >
                  {active && (
                    <Check size={14} strokeWidth={3} className="text-white drop-shadow" />
                  )}
                </motion.button>
              </div>
            );
          })}
        </div>

        {/* Свой hex */}
        <div className="flex items-center gap-2 shrink-0 pb-0.5">
          <input
            type="color"
            aria-label={t("Выбрать свой цвет")}
            value={isValidHex(custom) ? normalizeHex(custom) : value}
            onChange={(e) => onChange(e.target.value)}
            className="w-8 h-8 rounded-lg bg-transparent border border-[var(--color-border-strong)] cursor-pointer p-0.5"
          />
          <input
            type="text"
            value={custom}
            spellCheck={false}
            placeholder="#6366f1"
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => commit(custom)}
            onKeyDown={(e) => e.key === "Enter" && commit(custom)}
            className="w-24 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-[var(--color-border-strong)] text-[12px] text-zinc-300 font-mono outline-none focus:border-[var(--color-accent-border)] transition-colors"
          />
        </div>
      </div>

      {/* Живое превью: показываем цвет «в деле», а не только как кружок. Тянем
          применённые токены (--color-link уже пересчитан под акцент). */}
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-black/20 px-3.5 py-2.5">
        <span className="text-[10.5px] uppercase tracking-wider text-zinc-600 shrink-0">
          {t("Превью")}
        </span>
        <span
          className="px-2.5 py-1 rounded-full text-[12px] font-medium text-white shadow-sm"
          style={{ backgroundColor: value }}
        >
          {t("Кнопка")}
        </span>
        <span
          className="text-[12.5px] font-medium underline underline-offset-2"
          style={{ color: "var(--color-link)" }}
        >
          {t("Ссылка")}
        </span>
        <span className="ml-auto font-mono text-[11px] text-zinc-500 shrink-0">
          {normalizeHex(value)}
        </span>
      </div>
    </Card>
  );
}

// ─── Тумблер «заметка дня» ─────────────────────────────────────────────────

function DailyCard({
  value,
  onChange,
  reduced,
  delay,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  reduced: boolean;
  delay: number;
}) {
  return (
    <Card
      icon={Sparkles}
      title={t("Заметка дня")}
      description={t("Поведение при запуске приложения")}
      reduced={reduced}
      delay={delay}
    >
      <Toggle
        checked={value}
        onChange={onChange}
        label={t("Открывать заметку дня при запуске")}
      />
    </Card>
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
      className="flex items-center gap-3 group py-1 w-full text-left"
    >
      <span
        className={cn(
          "relative w-10 h-[22px] rounded-full transition-colors duration-300 shrink-0",
          checked ? "bg-[var(--color-accent)]" : "bg-white/[0.12]",
        )}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-md"
          style={{ x: checked ? 18 : 0 }}
        />
      </span>
      <span className="text-[13px] text-zinc-300 group-hover:text-zinc-100 transition-colors duration-200">
        {label}
      </span>
    </button>
  );
}

// ─── Запись хоткея ─────────────────────────────────────────────────────────

function ShortcutCard({
  value,
  onChange,
  reduced,
  delay,
}: {
  value: string;
  onChange: (accel: string) => void;
  reduced: boolean;
  delay: number;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        setHint(null);
        return;
      }
      if (LONE_MODIFIERS.has(e.key)) return;
      const accel = accelFromKeyboardEvent(e);
      if (!accel) {
        setHint(
          t("Нужен модификатор (Ctrl / Alt / Shift) + буква, цифра или F-клавиша"),
        );
        return;
      }
      onChange(accel);
      setRecording(false);
      setHint(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  const isDefault = value === DEFAULT_SETTINGS.captureShortcut;

  return (
    <Card
      icon={Keyboard}
      title={t("Хоткей быстрой заметки")}
      description={t("Глобальная комбинация для окна быстрой записи")}
      reduced={reduced}
      delay={delay}
    >
      <div className="flex items-center gap-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            setRecording((r) => !r);
            setHint(null);
          }}
          className={cn(
            "min-w-[160px] px-4 py-2.5 rounded-xl text-[13px] font-mono font-medium border transition-all duration-200 text-center",
            recording
              ? "border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
              : "border-[var(--color-border-strong)] bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]",
          )}
        >
          {recording && (
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] mr-2 animate-pulse" />
          )}
          {recording ? t("Нажмите комбинацию...") : prettyAccelerator(value)}
        </motion.button>
        {!isDefault && !recording && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => onChange(DEFAULT_SETTINGS.captureShortcut)}
            className="text-[12px] text-zinc-500 hover:text-[var(--color-accent)] transition-colors duration-200"
          >
            {t("Сбросить")}
          </motion.button>
        )}
      </div>
      {hint && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[12px] text-amber-400/80 mt-2"
        >
          {hint}
        </motion.p>
      )}
    </Card>
  );
}

// ─── Календарь ICS ─────────────────────────────────────────────────────────

function CalendarCard({ reduced, delay }: { reduced: boolean; delay: number }) {
  const url = useNotesStore((s) => s.settings.calendarIcsUrl);
  const updateSettings = useNotesStore((s) => s.updateSettings);
  const status = useCalendarStore((s) => s.status);
  const error = useCalendarStore((s) => s.error);
  const eventCount = useCalendarStore((s) => s.events.length);
  const lastSync = useCalendarStore((s) => s.lastSync);
  const syncNow = useCalendarStore((s) => s.syncNow);

  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);

  const commit = () => {
    const next = draft.trim();
    if (next === url) return;
    if (next !== "" && !isValidIcsUrl(next)) {
      setDraft(url);
      return;
    }
    void updateSettings({ calendarIcsUrl: next }).then(() => {
      if (next) void syncNow();
    });
  };

  return (
    <Card
      icon={CalendarDays}
      title={t("Подписка iCal")}
      description={t("Подключить внешний календарь по ссылке iCalendar (.ics)")}
      reduced={reduced}
      delay={delay}
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          spellCheck={false}
          placeholder="https://calendar.yandex.ru/export/ics.xml?..."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/[0.04] border border-[var(--color-border-strong)] text-[13px] text-zinc-200 font-mono outline-none focus:border-[var(--color-accent-border)] focus:bg-white/[0.06] transition-colors duration-200 placeholder:text-zinc-600"
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          disabled={!url || status === "loading"}
          onClick={() => void syncNow()}
          title={t("Синхронизировать")}
          className={btnCls}
        >
          <RefreshCw
            size={14}
            className={cn(status === "loading" && "animate-spin")}
          />
          {t("Обновить")}
        </motion.button>
      </div>

      <div className="mt-2 min-h-[16px] text-[12px]">
        {status === "loading" && (
          <span className="text-zinc-500">{t("Синхронизация...")}</span>
        )}
        {status === "error" && (
          <span className="text-red-400/90 break-words">
            {t("Ошибка")}: {error}
          </span>
        )}
        {status === "ok" && (
          <span className="text-zinc-500">
            {eventCount} {t("событий")}
            {lastSync != null
              ? ` · ${new Date(lastSync).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
        )}
      </div>

      <p className="text-[11px] text-zinc-600 mt-2 leading-relaxed">
        В Яндекс.Календаре: «Настройки» → нужный календарь →
        скопируйте приватную ссылку (iCal). Ссылка содержит токен, не делитесь
        ей.
      </p>
    </Card>
  );
}

// ─── Пуш CalDAV ────────────────────────────────────────────────────────────

function CaldavCard({ reduced, delay }: { reduced: boolean; delay: number }) {
  const login = useNotesStore((s) => s.settings.caldavLogin);
  const password = useNotesStore((s) => s.settings.caldavPassword);
  const url = useNotesStore((s) => s.settings.caldavUrl);
  const updateSettings = useNotesStore((s) => s.updateSettings);

  const [loginDraft, setLoginDraft] = useState(login);
  const [pwDraft, setPwDraft] = useState(password);
  const [finding, setFinding] = useState(false);
  const [collections, setCollections] = useState<CalCollection[] | null>(null);

  useEffect(() => setLoginDraft(login), [login]);
  useEffect(() => setPwDraft(password), [password]);

  const saveCreds = () => {
    if (loginDraft.trim() !== login)
      void updateSettings({ caldavLogin: loginDraft.trim() });
    if (pwDraft !== password) void updateSettings({ caldavPassword: pwDraft });
  };

  const find = async () => {
    const l = loginDraft.trim();
    const p = pwDraft;
    if (!l || !p) {
      useToastStore.getState().push("Укажите логин и пароль приложения", "error");
      return;
    }
    await updateSettings({ caldavLogin: l, caldavPassword: p });
    setFinding(true);
    setCollections(null);
    try {
      const list = await discover(yandexHome(l), l, p);
      setCollections(list);
      if (list.length === 0)
        useToastStore.getState().push("Календари не найдены", "info");
    } catch (e) {
      useToastStore.getState().push(`CalDAV: ${String(e)}`, "error");
    } finally {
      setFinding(false);
    }
  };

  return (
    <Card
      icon={Upload}
      title={t("Пуш в Яндекс.Календарь (CalDAV)")}
      description={t("Отправлять задачи как события. Нужен пароль приложения.")}
      reduced={reduced}
      delay={delay}
    >
      <div className="space-y-2">
        <input
          type="text"
          value={loginDraft}
          spellCheck={false}
          placeholder="логин@yandex.ru"
          onChange={(e) => setLoginDraft(e.target.value)}
          onBlur={saveCreds}
          className={inputCls}
        />
        <input
          type="password"
          value={pwDraft}
          spellCheck={false}
          placeholder={t("пароль приложения")}
          onChange={(e) => setPwDraft(e.target.value)}
          onBlur={saveCreds}
          className={inputCls}
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={finding}
          onClick={() => void find()}
          className={btnCls}
        >
          <RefreshCw size={14} className={cn(finding && "animate-spin")} />
          {t("Найти календари")}
        </motion.button>
      </div>

      {collections && collections.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">
            {t("Куда отправлять")}
          </div>
          {collections.map((c) => (
            <motion.button
              key={c.href}
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => void updateSettings({ caldavUrl: c.href })}
              className={cn(
                "w-full text-left px-3 py-2 rounded-xl border text-[12.5px] transition-all duration-200",
                c.href === url
                  ? "border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-zinc-100"
                  : "border-[var(--color-border)] text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
              )}
            >
              <span className="font-medium">{c.name || t("(без имени)")}</span>
              {c.href === url && (
                <Check size={12} className="inline ml-1.5 text-[var(--color-accent)]" />
              )}
              <div className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">
                {c.href}
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {url && !collections && (
        <p className="mt-2 text-[11px] text-zinc-500 break-all">
          {t("Выбран")}: <span className="font-mono text-zinc-400">{url}</span>
        </p>
      )}
    </Card>
  );
}

// ─── Хранилище и бэкап ─────────────────────────────────────────────────────

function StorageCard({ reduced, delay }: { reduced: boolean; delay: number }) {
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
      if (saved) useToastStore.getState().push(t("Бэкап сохранён"), "success");
    } catch (e) {
      console.error("backup failed:", e);
      useToastStore.getState().push(t("Не удалось создать бэкап"), "error");
    } finally {
      setBacking(false);
    }
  };

  const runRestore = async () => {
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
    if (!picked || Array.isArray(picked)) return;

    const ok = await confirmDialog(
      t("Это перезапишет текущую папку заметок. Текущее состояние сохранится в notes.bak-<дата>. Продолжить?"),
      { confirmLabel: t("Восстановить"), danger: true },
    );
    if (!ok) return;

    setRestoring(true);
    try {
      const { backupDir, filesRestored } = await restoreWorkspace(picked);
      useNotesStore.setState({ activeId: null, activeNote: null });
      await Promise.all([refreshTree(), refreshTrash(), refreshAssets()]);
      useToastStore
        .getState()
        .push(
          t(`Восстановлено · ${filesRestored} файлов · старая папка: ${backupDir}`),
          "success",
        );
    } catch (e) {
      console.error("restore failed:", e);
      useToastStore
        .getState()
        .push(t(`Ошибка: ${(e as Error)?.message ?? String(e)}`), "error");
    } finally {
      setRestoring(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void getWorkspaceDir()
      .then((p) => { if (alive) setPath(p); })
      .catch((e) => console.error("getWorkspaceDir failed:", e));
    return () => { alive = false; };
  }, []);

  return (
    <Card
      icon={HardDrive}
      title={t("Хранилище")}
      description={t("Где лежат все заметки, изображения и корзина")}
      reduced={reduced}
      delay={delay}
    >
      <div className="mb-3 px-3.5 py-2.5 rounded-xl bg-black/20 border border-[var(--color-border)]">
        <code className="text-[12px] text-zinc-400 font-mono break-all">
          {path ?? "…"}
        </code>
      </div>
      <div className="flex flex-wrap gap-2">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={!path}
          onClick={() => {
            if (path)
              void revealItemInDir(path).catch((e) =>
                console.error("revealItemInDir failed:", e),
              );
          }}
          className={btnCls}
        >
          <FolderOpen size={14} />
          {t("Открыть папку")}
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={backing || restoring}
          onClick={() => void runBackup()}
          className={btnCls}
        >
          <Archive size={14} />
          {backing ? t("Создаю бэкап...") : t("Создать бэкап (.zip)")}
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={backing || restoring}
          onClick={() => void runRestore()}
          className={btnCls}
        >
          <Upload size={14} />
          {restoring ? t("Восстанавливаю...") : t("Восстановить из бэкапа")}
        </motion.button>
      </div>
      <p className="text-[11px] text-zinc-600 mt-2.5 leading-relaxed">
        Бэкап собирает заметки в .zip. Восстановление заменит папку; старая
        сохранится в <code className="font-mono text-zinc-500">notes.bak-&lt;дата&gt;</code>.
      </p>
    </Card>
  );
}
