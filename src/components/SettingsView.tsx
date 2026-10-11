import { IconizeSettings } from "./IconizeSettings";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, ArrowUpRight, Bookmark, CalendarDays, ChartNoAxesCombined, Check, FilePlus2, FileText, FolderOpen, HardDrive, Hash, HelpCircle, Home, Image, Inbox, Keyboard, Network, Palette, PanelRight, RefreshCw, Search, Shapes, SlidersHorizontal, Table2, Trash2, Upload, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { backupWorkspace, restoreWorkspace } from "../lib/backup";
import { confirmDialog } from "../store/confirm";
import { cn } from "../lib/cn";
import { t } from "../lib/i18n";
import { useI18n } from "./LanguageProvider";
import { ANUPPUCCIN_ACCENT, ACCENT_PRESETS, accelFromKeyboardEvent, DEFAULT_SETTINGS, isValidHex, isValidIcsUrl, normalizeHex, prettyAccelerator } from "../lib/settings";
import { ALL_MODULES, APP_MODULES, MINIMAL_MODULES, type GraphFeatures, type ModuleId } from "../lib/modules";
import { getWorkspaceDir } from "../lib/storage";
import { useCalendarStore } from "../store/calendar";
import { flushAllPending, useNotesStore } from "../store/notes";
import { useToastStore } from "../store/toasts";
import { discover, yandexHome, type CalCollection } from "../lib/caldav";
import "./SettingsView.css";

const LONE_MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);
const inputCls = "settings-input";
const btnCls = "settings-button";
const MODULE_ICONS: Record<ModuleId, LucideIcon> = { notes: FileText, files: FolderOpen, search: Search, inbox: Inbox, graph: Network, calendar: CalendarDays, tags: Hash, images: Image, overview: ChartNoAxesCombined, trash: Trash2, home: Home, newNote: FilePlus2, canvas: Shapes, database: Table2, bookmarks: Bookmark, context: PanelRight, help: HelpCircle };
const SECTIONS = [
  { id: "modules", title: "Модули", description: "Собери своё рабочее пространство. Оставь только то, чем пользуешься.", icon: Shapes, keywords: APP_MODULES.map(module => `${module.title} ${module.description}`).join(" ") },
  { id: "graph", title: "Граф", description: "Выбери доступные виды графа и дополнительные элементы.", icon: Network, keywords: "Объёмный Obsidian миникарта дыхание локальный связи volume minimap breathing local graph" },
  { id: "appearance", title: "Внешний вид", description: "Язык, акцентный цвет и движение в интерфейсе.", icon: Palette, keywords: "язык language русский english цвет анимации animations motion accent color HEX" },
  { id: "icons", title: "Иконки", description: "Iconize: значки, логотипы, правила и импорт Obsidian.", icon: Palette, keywords: "Iconize icons logo emoji SVG PNG значки логотипы правила наследование импорт" },
  { id: "behavior", title: "Поведение", description: "Настрой запуск приложения и быструю запись.", icon: SlidersHorizontal, keywords: "хоткей клавиши заметка дня запуск shortcut startup daily note" },
  { id: "calendar", title: "Подключения", description: "Внешние календари и синхронизация событий.", icon: CalendarDays, keywords: "календарь iCal CalDAV Яндекс пароль password login sync" },
  { id: "data", title: "Данные", description: "Локальное хранилище и резервные копии.", icon: HardDrive, keywords: "папка путь backup бэкап архив восстановить storage restore folder path" },
] as const;
type SectionId = typeof SECTIONS[number]["id"];
let lastSettingsSection: SectionId = "modules";

export function SettingsView() {
  const settings = useNotesStore(state => state.settings);
  const updateSettings = useNotesStore(state => state.updateSettings);
  const [section, setSection] = useState<SectionId>(lastSettingsSection);
  const [query, setQuery] = useState("");
  const status = useNotesStore(state => state.settingsSaveState);
  const scroll = useRef<HTMLDivElement>(null);
  const search = query.trim().toLocaleLowerCase();
  const matches = (text: string) => !search || text.toLocaleLowerCase().includes(search);
  const visible = search ? SECTIONS.filter(item => matches(`${t(item.title)} ${t(item.description)} ${item.keywords} ${item.id === "modules" ? APP_MODULES.map(module => t(module.title)).join(" ") : ""}`)) : SECTIONS.filter(item => item.id === section);
  const enabledCount = APP_MODULES.filter(module => settings.modules[module.id]).length;
  const save = (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch).catch(() => {});
  const chooseSection = (id: SectionId) => { lastSettingsSection = id; setSection(id); setQuery(""); scroll.current?.scrollTo(0, 0); };

  return <section className="settings-view" aria-label={t("Настройки")}>
    <header className="settings-header">
      <div><h1>{t("Настройки")}</h1><p>{t("Synapse под твой способ работы")}</p></div>
      <span className={cn("settings-save-state", status === "error" && "is-error")} role="status" aria-live="polite">
        {status === "saving" ? <RefreshCw size={14} aria-hidden="true" /> : status === "error" ? <X size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        {t(status === "saving" ? "Сохранение…" : status === "error" ? "Не удалось сохранить" : status === "saved" ? "Сохранено" : "Сохраняется автоматически")}
      </span>
    </header>
    <div className="settings-layout">
      <aside className="settings-navigation">
        <label className="settings-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={event => { setQuery(event.target.value); scroll.current?.scrollTo(0, 0); }} placeholder={t("Поиск настроек…")} aria-label={t("Поиск настроек")} />{query ? <button type="button" onClick={() => setQuery("")} aria-label={t("Очистить поиск")}><X size={14} /></button> : null}</label>
        <nav aria-label={t("Разделы настроек")}>
          {SECTIONS.map(({ id, title, icon: Icon }) => <button type="button" key={id} aria-current={!search && section === id ? "page" : undefined} onClick={() => chooseSection(id)}><Icon size={17} strokeWidth={1.7} aria-hidden="true" /><span>{t(title)}</span>{id === "modules" ? <span className="settings-nav-count">{enabledCount}</span> : null}</button>)}
        </nav>
        <p className="settings-navigation-note">{t("Настройки хранятся вместе с твоими заметками.")}</p>
      </aside>
      <div className="settings-content" ref={scroll}>
        <div className="settings-content-inner">
          {visible.length ? visible.map(item => <section className="settings-page-section" key={item.id} aria-labelledby={`settings-${item.id}-title`}>
            <div className="settings-section-heading"><h2 id={`settings-${item.id}-title`}>{t(item.title)}</h2><p>{t(item.description)}</p></div>
            {item.id === "modules" ? <>
              <div className="settings-preset-row"><span>{t("Быстрый набор")}</span><div><button type="button" className={btnCls} disabled={status === "saving"} onClick={() => void save({ modules: { ...MINIMAL_MODULES } })}>{t("Минимальный")}</button><button type="button" className={btnCls} disabled={status === "saving"} onClick={() => void save({ modules: { ...ALL_MODULES } })}>{t("Все модули")}</button></div></div>
              <p className="settings-info">{t("Отключённый модуль исчезает из меню и команд. Его данные остаются в хранилище.")}</p>
              {(["navigation", "tools"] as const).map(group => {
                const modules = APP_MODULES.filter(module => module.group === group && matches(`${t(module.title)} ${t(module.description)}`));
                return modules.length ? <SettingGroup key={group} title={t(group === "navigation" ? "Разделы приложения" : "Инструменты и панели")}>
                  {modules.map(module => <SettingRow key={module.id} icon={MODULE_ICONS[module.id]} title={t(module.title)} description={t(module.description)}>
                    <SettingsSwitch label={t(module.title)} checked={settings.modules[module.id]} disabled={status === "saving"} onChange={value => void save({ modules: { ...useNotesStore.getState().settings.modules, [module.id]: value } })} />
                  </SettingRow>)}
                </SettingGroup> : null;
              })}
              <p className="settings-footnote">{t("Редактирование заметок и настройки доступны всегда.")}</p>
            </> : item.id === "graph" ? <GraphSettings busy={status === "saving"} save={save} /> : item.id === "appearance" ? <>
              <LangCard />
              <SettingGroup title={t("Цветовая тема")}><SettingRow title={t("Тема оформления")} description={t("AnuPpuccin: палитра Dracula, цветные папки и заголовки как в Obsidian.")}><select className="settings-input" aria-label={t("Тема оформления")} value={settings.colorTheme} disabled={status === "saving"} onChange={event => { const colorTheme = event.target.value === "anuppuccin" ? "anuppuccin" : "synapse"; void save({ colorTheme, accentColor: colorTheme === "anuppuccin" ? ANUPPUCCIN_ACCENT : DEFAULT_SETTINGS.accentColor }); }}><option value="synapse">Synapse</option><option value="anuppuccin">AnuPpuccin · Dracula</option></select></SettingRow></SettingGroup>
              <AccentCard value={settings.accentColor} onChange={accentColor => void save({ accentColor })} />
              <SettingGroup title={t("Движение")}><SettingRow title={t("Анимации интерфейса")} description={t("Переходы и эффекты. Системное ограничение движения учитывается всегда.")}><SettingsSwitch label={t("Анимации интерфейса")} checked={settings.animations} disabled={status === "saving"} onChange={animations => void save({ animations })} /></SettingRow></SettingGroup>
            </> : item.id === "icons" ? <IconizeSettings /> : item.id === "behavior" ? <>
              <SettingGroup title={t("При запуске")}><SettingRow title={t("Открывать заметку дня при запуске")} description={t(settings.modules.calendar ? "Сразу перейти к сегодняшней записи." : "Доступно после включения календаря.")}><SettingsSwitch label={t("Открывать заметку дня при запуске")} checked={settings.openDailyOnStartup} disabled={!settings.modules.calendar || status === "saving"} onChange={openDailyOnStartup => void save({ openDailyOnStartup })} /></SettingRow></SettingGroup>
              {settings.modules.newNote ? <ShortcutCard value={settings.captureShortcut} onChange={captureShortcut => void save({ captureShortcut })} /> : <ModuleNotice module="newNote" />}
            </> : item.id === "calendar" ? settings.modules.calendar ? <><CalendarCard /><CaldavCard /></> : <ModuleNotice module="calendar" /> : <StorageCard />}
          </section>) : <div className="settings-no-results"><Search size={24} aria-hidden="true" /><h2>{t("Настройки не найдены")}</h2><p>{t("Попробуй другое название или открой раздел слева.")}</p><button type="button" className={btnCls} onClick={() => setQuery("")}>{t("Очистить поиск")}</button></div>}
        </div>
      </div>
    </div>
  </section>;
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-group"><h3>{title}</h3><div className="settings-rows">{children}</div></section>;
}
function SettingRow({ title, description, children, icon: Icon }: { title: string; description?: string; children: ReactNode; icon?: LucideIcon }) {
  return <div className="settings-row">{Icon ? <Icon className="settings-row-icon" size={18} strokeWidth={1.7} aria-hidden="true" /> : null}<div className="settings-row-copy"><span className="settings-row-title">{title}</span>{description ? <p>{description}</p> : null}</div><div className="settings-row-control">{children}</div></div>;
}
function SettingsSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-switch"><input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span aria-hidden="true" /></label>;
}
function Card({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description?: string; children: ReactNode }) {
  return <section className="settings-group settings-form"><h3><Icon size={16} aria-hidden="true" />{title}</h3>{description ? <p className="settings-form-description">{description}</p> : null}<div className="settings-controls">{children}</div></section>;
}
function ModuleNotice({ module }: { module: ModuleId }) {
  const entry = APP_MODULES.find(item => item.id === module)!;
  return <div className="settings-module-notice"><p>{t("Модуль «{name}» отключён.", { name: t(entry.title) })}</p><p>{t("Включи его в разделе «Модули», чтобы настроить функции.")}</p><button type="button" className={btnCls} onClick={() => void useNotesStore.getState().updateSettings({ modules: { ...useNotesStore.getState().settings.modules, [module]: true } })}>{t("Включить модуль")}<ArrowUpRight size={14} aria-hidden="true" /></button></div>;
}
function GraphSettings({ busy, save }: { busy: boolean; save: (patch: Partial<typeof DEFAULT_SETTINGS>) => Promise<void> }) {
  const modules = useNotesStore(state => state.settings.modules);
  const graph = useNotesStore(state => state.settings.graph);
  const change = (key: keyof GraphFeatures, value: boolean) => void save({ graph: { ...useNotesStore.getState().settings.graph, [key]: value } });
  const lastMode = graph.volume !== graph.obsidian;
  return <>
    {!modules.graph ? <ModuleNotice module="graph" /> : null}
    <fieldset className="settings-fieldset" disabled={!modules.graph || busy}>
      <SettingGroup title={t("Доступные виды")}>
        <SettingRow title={t("Объёмный")} description={t("Острова папок, глубина и пространственная раскладка.")}><SettingsSwitch label={t("Объёмный вид")} checked={graph.volume} disabled={lastMode && graph.volume} onChange={value => change("volume", value)} /></SettingRow>
        <SettingRow title="Obsidian" description={t("Плоский граф ссылок между заметками.")}><SettingsSwitch label={t("Вид Obsidian")} checked={graph.obsidian} disabled={lastMode && graph.obsidian} onChange={value => change("obsidian", value)} /></SettingRow>
      </SettingGroup>
      <p className="settings-footnote">{t("Хотя бы один вид должен оставаться включённым.")}</p>
      <SettingGroup title={t("Дополнительные элементы")}>
        <SettingRow title={t("Миникарта")} description={t("Обзор графа и быстрый переход к его части.")}><SettingsSwitch label={t("Миникарта")} checked={graph.minimap} onChange={value => change("minimap", value)} /></SettingRow>
        <SettingRow title={t("Дыхание узлов")} description={t("Пульсация в объёмном виде. Не влияет на симуляцию связей.")}><SettingsSwitch label={t("Дыхание узлов")} checked={graph.breathing} disabled={!graph.volume} onChange={value => change("breathing", value)} /></SettingRow>
        <SettingRow title={t("Локальный граф")} description={t("Связи текущей заметки в редакторе.")}><SettingsSwitch label={t("Локальный граф")} checked={graph.localGraph} onChange={value => change("localGraph", value)} /></SettingRow>
      </SettingGroup>
    </fieldset>
  </>;
}
function LangCard() {
  const { lang, setLang } = useI18n();
  return <SettingGroup title={t("Язык")}><SettingRow title={t("Язык интерфейса")}><select className="settings-input" aria-label={t("Язык интерфейса")} value={lang} onChange={event => setLang(event.target.value as "ru" | "en")}><option value="ru">Русский</option><option value="en">English</option></select></SettingRow></SettingGroup>;
}
function AccentCard({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [custom, setCustom] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => { setCustom(value); setInvalid(false); }, [value]);
  const commit = () => { if (isValidHex(custom)) { setInvalid(false); onChange(normalizeHex(custom)); } else setInvalid(true); };
  return <Card icon={Palette} title={t("Акцентный цвет")} description={t("Цвет выделения, ссылок и активных элементов")}>
    <div className="settings-accent-presets">{ACCENT_PRESETS.map(preset => <button type="button" key={preset.hex} style={{ background: preset.hex }} aria-label={t(preset.label)} title={t(preset.label)} aria-pressed={value === preset.hex} onClick={() => onChange(preset.hex)}>{value === preset.hex ? <Check size={16} aria-hidden="true" /> : null}</button>)}<input type="color" aria-label={t("Выбрать свой цвет")} value={value} onChange={event => onChange(event.target.value)} /><input className="settings-input settings-hex" aria-label={t("Цвет в формате HEX")} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} value={custom} spellCheck={false} onChange={event => setCustom(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} /></div>
    {invalid ? <p className="settings-field-error" id={errorId}>{t("Введите цвет в формате #RRGGBB.")}</p> : null}
    <div className="settings-accent-preview"><span>{t("Превью")}</span><span className="settings-accent-sample" style={{ background: value, color: "var(--accent-foreground)" }}>{t("Кнопка")}</span><span style={{ color: "var(--color-link)" }}>{t("Ссылка")}</span></div>
  </Card>;
}
function ShortcutCard({ value, onChange }: { value: string; onChange: (accel: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { setRecording(false); setHint(null); return; }
      if (LONE_MODIFIERS.has(event.key)) return;
      const accel = accelFromKeyboardEvent(event);
      if (!accel) { setHint(t("Нужен модификатор (Ctrl / Alt / Shift) + буква, цифра или F-клавиша")); return; }
      onChange(accel); setRecording(false); setHint(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);
  return <Card icon={Keyboard} title={t("Хоткей быстрой заметки")} description={t("Глобальная комбинация для окна быстрой записи")}>
    <div className="settings-shortcut"><button type="button" className={cn(btnCls, recording && "is-recording")} aria-pressed={recording} onClick={() => { setRecording(value => !value); setHint(null); }}>{recording ? t("Нажмите комбинацию...") : prettyAccelerator(value)}</button>{value !== DEFAULT_SETTINGS.captureShortcut && !recording ? <button type="button" className={btnCls} onClick={() => onChange(DEFAULT_SETTINGS.captureShortcut)}>{t("Сбросить")}</button> : null}</div>
    {recording ? <p className="settings-footnote">{t("Escape отменяет запись комбинации.")}</p> : null}
    {hint ? <p className="settings-field-error" role="alert">{hint}</p> : null}
  </Card>;
}

function CalendarCard() {
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
    }).catch(() => {});
  };

  return (
    <Card
      icon={CalendarDays}
      title={t("Подписка iCal")}
      description={t("Подключить внешний календарь по ссылке iCalendar (.ics)")}


    >
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          spellCheck={false}
          aria-label={t("Ссылка iCal")}
          placeholder="https://calendar.yandex.ru/export/ics.xml?..."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="settings-input"
        />
        <button
          type="button"

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
        </button>
      </div>

      <div className="mt-2 min-h-[16px] text-[12px]">
        {status === "loading" && (
          <span className="text-[var(--settings-muted)]">{t("Синхронизация...")}</span>
        )}
        {status === "error" && (
          <span className="text-red-400/90 break-words">
            {t("Ошибка")}: {error}
          </span>
        )}
        {status === "ok" && (
          <span className="text-[var(--settings-muted)]">
            {eventCount} {t("событий")}
            {lastSync != null
              ? ` · ${new Date(lastSync).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </span>
        )}
      </div>

      <p className="settings-footnote">{t("В настройках календаря скопируй приватную ссылку iCal. Она содержит токен доступа.")}</p>
    </Card>
  );
}

// ─── Пуш CalDAV ────────────────────────────────────────────────────────────

function CaldavCard() {
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
      useToastStore.getState().push(t("Укажите логин и пароль приложения"), "error");
      return;
    }
    setFinding(true);
    setCollections(null);
    try {
      await updateSettings({ caldavLogin: l, caldavPassword: p });
      if (!useNotesStore.getState().settings.modules.calendar) return;
      const list = await discover(yandexHome(l), l, p);
      setCollections(list);
      if (list.length === 0)
        useToastStore.getState().push(t("Календари не найдены"), "info");
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


    >
      <div className="space-y-2">
        <input
          type="text"
          value={loginDraft}
          spellCheck={false}
          aria-label={t("Логин CalDAV")}
          autoComplete="username"
          placeholder="логин@yandex.ru"
          onChange={(e) => setLoginDraft(e.target.value)}
          onBlur={saveCreds}
          className={inputCls}
        />
        <input
          type="password"
          value={pwDraft}
          spellCheck={false}
          aria-label={t("Пароль приложения CalDAV")}
          autoComplete="off"
          placeholder={t("пароль приложения")}
          onChange={(e) => setPwDraft(e.target.value)}
          onBlur={saveCreds}
          className={inputCls}
        />
        <button
          type="button"

          disabled={finding}
          onClick={() => void find()}
          className={btnCls}
        >
          <RefreshCw size={14} className={cn(finding && "animate-spin")} />
          {t("Найти календари")}
        </button>
      </div>

      {collections && collections.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          <div className="text-[11px] text-[var(--settings-muted)] uppercase tracking-wider font-medium">
            {t("Куда отправлять")}
          </div>
          {collections.map((c) => (
            <button
              key={c.href}
              type="button"

              onClick={() => void updateSettings({ caldavUrl: c.href })}
              className={cn(
                "w-full text-left px-3 py-2 rounded-xl border text-[12.5px] transition-all duration-200",
                c.href === url
                  ? "border-[var(--color-accent-border)] bg-[var(--color-accent-bg)] text-zinc-100"
                  : "border-[var(--color-border)] text-[var(--settings-muted)] hover:bg-white/[0.04] hover:text-zinc-200",
              )}
            >
              <span className="font-medium">{c.name || t("(без имени)")}</span>
              {c.href === url && (
                <Check size={12} className="inline ml-1.5 text-[var(--color-accent)]" />
              )}
              <div className="text-[10px] text-[var(--settings-muted)] font-mono truncate mt-0.5">
                {c.href}
              </div>
            </button>
          ))}
        </div>
      )}

      {url && !collections && (
        <p className="mt-2 text-[11px] text-[var(--settings-muted)] break-all">
          {t("Выбран")}: <span className="font-mono text-[var(--settings-muted)]">{url}</span>
        </p>
      )}
    </Card>
  );
}

// ─── Хранилище и бэкап ─────────────────────────────────────────────────────

function StorageCard() {
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
        filters: [{ name: t("Архив"), extensions: ["zip"] }],
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
      await flushAllPending();
      const { backupDir, filesRestored } = await restoreWorkspace(picked);
      useNotesStore.setState({ activeId: null, activeNote: null });
      await Promise.all([refreshTree(), refreshTrash(), refreshAssets()]);
      await useNotesStore.getState().loadSettings();
      useToastStore
        .getState()
        .push(
          t("Восстановлено: {n} файлов. Старая папка: {path}", { n: filesRestored, path: backupDir }),
          "success",
        );
    } catch (e) {
      console.error("restore failed:", e);
      useToastStore
        .getState()
        .push(t("Ошибка: {message}", { message: (e as Error)?.message ?? String(e) }), "error");
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


    >
      <div className="mb-3 px-3.5 py-2.5 rounded-xl bg-black/20 border border-[var(--color-border)]">
        <code className="text-[12px] text-[var(--settings-muted)] font-mono break-all">
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
          className={btnCls}
        >
          <FolderOpen size={14} />
          {t("Открыть папку")}
        </button>
        <button
          type="button"

          disabled={backing || restoring}
          onClick={() => void runBackup()}
          className={btnCls}
        >
          <Archive size={14} />
          {backing ? t("Создаю бэкап...") : t("Создать бэкап (.zip)")}
        </button>
        <button
          type="button"

          disabled={backing || restoring}
          onClick={() => void runRestore()}
          className={btnCls}
        >
          <Upload size={14} />
          {restoring ? t("Восстанавливаю...") : t("Восстановить из бэкапа")}
        </button>
      </div>
      <p className="text-[11px] text-[var(--settings-muted)] mt-2.5 leading-relaxed">
        {t("Бэкап сохраняет хранилище в ZIP. При восстановлении текущая папка остаётся в notes.bak-<дата>.")}
      </p>
    </Card>
  );
}
